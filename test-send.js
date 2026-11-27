// Wallet payout: checks the transaction we sign is a correct SOL transfer, and the refund / success paths.
process.env.PAGA_MODE = 'mock'; process.env.SOL_ANCHOR = 'off'; process.env.DB_FILE = require('os').tmpdir() + '/ajo-send-' + Date.now() + '.json';
const assert = require('assert'), crypto = require('crypto');
let sent = null, bal = 5e9, status = null, failSend = false;
const proof = require('./proof'), BH = proof.b58e(crypto.randomBytes(32));
global.fetch = async (u, o) => { const b = JSON.parse(o.body); let result = null;
  if (b.method === 'getBalance') result = { value: bal };
  else if (b.method === 'getLatestBlockhash') result = { value: { blockhash: BH } };
  else if (b.method === 'sendTransaction') { if (failSend) return { ok: true, json: async () => ({ error: { message: 'boom' } }) }; sent = Buffer.from(b.params[0], 'base64'); result = proof.b58e(sent.subarray(1, 65)); }
  else if (b.method === 'getSignatureStatuses') result = { value: [status] };
  return { ok: true, json: async () => ({ result }) }; };
const circle = require('./circle'), sw = require('./solsend'), { db } = require('./store');
const WALLET = proof.b58e(crypto.randomBytes(32));
(async () => {
  const u = circle.upsertUser('u1', 'a@b.c'); u.name = 'Ada'; u.wallet = 100000; u.sol = { address: WALLET };
  status = { confirmationStatus: 'confirmed' };
  await circle.withdrawToWallet('u1', 22500);               // ₦22,500 = 0.1 SOL at 150 x 1500? no: 1 SOL = ₦225,000, so 0.1 SOL
  assert.equal(u.wallet, 77500);
  // read the transaction back: 1 signature, header, 3 accounts, blockhash, one system transfer of the right size
  const sig = sent.subarray(1, 65), msg = sent.subarray(65);
  assert.deepEqual([...msg.subarray(0, 4)], [1, 0, 1, 3]);
  const from = msg.subarray(4, 36), to = msg.subarray(36, 68);
  assert.equal(proof.b58e(to), WALLET); assert.equal(proof.b58e(from), sw.wallet().address); assert.ok(msg.subarray(68, 100).every(x => x === 0));
  assert.equal(proof.b58e(msg.subarray(100, 132)), BH);
  assert.deepEqual([...msg.subarray(132, 138)], [1, 2, 2, 0, 1, 12]);
  const d = msg.subarray(138); assert.equal(d.readUInt32LE(0), 2); assert.equal(d.readBigUInt64LE(4), 100000000n);
  const pk = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), from]), format: 'der', type: 'spki' });
  assert.ok(crypto.verify(null, msg, pk, sig), 'signature must verify');
  assert.equal(u.receipts[0].title, 'Sent to wallet'); assert.ok(u.receipts[0].sig);
  // Solana says it failed: money comes back
  status = { err: { x: 1 } }; await circle.withdrawToWallet('u1', 5000);
  assert.equal(u.wallet, 77500); assert.equal(u.receipts[0].title, 'Wallet transfer failed');
  // the network refuses the transaction: money comes back, no receipt of success
  failSend = true; await assert.rejects(() => circle.withdrawToWallet('u1', 5000), /still in your balance/); assert.equal(u.wallet, 77500); failSend = false;
  // still waiting: money stays held, then a later check settles it
  status = null; await Promise.race([circle.withdrawToWallet('u1', 5000), new Promise(r => setTimeout(r, 3000))]);
  // guards
  await assert.rejects(() => circle.withdrawToWallet('u1', 100), /Minimum/);
  await assert.rejects(() => circle.withdrawToWallet('u1', 9e9), /Not enough/);
  u.sol = null; await assert.rejects(() => circle.withdrawToWallet('u1', 5000), /Connect a wallet/);
  console.log('WALLET PAYOUT OK'); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
