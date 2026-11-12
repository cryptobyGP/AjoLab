// The rules layer: circles, ledger, countdown, deposit, holdback, settlement. No Paga code in here.
const fs = require('fs');
const crypto = require('crypto');
const paga = require('./paga');

const DB_FILE = process.env.DB_FILE || './data.json';
const FEE_BPS = 100;                 // 1% service fee (placeholder)
const POOL_SHARE = 25;               // % of each fee that goes into the circle's default pool (placeholder)
const DAY = 86400000;
const FUND_WINDOW = DAY;             // round 1: 24h for everyone to fund
const GRACE = DAY;                   // 24h grace after a later round's deadline

let db = { circles: {}, refs: {}, trust: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const id = (n = 6) => crypto.randomBytes(n).toString('hex');
const log = (c, text) => c.ledger.push({ at: Date.now(), text });
const now = c => Date.now() + (c.shift || 0);       // demo clock: shift lets us skip time in mock mode
const ngn = n => 'NGN ' + Number(n).toLocaleString('en-NG');

/* ---------- trust tiers ---------- */
// Trust follows the member's phone number across circles.
function trustOf(phone) { return (db.trust[phone] = db.trust[phone] || { finished: 0, defaults: 0 }); }
function tier(phone) {
  const t = trustOf(phone);
  let pct = t.finished >= 3 ? 2 : t.finished >= 1 ? 5 : 10;
  let label = t.finished >= 3 ? '3+ circles finished' : t.finished >= 1 ? '1 to 2 circles finished' : 'New member';
  if (t.defaults > 0) { pct = Math.min(25, pct + 5 * t.defaults); label += ` + ${t.defaults} default mark${t.defaults > 1 ? 's' : ''}`; }
  return { pct, label };
}

/* ---------- circle lifecycle ---------- */
function get(cid) { const c = db.circles[cid]; if (!c) throw new Error('circle not found'); return c; }

function createCircle({ name, amount, maxMembers, cycleDays, creator }) {
  if (!(amount > 0)) throw new Error('amount must be greater than 0');
  if (!(maxMembers >= 3 && maxMembers <= 10)) throw new Error('circle size must be 3 to 10');
  if (![7, 14, 30].includes(cycleDays)) throw new Error('cycleDays must be 7, 14 or 30');
  const c = { id: id(4), name, amount, maxMembers, cycleDays, members: [], round: 1, status: 'filling',
              startAt: null, cycleStartAt: null, shift: 0, pool: 0, shortfall: 0, ledger: [] };
  db.circles[c.id] = c; joinCircle(c.id, creator); log(c, `${creator.name} created the circle`);
  save(); return c;
}

function joinCircle(cid, { name, phone, bankCode, accountNumber }) {
  const c = get(cid);
  if (c.status !== 'filling') throw new Error('circle already started');
  if (c.members.length >= c.maxMembers) throw new Error('circle is full');
  trustOf(phone);
  c.members.push({ id: id(3), name, phone, bankCode, accountNumber, slot: c.members.length + 1,
                   paid: false, covered: false, defaulted: false, deposit: 0, hb: 0, hbTotal: 0, released: 0 });
  log(c, `${name} joined (seat ${c.members.length})`);
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
  const r = await paga.requestPayment({ reference, amount: c.amount, payerName: m.name, payerPhone: m.phone });
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
    if (n === c.members.length) { c.status = 'active'; c.startAt = now(c); log(c, 'All deposits in. Round 1 begins, 24h to fund.'); }
    save(); return { ok: true, deposits: n };
  }
  if (ref.round !== c.round || c.status !== 'active') throw new Error('payment is for an old round');
  if (m.paid) throw new Error('already paid or covered this round');
  ref.done = true; m.paid = true;
  const n = c.members.filter(x => x.paid).length;
  log(c, `${m.name} paid (${n} of ${c.members.length})`);
  if (n === c.members.length) await runPayout(c);
  save(); return { ok: true, paid: n };
}

async function send(c, kind, to, amount, note) {
  if (amount <= 0) return;
  const r = await paga.payout({ reference: `${kind}-${c.id}-r${c.round}-${to.id}`, amount, bankCode: to.bankCode, accountNumber: to.accountNumber, name: to.name });
  log(c, `${note}: ${ngn(amount)} to ${to.name} (${r.status})`);
}

async function runPayout(c) {
  const N = c.members.length, to = c.members[c.round - 1];
  const pot = c.amount * N, fee = Math.floor(pot * FEE_BPS / 10000);
  const t = tier(to.phone), owedLater = c.amount * (N - c.round);
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
      if (!m.defaulted) trustOf(m.phone).finished++;
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
    m.paid = true; m.covered = true; m.defaulted = true; trustOf(m.phone).defaults++;
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
function status(cid) {
  const c = get(cid); const active = c.status === 'active';
  const to = active ? c.members[c.round - 1] : null, N = c.members.length;
  const pot = c.amount * c.maxMembers, fee = Math.floor(pot * FEE_BPS / 10000);
  const pct = to ? tier(to.phone).pct : 0, hb = to ? Math.floor(c.amount * (N - c.round) * pct / 100) : 0;
  const { shift, ...rest } = c;
  return { ...rest, pot, fee, pool: c.pool,
    members: c.members.map(m => ({ id: m.id, name: m.name, slot: m.slot, paid: m.paid, deposit: m.deposit, hb: m.hb, defaulted: m.defaulted, tierPct: tier(m.phone).pct, tierLabel: tier(m.phone).label })),
    deadline: active ? deadline(c) : null, graceEnd: active ? graceEnd(c) : null, now: now(c), canSettle: canSettle(c),
    receiver: to ? to.name : null, receiverHoldback: hb, receiverPct: pct, receiverNet: active ? pot - fee - hb - c.shortfall : null };
}

module.exports = { createCircle, joinCircle, requestPayment, markPaid, settle, skipTime, status };
