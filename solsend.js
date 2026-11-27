// Sends devnet SOL from AjoLabs' own payout wallet to a user's connected wallet. Devnet only: the coins have no real value.
const crypto = require('crypto');
const sol = require('./sol'), proof = require('./proof');
const { db, save } = require('./store');
const SOL_USD = sol.config().solUsd, NGN_PER_USD = sol.config().ngnPerUsd;
const FEE = 10000;                                    // lamports kept back for the network fee
const toLamports = naira => Math.floor(naira / (SOL_USD * NGN_PER_USD) * 1e9);

function wallet() {
  const env = (process.env.SOL_PAYOUT_KEY || '').trim(); let seed;
  if (env) { seed = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : proof.b58d(env).subarray(0, 32); if (seed.length !== 32) throw new Error('SOL_PAYOUT_KEY is not a valid key'); }
  else { db.meta = db.meta || {}; if (!db.meta.payoutSeed) { db.meta.payoutSeed = crypto.randomBytes(32).toString('hex'); save(); } seed = Buffer.from(db.meta.payoutSeed, 'hex'); }
  return proof.keypair(seed);
}
const balance = async () => (await sol.rpc('getBalance', [wallet().address])).value || 0;

let lastAirdrop = 0;
async function topUp() {                              // best effort: the devnet faucet is often rate limited
  if (Date.now() - lastAirdrop < 10 * 60000) return; lastAirdrop = Date.now();
  try { await sol.rpc('requestAirdrop', [wallet().address, 2e9]); } catch (e) { console.error('Payout wallet needs devnet SOL, send some to', wallet().address, '(' + e.message + ')'); }
}

// One system transfer, signed here. Returns the signature once the network has accepted it (not yet confirmed).
async function send(to, lamports) {
  const kp = wallet(), dest = proof.b58d(to); if (dest.length !== 32) throw new Error('That wallet address is not valid');
  const data = Buffer.alloc(12); data.writeUInt32LE(2, 0); data.writeBigUInt64LE(BigInt(lamports), 4);
  const bh = (await sol.rpc('getLatestBlockhash', [{ commitment: 'finalized' }])).value.blockhash;
  const message = Buffer.concat([Buffer.from([1, 0, 1]), Buffer.from([3]), kp.pub, dest, Buffer.alloc(32), proof.b58d(bh),
    Buffer.from([1, 2, 2, 0, 1, 12]), data]);   // 1 instruction: program #2 (system), 2 accounts (0 from, 1 to), 12 bytes of data
  const sig = crypto.sign(null, message, kp.priv);
  const tx = Buffer.concat([Buffer.from([1]), sig, message]);
  return (await sol.rpc('sendTransaction', [tx.toString('base64'), { encoding: 'base64' }])) || proof.b58e(sig);
}
// 'ok', 'failed' or 'waiting'
async function status(sig) {
  const r = await sol.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]), s = r.value[0];
  if (!s) return 'waiting'; if (s.err) return 'failed';
  return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'ok' : 'waiting';
}
module.exports = { wallet, balance, topUp, send, status, toLamports, FEE };
