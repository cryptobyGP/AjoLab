// The rules layer: circles, ledger, countdown, deposit, holdback, settlement. No Paga code in here.
const paga = require('./paga');
const notify = require('./notify');
const { db, save, id } = require('./store');

const FEE_BPS = 100;                 // 1% service fee (placeholder)
const POOL_SHARE = 25;               // % of each fee that goes into the circle's default pool (placeholder)
const DAY = 86400000;
const FUND_WINDOW = DAY;             // round 1: 24h for everyone to fund
const GRACE = DAY;                   // 24h grace after a later round's deadline

const log = (c, text) => c.ledger.push({ at: Date.now(), text });
const now = c => Date.now() + (c.shift || 0);       // demo clock: shift lets us skip time in mock mode
const ngn = n => '₦' + Number(n).toLocaleString('en-NG');

/* ---------- users, wallet, receipts ---------- */
function getUser(uid) { const u = db.users[uid]; if (!u) throw new Error('user not found'); return u; }
function upsertUser(uid, email) {
  const u = (db.users[uid] = db.users[uid] || { uid, email: email || '', name: '', phone: '', bank: null, wallet: 0, finished: 0, defaults: 0, notes: [], receipts: [], created: Date.now() });
  if (email && !u.email) u.email = email; save(); return u;
}
function profile(uid, { name, phone, bank }) {
  const u = getUser(uid);
  if (name != null) u.name = String(name).trim().slice(0, 40);
  if (phone != null) u.phone = String(phone).replace(/\s/g, '').slice(0, 20);
  if (bank) {
    if (!/^\d{10}$/.test(bank.account || '')) throw new Error('Account number must be 10 digits');
    if (!bank.code) throw new Error('Pick a bank');
    u.bank = { code: bank.code, name: bank.name || '', account: bank.account };
  }
  save(); return pub(u);
}
// A receipt is a record of money that moved. It also shows up as a notification and goes to email.
function receipt(uid, rc) {
  const u = db.users[uid]; if (!u) return;
  rc = { id: 'RC-' + id(3).toUpperCase(), at: Date.now(), status: 'Successful', ...rc };
  u.receipts.unshift(rc); u.notes.unshift({ id: rc.id, at: rc.at, title: rc.title, text: rc.summary, receipt: rc.id, read: false });
  u.receipts.length = Math.min(u.receipts.length, 200); u.notes.length = Math.min(u.notes.length, 200);
  notify.email(u, rc); return rc;
}
const pub = u => ({ uid: u.uid, email: u.email, name: u.name, phone: u.phone, bank: u.bank, wallet: u.wallet, finished: u.finished, defaults: u.defaults,
  tier: tierOf(u), notes: u.notes, receipts: u.receipts });

async function withdraw(uid, amount) {
  const u = getUser(uid); amount = Math.floor(Number(amount));
  if (!(amount >= 100)) throw new Error('Minimum transfer is ₦100');
  if (!u.bank) throw new Error('Add your bank account first');
  if (amount > u.wallet) throw new Error('Not enough in your balance');
  const reference = 'wd-' + id(5); u.wallet -= amount; save();
  try {
    const r = await paga.payout({ reference, amount, bankCode: u.bank.code, accountNumber: u.bank.account, name: u.name || u.email });
    receipt(uid, { title: 'Transfer to bank', summary: `${ngn(amount)} sent to account ending ${u.bank.account.slice(-4)} through Paga.`, amount, reference, kind: 'withdraw', status: r.status === 'SUCCESS' ? 'Successful' : r.status });
  } catch (e) { u.wallet += amount; save(); throw new Error('Transfer failed, your money is still in your balance. ' + e.message); }
  save(); return pub(u);
}

/* ---------- trust tiers ---------- */
function tierOf(u) {
  let pct = u.finished >= 3 ? 2 : u.finished >= 1 ? 5 : 10;
  let label = u.finished >= 3 ? '3+ circles finished' : u.finished >= 1 ? '1 to 2 circles finished' : 'New member';
  if (u.defaults > 0) { pct = Math.min(25, pct + 5 * u.defaults); label += ` + ${u.defaults} default mark${u.defaults > 1 ? 's' : ''}`; }
  return { pct, label };
}
const tier = uid => tierOf(getUser(uid));

/* ---------- circle lifecycle ---------- */
function get(cid) { const c = db.circles[cid]; if (!c) throw new Error('circle not found'); return c; }

function createCircle({ name, amount, maxMembers, cycleDays }, uid) {
  if (!(amount > 0)) throw new Error('amount must be greater than 0');
  if (!(maxMembers >= 3 && maxMembers <= 10)) throw new Error('circle size must be 3 to 10');
  if (![7, 14, 30].includes(cycleDays)) throw new Error('cycleDays must be 7, 14 or 30');
  const c = { id: id(4), name, amount, maxMembers, cycleDays, members: [], round: 1, status: 'filling',
              startAt: null, cycleStartAt: null, shift: 0, pool: 0, shortfall: 0, ledger: [], owner: uid, created: Date.now() };
  name = String(name || '').trim().slice(0, 40); if (!name) throw new Error('Give the circle a name'); c.name = name;
  db.circles[c.id] = c; joinCircle(c.id, uid); log(c, `${getUser(uid).name} created the circle`);
  save(); return c;
}

function joinCircle(cid, uid) {
  const c = get(cid), u = getUser(uid);
  if (!u.name) throw new Error('Add your name first');
  if (c.members.some(m => m.uid === uid)) throw new Error('You are already in this circle');
  if (c.status !== 'filling') throw new Error('circle already started');
  if (c.members.length >= c.maxMembers) throw new Error('circle is full');
  c.members.push({ id: id(3), uid, name: u.name, slot: c.members.length + 1,
                   paid: false, covered: false, defaulted: false, deposit: 0, hb: 0, hbTotal: 0, released: 0 });
  log(c, `${u.name} joined (seat ${c.members.length})`);
  if (c.members.length === c.maxMembers) { c.status = 'deposits'; log(c, `All seats taken. Everyone pays a ${ngn(c.amount)} deposit to start.`); }
  save(); return c;
}

// Deadline for the current round. The countdown restarts fresh after every payout.
const deadline = c => c.round === 1 ? c.startAt + FUND_WINDOW : c.cycleStartAt + c.cycleDays * DAY;
const graceEnd = c => deadline(c) + (c.round === 1 ? 0 : GRACE);
const canSettle = c => c.status === 'active' && now(c) > graceEnd(c) && c.members.some(m => !m.paid);

async function requestPayment(cid, memberId, kind = 'round') {
  const c = get(cid); const m = c.members.find(x => x.id === memberId);
  if (!m) throw new Error('member not found');
  if (kind === 'deposit') {
    if (c.status !== 'deposits') throw new Error('deposits are not open');
    if (m.deposit) throw new Error('deposit already paid');
  } else {
    if (c.status !== 'active') throw new Error('circle is not active');
    if (m.paid) throw new Error('already paid this round');
  }
  const reference = kind === 'deposit' ? `dep-${c.id}-${m.id}` : `ajo-${c.id}-r${c.round}-${m.id}`;
  db.refs[reference] = { cid, memberId, round: c.round, kind, done: false };
  const r = await paga.requestPayment({ reference, amount: c.amount, payerName: m.name, payerPhone: getUser(m.uid).phone, payerEmail: getUser(m.uid).email });
  save(); return r;
}

// Called by the Paga webhook (or the mock). Safe to call twice with the same reference.
async function markPaid(reference) {
  const ref = db.refs[reference]; if (!ref) throw new Error('unknown reference');
  if (ref.done) return { duplicate: true };
  const c = get(ref.cid); const m = c.members.find(x => x.id === ref.memberId);
  if (ref.kind === 'deposit') {
    ref.done = true; m.deposit = c.amount;
    const n = c.members.filter(x => x.deposit).length;
    log(c, `${m.name} paid the deposit (${n} of ${c.members.length})`);
    receipt(m.uid, { title: 'Deposit received', summary: `Your deposit for ${c.name} is held until the circle ends.`, amount: c.amount, reference, circleName: c.name });
    if (n === c.members.length) { c.status = 'active'; c.startAt = now(c); log(c, 'All deposits in. Round 1 begins, 24h to fund.'); }
    save(); return { ok: true, deposits: n };
  }
  if (ref.round !== c.round || c.status !== 'active') throw new Error('payment is for an old round');
  if (m.paid) throw new Error('already paid or covered this round');
  ref.done = true; m.paid = true;
  const n = c.members.filter(x => x.paid).length;
  log(c, `${m.name} paid (${n} of ${c.members.length})`);
  receipt(m.uid, { title: 'Payment received', summary: `Your round ${c.round} payment to ${c.name} was received.`, amount: c.amount, reference, circleName: c.name });
  if (n === c.members.length) await runPayout(c);
  save(); return { ok: true, paid: n };
}

// Money owed to a member lands in their AjoLabs balance. They move it to their bank from the portfolio.
async function send(c, kind, to, amount, note) {
  if (amount <= 0) return;
  const u = getUser(to.uid); u.wallet += amount;
  log(c, `${note}: ${ngn(amount)} to ${to.name}`);
  const T = { payout: ['Payout received', `Your round ${c.round} payout from ${c.name} is in your balance.`], hb: ['Holdback released', `A held-back part of your payout from ${c.name} is now in your balance.`], dep: ['Deposit returned', `Your deposit for ${c.name} is back in your balance.`] }[kind];
  receipt(to.uid, { title: T[0], summary: T[1], amount, reference: `${kind}-${c.id}-r${c.round}-${to.id}`, circleName: c.name, kind });
}

async function runPayout(c) {
  const N = c.members.length, to = c.members[c.round - 1];
  const pot = c.amount * N, fee = Math.floor(pot * FEE_BPS / 10000);
  const t = tier(to.uid), owedLater = c.amount * (N - c.round);
  const hb = Math.floor(owedLater * t.pct / 100), short = c.shortfall || 0;
  const net = pot - fee - hb - short;
  c.pool += Math.floor(fee * POOL_SHARE / 100); to.hb += hb; to.hbTotal = hb;
  log(c, `Round ${c.round} complete. Pot ${ngn(pot)}, fee ${ngn(fee)}${hb ? `, holdback ${ngn(hb)} (${t.pct}%)` : ''}${short ? `, uncovered shortfall ${ngn(short)}` : ''}.`);
  await send(c, 'payout', to, net, 'Payout');
  // holdback comes back in equal parts, one per round, for everyone who has already received
  for (const m of c.members) {
    if (m.slot >= c.round || m.hb <= 0) continue;
    const parts = N - m.slot; m.released++;
    const amt = m.released >= parts ? m.hb : Math.min(m.hb, Math.floor(m.hbTotal / parts));
    m.hb -= amt; await send(c, 'hb', m, amt, 'Holdback released');
  }
  if (c.round === N) {                                  // last round: return deposits, update trust
    for (const m of c.members) {
      if (m.deposit > 0) { const d = m.deposit; m.deposit = 0; await send(c, 'dep', m, d, 'Deposit returned'); }
      if (!m.defaulted) getUser(m.uid).finished++;
    }
    c.status = 'completed'; log(c, 'Circle complete. Everyone has been paid.'); return;
  }
  c.round++; c.cycleStartAt = now(c); c.shortfall = 0;
  c.members.forEach(m => { m.paid = false; m.covered = false; });
  log(c, `Round ${c.round} begins. Countdown restarts: ${c.cycleDays} days.`);
}

// Anyone can run this once the deadline and grace have passed.
async function settle(cid) {
  const c = get(cid);
  if (!canSettle(c)) throw new Error('The deadline and grace period have not passed yet');
  for (const m of c.members.filter(x => !x.paid)) {
    let need = c.amount; const parts = [];
    const take = (label, have, set) => { const x = Math.min(have, need); if (x > 0) { set(have - x); need -= x; parts.push(`${ngn(x)} from ${label}`); } };
    take('holdback', m.hb, v => (m.hb = v));
    take('deposit', m.deposit, v => (m.deposit = v));
    take('the default pool', c.pool, v => (c.pool = v));
    if (need > 0) { c.shortfall += need; parts.push(`${ngn(need)} uncovered`); }
    m.paid = true; m.covered = true; m.defaulted = true; getUser(m.uid).defaults++;
    receipt(m.uid, { title: 'Missed payment', summary: `You missed round ${c.round} of ${c.name}. It was covered and a default mark was added.`, circleName: c.name, status: 'Default' });
    log(c, `${m.name} missed round ${c.round}. Covered: ${parts.join(', ')}. Default mark added.`);
  }
  await runPayout(c); save();
}

// Demo helper (mock mode): jump the clock to just after the deadline and grace.
function skipTime(cid) {
  const c = get(cid); if (c.status !== 'active') throw new Error('circle is not active');
  c.shift = (c.shift || 0) + Math.max(0, graceEnd(c) - now(c) + 1000);
  log(c, 'Demo: clock moved past the deadline and grace period.'); save();
}

/* ---------- what the screens see (no phone numbers or bank details) ---------- */
function status(cid, uid) {
  const c = get(cid); const active = c.status === 'active';
  const to = active ? c.members[c.round - 1] : null, N = c.members.length;
  const pot = c.amount * c.maxMembers, fee = Math.floor(pot * FEE_BPS / 10000);
  const pct = to ? tier(to.uid).pct : 0, hb = to ? Math.floor(c.amount * (N - c.round) * pct / 100) : 0;
  const { shift, owner, ...rest } = c;
  return { ...rest, isOwner: owner === uid, myId: (c.members.find(m => m.uid === uid) || {}).id || null, pot, fee, pool: c.pool,
    members: c.members.map(m => ({ id: m.id, name: m.name, slot: m.slot, paid: m.paid, deposit: m.deposit, hb: m.hb, defaulted: m.defaulted, tierPct: tier(m.uid).pct, tierLabel: tier(m.uid).label, you: m.uid === uid })),
    deadline: active ? deadline(c) : null, graceEnd: active ? graceEnd(c) : null, now: now(c), canSettle: canSettle(c),
    receiver: to ? to.name : null, receiverHoldback: hb, receiverPct: pct, receiverNet: active ? pot - fee - hb - c.shortfall : null };
}

// Demo helpers (mock mode only): fill empty seats with sample members, and let them pay.
function devFill(cid) {
  const c = get(cid), B = ['Ada', 'Tunde', 'Ngozi', 'Emem', 'Bisi', 'Kemi', 'Uche', 'Efe', 'Imo']; let i = 0;
  while (c.status === 'filling') { const uid = 'bot:' + cid + ':' + i; upsertUser(uid, ''); db.users[uid].name = B[i++ % B.length]; joinCircle(cid, uid); }
}
async function devPayOthers(cid, me, exceptSlot) {
  const c = get(cid);
  for (const m of c.members) {
    if (m.uid === me || m.slot === exceptSlot) continue;
    if (c.status === 'deposits' && !m.deposit) await markPaid((await requestPayment(cid, m.id, 'deposit')).reference);
    else if (c.status === 'active' && !m.paid) await markPaid((await requestPayment(cid, m.id)).reference);
  }
}

const mine = uid => Object.values(db.circles).filter(c => c.members.some(m => m.uid === uid)).sort((a, b) => b.created - a.created).map(c => status(c.id, uid));
const preview = cid => { const c = get(cid); return { id: c.id, name: c.name, amount: c.amount, maxMembers: c.maxMembers, cycleDays: c.cycleDays, status: c.status, joined: c.members.length }; };

// Demo helpers (mock mode only): add pretend members and pay for them so one person can try the whole flow.
function devFill(cid) {
  const c = get(cid), B = ['Ada', 'Tunde', 'Ngozi', 'Emem', 'Bisi', 'Kemi', 'Uche', 'Efe', 'Imo']; let i = 0;
  while (c.members.length < c.maxMembers) { const uid = `bot:${cid}:${i}`; const u = upsertUser(uid, ''); u.name = B[i++ % B.length]; joinCircle(cid, uid); }
}
async function devPayOthers(cid, me, exceptId) {
  const c = get(cid);
  for (const m of [...c.members]) {
    if (m.uid === me || m.id === exceptId) continue;
    if (c.status === 'deposits' && !m.deposit) { const r = await requestPayment(cid, m.id, 'deposit'); await markPaid(r.reference); }
    else if (c.status === 'active' && !m.paid) { const r = await requestPayment(cid, m.id); await markPaid(r.reference); }
  }
}

module.exports = { devFill, devPayOthers, upsertUser, profile, pub, getUser, withdraw, createCircle, joinCircle, requestPayment, markPaid, settle, skipTime, status, mine, preview };
