// End-to-end tests in mock mode: node test.js
process.env.PAGA_MODE = 'mock'; process.env.DB_FILE = './test-data.json';
require('fs').rmSync('./test-data.json', { force: true });
const assert = require('assert'); const circle = require('./circle');
const names = ['Emem', 'Tunde', 'Amina', 'Nne', 'Yusuf'];
const U = i => 'u' + i;
function users() { names.forEach((n, i) => { circle.upsertUser(U(i), n.toLowerCase() + '@x.com'); circle.profile(U(i), { name: n, phone: '0800000' + i, bank: { code: '058', name: 'GTBank', account: '01234567' + i + '0' } }); }); }
users();
const logs = c => c.ledger.map(l => l.text);

async function pay(c, who, kind) { const r = await circle.requestPayment(c.id, who.id, kind); return circle.markPaid(r.reference); }
async function fill() {
  let c = circle.createCircle({ name: 'T', amount: 5000, maxMembers: 5, cycleDays: 7 }, U(0));
  for (let i = 1; i < 5; i++) circle.joinCircle(c.id, U(i));
  c = circle.status(c.id); assert.equal(c.status, 'deposits');
  for (const m of c.members) await pay(c, m, 'deposit');
  c = circle.status(c.id); assert.equal(c.status, 'active'); return c;
}

(async () => {
  // 1. Happy path: deposit, holdback, releases, deposit returned, trust updated
  let c = await fill(); const id = c.id;
  for (let r = 1; r <= 5; r++) {
    c = circle.status(id);
    if (r === 1) { assert.equal(c.receiverHoldback, 2000); assert.equal(c.receiverNet, 22750); }   // 10% of 20,000 owed later
    for (const m of c.members) await pay(c, m);
  }
  c = circle.status(id); assert.equal(c.status, 'completed');
  const L = logs(c); assert.ok(L.some(t => /Payout: ₦22,750 to Emem/.test(t)), 'round 1 payout');
  assert.equal(L.filter(t => /Holdback released/.test(t)).length, 10, 'holdback releases');
  assert.equal(L.filter(t => /Deposit returned/.test(t)).length, 5);
  c.members.forEach(m => assert.equal(m.hb, 0)); c.members.forEach(m => assert.equal(m.deposit, 0));
  assert.equal(circle.status(id, 'u0').members[0].tierPct, 5);          // finished one circle, now 5%

  const e = circle.getUser('u0');
  assert.ok(e.wallet > 22750, 'payout landed in wallet'); assert.ok(e.receipts.some(r => r.title === 'Payout received' && r.amount === 22750), 'receipt');
  assert.ok(e.notes.length > 5, 'notifications');
  const before = e.wallet; await circle.withdraw('u0', 10000); assert.equal(circle.getUser('u0').wallet, before - 10000);
  assert.equal(circle.getUser('u0').receipts[0].title, 'Transfer to bank');
  await assert.rejects(() => circle.withdraw('u0', 99999999), /Not enough/);
  assert.equal(circle.getUser('u0').finished, 1);

  // balance funding and pay-from-balance
  circle.upsertUser('u9', 'n@x.com'); circle.profile('u9', { name: 'Nne2', phone: '0800000999' });
  const a1 = (await circle.account('u9')).account; assert.equal((await circle.account('u9')).account.number, a1.number); assert.equal(a1.name, 'Nne2');
  circle.fund('u9', 5000, 'f1'); circle.fund('u9', 5000, 'f1'); assert.equal(circle.getUser('u9').wallet, 5000, 'fund is idempotent');
  const pc = circle.createCircle({ name: 'P', amount: 5000, maxMembers: 3, cycleDays: 7 }, 'u9'); circle.joinCircle(pc.id, 'u1'); circle.joinCircle(pc.id, 'u2');
  const pm = circle.status(pc.id, 'u9').myId; await circle.payFromBalance(pc.id, pm, 'u9', 'deposit');
  assert.equal(circle.getUser('u9').wallet, 0); assert.ok(circle.status(pc.id, 'u9').members[0].deposit);
  await assert.rejects(() => circle.payFromBalance(pc.id, pm, 'u9', 'deposit'), /balance/);

  // 2. Missed payment: settlement covers from holdback, deposit, pool; default mark added
  c = await fill(); const id2 = c.id;
  for (const m of c.members.filter(x => x.name !== 'Tunde')) await pay(c, m);
  assert.equal(circle.status(id2).canSettle, false);
  circle.skipTime(id2); assert.equal(circle.status(id2).canSettle, true);
  await circle.settle(id2); c = circle.status(id2);
  assert.equal(c.round, 2, 'round advanced after settlement');
  const t = c.members.find(x => x.name === 'Tunde'); assert.equal(t.deposit, 0, 'deposit used'); assert.equal(t.defaulted, true);
  assert.ok(logs(c).some(x => /Tunde missed round 1.*₦5,000 from deposit.*Default mark/.test(x)));
  assert.ok(circle.status(id2).members.find(x => x.name === 'Tunde').tierLabel.includes('default mark'));

  console.log(logs(c).map(x => '- ' + x).join('\n')); console.log('\nALL PASSED');
  require('fs').rmSync('./test-data.json', { force: true });
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
