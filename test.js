// End-to-end tests in mock mode: node test.js
process.env.PAGA_MODE = 'mock'; process.env.DB_FILE = './test-data.json';
require('fs').rmSync('./test-data.json', { force: true });
const assert = require('assert'); const circle = require('./circle');
const mk = i => ({ name: ['Emem', 'Tunde', 'Amina', 'Nne', 'Yusuf'][i], phone: '08000000' + i + '0' + i, bankCode: '058', accountNumber: '01234567' + i + '0' });
const logs = c => c.ledger.map(l => l.text);

async function pay(c, who, kind) { const r = await circle.requestPayment(c.id, who.id, kind); return circle.markPaid(r.reference); }
async function fill() {
  let c = circle.createCircle({ name: 'T', amount: 5000, maxMembers: 5, cycleDays: 7, creator: mk(0) });
  for (let i = 1; i < 5; i++) circle.joinCircle(c.id, mk(i));
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
  const L = logs(c); assert.ok(L.some(t => /Payout: NGN 22,750 to Emem/.test(t)), 'round 1 payout');
  assert.equal(L.filter(t => /Holdback released/.test(t)).length, 10, 'holdback releases');
  assert.equal(L.filter(t => /Deposit returned/.test(t)).length, 5);
  c.members.forEach(m => assert.equal(m.hb, 0)); c.members.forEach(m => assert.equal(m.deposit, 0));
  assert.equal(circle.status(id).members[0].tierPct, 5);          // finished one circle, now 5%

  // 2. Missed payment: settlement covers from holdback, deposit, pool; default mark added
  c = await fill(); const id2 = c.id;
  for (const m of c.members.filter(x => x.name !== 'Tunde')) await pay(c, m);
  assert.equal(circle.status(id2).canSettle, false);
  circle.skipTime(id2); assert.equal(circle.status(id2).canSettle, true);
  await circle.settle(id2); c = circle.status(id2);
  assert.equal(c.round, 2, 'round advanced after settlement');
  const t = c.members.find(x => x.name === 'Tunde'); assert.equal(t.deposit, 0, 'deposit used'); assert.equal(t.defaulted, true);
  assert.ok(logs(c).some(x => /Tunde missed round 1.*NGN 5,000 from deposit.*Default mark/.test(x)));
  assert.ok(circle.status(id2).members.find(x => x.name === 'Tunde').tierLabel.includes('default mark'));

  console.log(logs(c).map(x => '- ' + x).join('\n')); console.log('\nALL PASSED');
  require('fs').rmSync('./test-data.json', { force: true });
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
