// End-to-end tests in mock mode: node test.js
process.env.PAGA_MODE = 'mock'; process.env.DB_FILE = './test-data.json'; process.env.SOL_ANCHOR = 'off';
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

  // 3. Ajo Score: on-time payments are recorded, a missed one is a default mark
  const tu = circle.getUser(U(1)), other = circle.getUser(U(2));   // Tunde missed; Amina paid every round on time
  assert.equal(circle.pub(tu).ajo.missed, 1, 'missed payment counted once');
  assert.ok(circle.pub(other).ajo.onTime >= 1, 'on-time payment recorded');
  assert.equal(circle.pub(other).ajo.late, 0);
  assert.ok(circle.pub(tu).ajo.score < circle.pub(other).ajo.score, 'defaulter scores lower');
  assert.ok(circle.status(id2).members.every(x => typeof x.ajoLevel === 'string'));

  // 4. On-chain proof: events are hash-chained, hold no personal details, and a tampered record is caught
  const proof = require('./proof'), pf = circle.proofOf(id), kinds = pf.entries.map(e => e.kind);
  assert.equal(pf.valid, true, 'chain verifies');
  assert.equal(kinds[0], 'started'); assert.equal(kinds.filter(k => k === 'payment').length, 25, '5 members x 5 rounds'); assert.equal(kinds.filter(k => k === 'payout').length, 5); assert.equal(kinds.at(-1), 'completed');
  assert.ok(!JSON.stringify(pf).match(/emem|tunde|@x\.com|0800000|GTBank/i), 'no personal details in the record');
  assert.ok(circle.proofOf(id2).entries.some(e => e.kind === 'missed'), 'missed payment recorded');
  const live = require('./store').db.circles[id]; live.chain[3].data = null; const keep = live.chain[3].d; live.chain[3].d = { round: 99 };
  assert.equal(proof.verifyChain(live), false, 'edited record is caught'); live.chain[3].d = keep; assert.equal(proof.verifyChain(live), true);

  // 5. Solana memo transaction: valid layout and a valid signature
  assert.equal(proof.b58d(proof.MEMO_PROGRAM).length, 32, 'memo program id decodes to 32 bytes');
  assert.equal(proof.b58e(proof.b58d(proof.MEMO_PROGRAM)), proof.MEMO_PROGRAM, 'base58 round trip');
  const kp = proof.keypair(Buffer.alloc(32, 7)), bh = proof.b58e(Buffer.alloc(32, 9)), mt = proof.memoTx(kp, 'AjoLabs v1|test', bh);
  assert.ok(require('crypto').verify(null, mt.message, require('crypto').createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), kp.pub]), format: 'der', type: 'spki' }), mt.sig), 'signature checks out');
  assert.equal(mt.tx[0], 1); assert.equal(mt.tx.length, 1 + 64 + mt.message.length); assert.ok(mt.message.slice(-'AjoLabs v1|test'.length).toString() === 'AjoLabs v1|test');

  // 6. Sending: a pretend Solana network. Records go out in order, a failure retries later, and confirmation is tracked
  process.env.SOL_ANCHOR = 'on'; const sent = []; let failNext = true; const realFetch = global.fetch;
  global.fetch = async (url, o) => { const b = JSON.parse(o.body), ok = r => ({ ok: true, json: async () => ({ result: r }) });
    if (b.method === 'getBalance') return ok({ value: 2e9 });
    if (b.method === 'getLatestBlockhash') return ok({ value: { blockhash: proof.b58e(Buffer.alloc(32, 3)) } });
    if (b.method === 'sendTransaction') { if (failNext) { failNext = false; return { ok: true, json: async () => ({ error: { message: 'blockhash not found' } }) }; } const raw = Buffer.from(b.params[0], 'base64'); sent.push(raw); return ok(proof.b58e(raw.subarray(1, 65))); }
    if (b.method === 'getSignatureStatuses') return ok({ value: b.params[0].map(() => ({ err: null, confirmationStatus: 'confirmed' })) });
    throw new Error('unexpected rpc ' + b.method); };
  const c3 = circle.proofOf(id2).entries.length; await proof.anchorPending();
  assert.equal(sent.length, 0, 'first attempt failed and stopped'); await proof.anchorPending();
  assert.ok(sent.length >= c3, 'retry sent the records'); const after = circle.proofOf(id2);
  assert.ok(after.entries.every(e => e.sig && e.confirmed), 'every record has a signature and is confirmed');
  assert.ok(sent.some(r => /AjoLabs v1\|/.test(r.toString('latin1'))), 'memo text is in the transaction');
  global.fetch = realFetch; process.env.SOL_ANCHOR = 'off';

  // 8. Goals: a known goal is kept, anything else is dropped
  { const g1 = circle.createCircle({ name: 'G1', amount: 5000, maxMembers: 3, cycleDays: 7, goal: 'detty' }, U(0)), g2 = circle.createCircle({ name: 'G2', amount: 5000, maxMembers: 3, cycleDays: 7, goal: '<script>' }, U(0)), g3 = circle.createCircle({ name: 'G3', amount: 5000, maxMembers: 3, cycleDays: 7 }, U(0));
    assert.equal(circle.status(g1.id, U(0)).goal, 'detty'); assert.equal(circle.status(g2.id, U(0)).goal, null); assert.equal(circle.status(g3.id, U(0)).goal, null); assert.equal(circle.preview(g1.id).goal, 'detty'); }

  // 7. Reminders: once before the deadline, once when late, never to someone who has paid, never twice
  {
    const rc = await fill(), live = require('./store').db.circles[rc.id], HOUR = 3600e3;
    const titles = u => circle.getUser(u).notes.filter(n => /^Payment (due soon|overdue|late)/.test(n.title)).map(n => n.title);
    assert.equal(circle.remind(live), 0, 'too early for a reminder');
    live.shift = 19 * HOUR; assert.equal(circle.remind(live), 5, 'due-soon notice to all five'); assert.equal(circle.remind(live), 0, 'not sent twice');
    await pay(rc, circle.status(rc.id).members[1]);                                   // one member pays
    live.shift = 25 * HOUR; assert.equal(circle.remind(live), 4, 'late notice only to those who have not paid'); assert.equal(circle.remind(live), 0);
    assert.deepEqual(titles(live.members[1].uid), ['Payment due soon'], 'the member who paid gets no late notice');
    assert.ok(titles(live.members[2].uid).includes('Payment overdue'));
  }

  { // chat connector: read-only, private link
    const cn = require('./connector'), tok = cn.create(U(0));
    assert.ok(/^ajo_[0-9a-f]{48}$/.test(tok) && cn.userByToken(tok).uid === U(0), 'token finds its owner');
    assert.equal(cn.userByToken('ajo_' + '0'.repeat(48)), null, 'unknown token rejected');
    const call = (name, args) => cn.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }, cn.userByToken(tok));
    const init = await cn.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, cn.userByToken(tok));
    assert.equal(init.result.serverInfo.name, 'AjoLabs');
    assert.equal(await cn.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, cn.userByToken(tok)), null, 'notifications get no reply');
    assert.ok(cn.listTools().every(t => t.annotations.readOnlyHint), 'every tool is read only');
    const mine = JSON.parse((await call('my_circles')).result.content[0].text); assert.ok(mine.length >= 1, 'lists circles');
    const st = JSON.parse((await call('circle_status', { circle: mine[0].name })).result.content[0].text); assert.ok(Array.isArray(st.members));
    assert.ok(!JSON.stringify(st).includes('@x.com'), 'no email addresses leak to the assistant');
    assert.ok((await call('circle_status', { circle: 'nope-nope' })).result.isError, 'bad name is a tool error');
    cn.revoke(U(0)); assert.equal(cn.userByToken(tok), null, 'revoked link stops working');
  }

  console.log(logs(c).map(x => '- ' + x).join('\n')); console.log('\nALL PASSED');
  require('fs').rmSync('./test-data.json', { force: true });
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
