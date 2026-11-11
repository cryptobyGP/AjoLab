// The rules layer: circles, ledger, countdown, payout. No Paga code in here.
const fs = require('fs');
const crypto = require('crypto');
const paga = require('./paga');

const DB_FILE = process.env.DB_FILE || './data.json';
const FEE_BPS = 100;                 // 1% service fee (placeholder)
const DAY = 86400000;
const FUND_WINDOW = DAY;             // round 1: 24h for everyone to fund
const GRACE = DAY;                   // 24h grace after a deadline

let db = { circles: {}, refs: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const id = (n = 6) => crypto.randomBytes(n).toString('hex');
const log = (c, text) => c.ledger.push({ at: Date.now(), text });

function createCircle({ name, amount, maxMembers, cycleDays, creator }) {
  if (!(amount > 0)) throw new Error('amount must be greater than 0');
  if (!(maxMembers >= 3 && maxMembers <= 10)) throw new Error('circle size must be 3 to 10');
  if (![7, 14, 30].includes(cycleDays)) throw new Error('cycleDays must be 7, 14 or 30');
  const c = { id: id(4), name, amount, maxMembers, cycleDays, members: [], round: 1, status: 'filling',
              startAt: null, cycleStartAt: null, ledger: [] };
  db.circles[c.id] = c; joinCircle(c.id, creator); log(c, `${creator.name} created the circle`);
  save(); return c;
}

function joinCircle(cid, { name, phone, bankCode, accountNumber }) {
  const c = get(cid);
  if (c.status !== 'filling') throw new Error('circle already started');
  if (c.members.length >= c.maxMembers) throw new Error('circle is full');
  c.members.push({ id: id(3), name, phone, bankCode, accountNumber, paid: false });
  log(c, `${name} joined (seat ${c.members.length})`);
  if (c.members.length === c.maxMembers) { c.status = 'active'; c.startAt = Date.now(); log(c, 'All seats taken. Round 1 begins, 24h to fund.'); }
  save(); return c;
}

function get(cid) { const c = db.circles[cid]; if (!c) throw new Error('circle not found'); return c; }

// Deadline for the current round (the countdown restarts fresh after every payout).
const deadline = c => c.round === 1 ? c.startAt + FUND_WINDOW : c.cycleStartAt + c.cycleDays * DAY;
const receiver = c => c.members[c.round - 1];

async function requestPayment(cid, memberId) {
  const c = get(cid); const m = c.members.find(x => x.id === memberId);
  if (c.status !== 'active') throw new Error('circle is not active');
  if (!m) throw new Error('member not found'); if (m.paid) throw new Error('already paid this round');
  const reference = `ajo-${c.id}-r${c.round}-${m.id}`;
  db.refs[reference] = { cid, memberId, round: c.round, done: false };
  const r = await paga.requestPayment({ reference, amount: c.amount, payerName: m.name, payerPhone: m.phone });
  save(); return r;
}

// Called by the Paga webhook (or the mock). Safe to call twice with the same reference.
async function markPaid(reference) {
  const ref = db.refs[reference]; if (!ref) throw new Error('unknown reference');
  if (ref.done) return { duplicate: true };
  const c = get(ref.cid); if (ref.round !== c.round) throw new Error('payment is for an old round');
  const m = c.members.find(x => x.id === ref.memberId);
  ref.done = true; m.paid = true;
  const n = c.members.filter(x => x.paid).length;
  log(c, `${m.name} paid (${n} of ${c.members.length})`);
  if (n === c.members.length) await runPayout(c);
  save(); return { ok: true, paid: n };
}

async function runPayout(c) {
  const to = receiver(c);
  const pot = c.amount * c.members.length, fee = Math.floor(pot * FEE_BPS / 10000), net = pot - fee;
  log(c, `Everyone paid. Pot ${pot}, fee ${fee}.`);
  const r = await paga.payout({ reference: `payout-${c.id}-r${c.round}`, amount: net, bankCode: to.bankCode, accountNumber: to.accountNumber, name: to.name });
  log(c, `Paid out ${net} NGN to ${to.name} (${r.status})`);
  if (c.round === c.members.length) { c.status = 'completed'; log(c, 'Circle complete. Everyone has been paid.'); return; }
  c.round++; c.cycleStartAt = Date.now();                    // fresh countdown after every payout
  c.members.forEach(m => (m.paid = false));
  log(c, `Round ${c.round} begins. Countdown restarts: ${c.cycleDays} days.`);
}

// Who still owes money and whether the deadline plus grace has passed.
function status(cid) {
  const c = get(cid); const now = Date.now(); const dl = c.status === 'active' ? deadline(c) : null;
  return { ...c, deadline: dl, canSettle: !!dl && now > dl + (c.round === 1 ? 0 : GRACE) && c.members.some(m => !m.paid),
           receiver: c.status === 'active' ? receiver(c).name : null };
}

module.exports = { createCircle, joinCircle, requestPayment, markPaid, status };
