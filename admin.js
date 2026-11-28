// Owner dashboard: read-only. Everything here only READS the data, nothing can move money.
const { db } = require('./store');
const circle = require('./circle'), proof = require('./proof'), paga = require('./paga');

const DAY = 86400000;
const bare = s => String(s).trim().replace(/^did:privy:/, '');
const ids = () => (process.env.ADMIN_UIDS || '').split(',').map(bare).filter(Boolean);
const isAdmin = uid => ids().includes(bare(uid));
const real = u => !String(u.uid).startsWith('bot:');
const lagosDay = t => new Date(t + 3600e3).toISOString().slice(0, 10);   // Lagos is UTC+1
const mask = s => (s ? '…' + String(s).slice(-4) : null);

function kindOf(r) {
  if (r.kind) return r.kind;
  if (/deposit received/i.test(r.title)) return 'deposit';
  if (/payment received/i.test(r.title)) return 'round';
  if (/missed/i.test(r.title)) return 'missed';
  return 'other';
}
function allReceipts() {
  const out = [];
  for (const u of Object.values(db.users)) { if (!real(u)) continue; for (const r of u.receipts || []) out.push({ ...r, uid: u.uid, who: u.name || u.email || u.uid, k: kindOf(r) }); }
  return out.sort((a, b) => b.at - a.at);
}

async function payoutWallet() {
  try { const sw = require('./solsend'); return { address: sw.wallet().address, sol: (await sw.balance()) / 1e9, usdc: (await sw.usdcBalance()) / 1e6 }; } catch (e) { return { address: '', sol: 0, error: e.message }; }
}
async function overview() {
  const users = Object.values(db.users).filter(real), circles = Object.values(db.circles), rc = allReceipts(), t = Date.now();
  const by = {}; for (const c of circles) by[c.status] = (by[c.status] || 0) + 1;
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const okR = rc.filter(r => r.status === 'Successful');
  const money = {
    balances: sum(users, u => u.wallet),
    deposits: sum(circles.filter(c => c.status !== 'completed'), c => sum(c.members, m => m.deposit ? c.amount : 0)),
    pools: sum(circles, c => c.pool), shortfall: sum(circles, c => c.shortfall),
    funded: sum(okR.filter(r => r.k === 'fund'), r => r.amount),
    withdrawn: sum(okR.filter(r => r.k === 'withdraw'), r => r.amount),
    paidIn: sum(okR.filter(r => r.k === 'deposit' || r.k === 'round'), r => r.amount),
    paidOut: sum(okR.filter(r => r.k === 'payout'), r => r.amount),
    fees: sum(okR.filter(r => r.k === 'payout'), r => r.fee),
  };
  const days = []; for (let i = 29; i >= 0; i--) days.push(lagosDay(t - i * DAY));
  const idx = Object.fromEntries(days.map((d, i) => [d, i])), z = () => days.map(() => 0);
  const s = { days, users: z(), circles: z(), funded: z(), withdrawn: z(), payments: z(), fees: z(), failed: z() };
  const bump = (arr, at, v = 1) => { const i = idx[lagosDay(at)]; if (i != null) arr[i] += v; };
  users.forEach(u => bump(s.users, u.created)); circles.forEach(c => bump(s.circles, c.created));
  for (const r of rc) {
    if (r.status !== 'Successful') { bump(s.failed, r.at); continue; }
    if (r.k === 'fund') bump(s.funded, r.at, r.amount); else if (r.k === 'withdraw') bump(s.withdrawn, r.at, r.amount);
    else if (r.k === 'deposit' || r.k === 'round') bump(s.payments, r.at, r.amount); else if (r.k === 'payout') bump(s.fees, r.at, r.fee);
  }
  const pw = await payoutWallet();
  return {
    payoutWallet: pw, fees: circle.feeStatus(), at: t, mode: paga.MODE, storage: require('./store').REMOTE ? 'upstash' : 'file',
    users: { total: users.length, new7: users.filter(u => t - u.created < 7 * DAY).length, withBank: users.filter(u => u.bank).length, withWallet: users.filter(u => u.sol).length, withConnector: users.filter(u => u.connector).length, withAuto: circles.reduce((n, c) => n + c.members.filter(m => m.auto).length, 0) },
    circles: { total: circles.length, byStatus: by, members: sum(circles, c => c.members.length) },
    money, series: s, problems: problems(),
    proof: { ...(() => { let tot = 0, ok = 0, bad = 0; for (const c of circles) { const ch = c.chain || []; tot += ch.length; ok += ch.filter(e => e.ok).length; if (!proof.verifyChain(c)) bad++; } return { total: tot, confirmed: ok, brokenChains: bad }; })(), lastError: proof.lastError || '' },
    recent: rc.slice(0, 15).map(r => ({ id: r.id, at: r.at, title: r.title, amount: r.amount || 0, status: r.status, who: r.who, circle: r.circleName || '' })),
  };
}

function problems() {
  const out = [], t = Date.now(), add = (level, area, text, ref) => out.push({ level, area, text, ref: ref || '' });
  for (const c of Object.values(db.circles)) {
    const n = circle.nowOf(c), late = c.members.filter(m => !m.paid && !m.defaulted);
    if (c.status === 'active' && n > circle.deadline(c) && late.length) add(n > circle.graceEnd(c) ? 'high' : 'mid', 'Payments', `${c.name} round ${c.round}: ${late.length} unpaid after the deadline (${late.map(m => m.name).join(', ')})${n > circle.graceEnd(c) ? '. Grace ended, it can be settled.' : '.'}`, c.id);
    if (c.status === 'deposits' && t - (c.created || t) > 3 * DAY) add('mid', 'Circles', `${c.name} has waited over 3 days for deposits (${c.members.filter(m => m.deposit).length}/${c.members.length} paid).`, c.id);
    if (c.status === 'filling' && t - (c.created || t) > 7 * DAY) add('low', 'Circles', `${c.name} has been filling for over 7 days (${c.members.length}/${c.maxMembers} seats).`, c.id);
    const ch = c.chain || [];
    if (!proof.verifyChain(c)) add('high', 'Proof', `${c.name}: the record chain does not verify. Something changed in its history.`, c.id);
    const lost = ch.filter(e => !e.sig && (e.tries || 0) >= 3).length, wait = ch.filter(e => e.sig && !e.ok && t - (e.anchoredAt || t) > 10 * 60e3).length;
    if (lost) add('mid', 'Proof', `${c.name}: ${lost} record(s) could not be written to Solana after several tries.`, c.id);
    if (wait) add('low', 'Proof', `${c.name}: ${wait} record(s) sent to Solana but not confirmed for over 10 minutes.`, c.id);
  }
  for (const u of Object.values(db.users)) { if (!real(u)) continue; if (u.wallet < 0) add('high', 'Money', `${u.name || u.email || u.uid} has a negative balance (${u.wallet}).`, u.uid); }
  for (const r of allReceipts().filter(r => r.status !== 'Successful' && t - r.at < 14 * DAY)) add(/transfer|debit/i.test(r.title) ? 'mid' : 'low', 'Receipts', `${r.title} for ${r.who}${r.amount ? ' (₦' + Number(r.amount).toLocaleString('en-NG') + ')' : ''}: ${r.status}.`, r.id);
  for (const [ref, x] of Object.entries(db.refs)) if (x && x.walletOut && !x.done && t - (x.at || t) > 10 * 60e3) add('mid', 'Money', `Wallet transfer ${ref} (₦${Number(x.amount).toLocaleString('en-NG')}) has had no answer from Solana for over 10 minutes.`, ref);
  if (proof.lastError) add('mid', 'Proof', 'The Solana recorder reported: ' + proof.lastError, '');
  const rank = { high: 0, mid: 1, low: 2 }; return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

const userView = u => ({ uid: u.uid, name: u.name, email: u.email, phone: u.phone, created: u.created, balance: u.wallet, finished: u.finished, defaults: u.defaults, bank: u.bank ? { name: u.bank.name, account: mask(u.bank.account) } : null, wallet: u.sol ? u.sol.address : null, mandate: u.mandate ? u.mandate.status : null, connector: !!u.connector, receipts: (u.receipts || []).length });
const circleView = c => ({ id: c.id, name: c.name, status: c.status, round: c.round, amount: c.amount, maxMembers: c.maxMembers, cycleDays: c.cycleDays, created: c.created, pool: c.pool, shortfall: c.shortfall,
  members: c.members.map(m => ({ id: m.id, name: m.name, uid: m.uid, slot: m.slot, paid: m.paid, deposit: m.deposit, defaulted: m.defaulted, covered: m.covered, auto: !!m.auto })),
  ledger: c.ledger.slice(-60), chain: (c.chain || []).map(e => ({ seq: e.seq, at: e.at, kind: e.kind, hash: e.hash.slice(0, 10), sig: e.sig || null, ok: !!e.ok, tries: e.tries || 0 })), chainValid: proof.verifyChain(c) });

// Find anything by a word: receipt id, payment reference, circle id, user id, email, name, phone, Solana signature or wallet address.
function trace(q) {
  q = String(q || '').trim(); if (q.length < 3) throw new Error('Type at least 3 characters');
  const low = q.toLowerCase(), has = v => v != null && String(v).toLowerCase().includes(low), res = { q, users: [], circles: [], receipts: [], refs: [], chain: [] };
  for (const u of Object.values(db.users)) if (real(u) && [u.uid, u.email, u.name, u.phone, u.sol && u.sol.address, u.account && u.account.number].some(has)) res.users.push({ ...userView(u), recent: (u.receipts || []).slice(0, 8).map(r => ({ id: r.id, at: r.at, title: r.title, amount: r.amount, status: r.status, reference: r.reference })) });
  for (const c of Object.values(db.circles)) {
    const hit = [c.id, c.name].some(has) || c.members.some(m => has(m.id) || has(m.name) || has(m.uid));
    if (hit) res.circles.push(circleView(c));
    for (const e of c.chain || []) if (has(e.sig) || has(e.hash)) res.chain.push({ circle: c.id, circleName: c.name, seq: e.seq, kind: e.kind, at: e.at, hash: e.hash, sig: e.sig || null, ok: !!e.ok, explorer: e.sig ? 'https://explorer.solana.com/tx/' + e.sig + '?cluster=devnet' : null });
  }
  for (const r of allReceipts()) if ([r.id, r.reference, r.title, r.circleName].some(has)) res.receipts.push({ id: r.id, at: r.at, title: r.title, summary: r.summary, amount: r.amount, fee: r.fee || 0, status: r.status, reference: r.reference, who: r.who, uid: r.uid, circle: r.circleName || '' });
  for (const [ref, x] of Object.entries(db.refs)) if (has(ref)) res.refs.push({ ref, ...Object.fromEntries(Object.entries(x).filter(([k]) => !/token|secret|hash/i.test(k))) });
  res.receipts = res.receipts.slice(0, 40); res.refs = res.refs.slice(0, 20); res.users = res.users.slice(0, 10); res.circles = res.circles.slice(0, 6); res.chain = res.chain.slice(0, 10);
  return res;
}
// Analytics for the chart: pick a range, get one number per bucket for every measure. Lagos time (UTC+1).
function series(range) {
  const OFF = 3600e3, t = Date.now(), users = Object.values(db.users).filter(real), circles = Object.values(db.circles), rc = allReceipts();
  let size = DAY, n;
  if (range === '1d') { size = 3600e3; n = 24; }
  else if (range === '7d') n = 7; else if (range === '30d') n = 30;
  else {
    const first = Math.min(t, ...users.map(u => u.created || t), ...circles.map(c => c.created || t), ...rc.map(r => r.at));
    n = Math.max(1, Math.ceil((t - first) / DAY) + 1); if (n > 90) { size = 7 * DAY; n = Math.ceil(n / 7); }
  }
  const endB = Math.floor((t + OFF) / size), start = endB - n + 1, M = ['users', 'circles', 'funded', 'withdrawn', 'payments', 'payouts', 'fees', 'failed'];
  const out = { range, unit: size === 3600e3 ? 'hour' : size === DAY ? 'day' : 'week', labels: [], m: {} }; M.forEach(k => (out.m[k] = new Array(n).fill(0)));
  const add = (k, at, v = 1) => { const i = Math.floor((at + OFF) / size) - start; if (i >= 0 && i < n) out.m[k][i] += v; };
  for (let i = 0; i < n; i++) { const d = new Date((start + i) * size - OFF + OFF); out.labels.push(size === 3600e3 ? d.toISOString().slice(11, 13) + ':00' : d.toISOString().slice(5, 10)); }
  users.forEach(u => add('users', u.created)); circles.forEach(c => add('circles', c.created));
  for (const r of rc) {
    if (r.status !== 'Successful') { add('failed', r.at); continue; }
    if (r.k === 'fund') add('funded', r.at, r.amount); else if (r.k === 'withdraw') add('withdrawn', r.at, r.amount);
    else if (r.k === 'deposit' || r.k === 'round') add('payments', r.at, r.amount); else if (r.k === 'payout') { add('payouts', r.at, r.amount); add('fees', r.at, r.fee); }
  }
  out.totals = Object.fromEntries(M.map(k => [k, out.m[k].reduce((a, b) => a + b, 0)])); return out;
}
// Revenue card: the owner's share of the service fees in a period, compared with the period just before it.
function feeTrend(range) {
  const OFF = 3600e3, t = Date.now(), pool = circle.feeStatus().poolShare, size = range === '1d' ? 3600e3 : DAY;
  const n = range === '1d' ? 24 : range === '7d' ? 7 : range === '30d' ? 30 : 0;
  const kept = [];  // [at, amount kept]
  for (const r of allReceipts()) if (r.k === 'payout' && r.status === 'Successful' && r.fee) kept.push([r.at, r.fee - Math.floor(r.fee * pool / 100)]);
  const total = kept.reduce((a, [, v]) => a + v, 0);
  if (!n) { const first = Math.min(t, ...kept.map(k => k[0])), days = Math.min(90, Math.max(1, Math.ceil((t - first) / DAY) + 1)); return trendOf(kept, DAY, days, false, total); }
  return trendOf(kept, size, n, true, total);
}
function trendOf(kept, size, n, compare, total) {
  const OFF = 3600e3, t = Date.now(), endB = Math.floor((t + OFF) / size), start = endB - n + 1, vals = new Array(n).fill(0), labels = []; let prev = 0;
  for (const [at, v] of kept) { const b = Math.floor((at + OFF) / size); if (b >= start && b <= endB) vals[b - start] += v; else if (compare && b >= start - n && b < start) prev += v; }
  for (let i = 0; i < n; i++) labels.push(new Date((start + i) * size).toISOString().slice(size === 3600e3 ? 11 : 5, size === 3600e3 ? 13 : 10) + (size === 3600e3 ? ':00' : ''));
  const cur = vals.reduce((a, b) => a + b, 0);
  return { cur, prev: compare ? prev : null, pct: compare && prev > 0 ? Math.round((cur - prev) / prev * 1000) / 10 : null, isNew: compare && prev === 0 && cur > 0, total, vals, labels, compare };
}
// Empty = still filling, nobody but the creator, no money in, nothing written to Solana.
const isEmpty = c => c.status === 'filling' && c.members.length <= 1 && !c.members.some(m => m.deposit || m.paid) && !(c.chain || []).length;
const empties = () => Object.values(db.circles).filter(isEmpty).map(c => ({ id: c.id, name: c.name, created: c.created, owner: (db.users[c.owner] || {}).name || '' }));
function cleanup(ids) {
  const done = [];
  for (const id of ids || []) { const c = db.circles[id]; if (c && isEmpty(c)) { delete db.circles[id]; for (const k of Object.keys(db.refs)) if (db.refs[k] && db.refs[k].cid === id) delete db.refs[k]; done.push(id); } }
  if (done.length) require('./store').save(); return { deleted: done.length };
}
module.exports = { feeTrend, series, empties, cleanup, isAdmin, overview, trace, problems };
