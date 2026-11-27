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

/* ---------- a tiny transaction builder (no packages) ---------- */
const SYSTEM = '11111111111111111111111111111111', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const sv = n => { const o = []; do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
// ix = { program, keys: [{ pub, signer, writable }], data }. Accounts are ordered the way Solana wants them.
function compile(kp, ixs, blockhash) {
  const m = new Map(), put = (k, signer, writable) => { const id = k.toString('hex'), e = m.get(id) || { k, signer: false, writable: false }; e.signer ||= signer; e.writable ||= writable; m.set(id, e); };
  put(kp.pub, true, true); for (const ix of ixs) { for (const k of ix.keys) put(k.pub, !!k.signer, !!k.writable); put(ix.program, false, false); }
  const all = [...m.values()], g = (sg, w) => all.filter(e => e.signer === sg && e.writable === w), order = [...g(true, true), ...g(true, false), ...g(false, true), ...g(false, false)];
  const idx = k => order.findIndex(e => e.k.equals(k));
  const body = [Buffer.from([order.filter(e => e.signer).length, g(true, false).length, g(false, false).length]), sv(order.length), ...order.map(e => e.k), proof.b58d(blockhash), sv(ixs.length)];
  for (const ix of ixs) body.push(Buffer.from([idx(ix.program)]), sv(ix.keys.length), Buffer.from(ix.keys.map(k => idx(k.pub))), sv(ix.data.length), ix.data);
  const message = Buffer.concat(body), sig = crypto.sign(null, message, kp.priv);
  return { tx: Buffer.concat([Buffer.from([1]), sig, message]), sig };
}
async function submit(ixs) {
  const kp = wallet(), bh = (await sol.rpc('getLatestBlockhash', [{ commitment: 'finalized' }])).value.blockhash, t = compile(kp, ixs, bh);
  return (await sol.rpc('sendTransaction', [t.tx.toString('base64'), { encoding: 'base64' }])) || proof.b58e(t.sig);
}
const pk = a => { const b = proof.b58d(a); if (b.length !== 32) throw new Error('That wallet address is not valid'); return b; };

// One system transfer, signed here. Returns the signature once the network has accepted it (not yet confirmed).
async function send(to, lamports) {
  const data = Buffer.alloc(12); data.writeUInt32LE(2, 0); data.writeBigUInt64LE(BigInt(lamports), 4);
  return submit([{ program: pk(SYSTEM), keys: [{ pub: wallet().pub, signer: true, writable: true }, { pub: pk(to), writable: true }], data }]);
}

/* ---------- USDC ---------- */
const P = 2n ** 255n - 19n, D = (P - 121665n * modpow(121666n, P - 2n, P) % P) % P;
function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
// Is this 32-byte value a point on the ed25519 curve? A program-derived address must NOT be.
function onCurve(buf) {
  const b = Buffer.from(buf); b[31] &= 0x7f; let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]);
  const y2 = y * y % P, u = (y2 - 1n + P) % P, v = (D * y2 + 1n) % P; if (u === 0n) return true;
  return modpow(u * modpow(v, P - 2n, P) % P, (P - 1n) / 2n, P) === 1n;
}
function ataOf(owner, mint) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash('sha256').update(Buffer.concat([owner, pk(TOKEN), mint, Buffer.from([bump]), pk(ATA), Buffer.from('ProgramDerivedAddress')])).digest();
    if (!onCurve(h)) return h;
  }
  throw new Error('no address');
}
async function usdcAccounts(owner) {           // [{ address, units }] for the USDC token accounts an owner already has
  const mint = sol.config().usdcMint, r = await sol.rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]).catch(() => ({ value: [] }));
  return (r.value || []).map(a => ({ address: a.pubkey, units: Number(a.account.data.parsed.info.tokenAmount.amount) }));
}
const usdcBalance = async () => (await usdcAccounts(wallet().address)).reduce((n, a) => n + a.units, 0);
const toUnits = naira => Math.floor(naira / NGN_PER_USD * 1e6);
async function sendUsdc(to, units) {
  const kp = wallet(), mint = pk(sol.config().usdcMint), src = (await usdcAccounts(kp.address)).find(a => a.units >= units);
  if (!src) throw new Error('Wallet payouts in USDC are being topped up. Please try again later.');
  const have = (await usdcAccounts(to))[0], ixs = [];
  let dest; if (have) dest = pk(have.address);
  else { dest = ataOf(pk(to), mint);                 // the user has no USDC account yet: create it (we pay the small rent)
    ixs.push({ program: pk(ATA), keys: [{ pub: kp.pub, signer: true, writable: true }, { pub: dest, writable: true }, { pub: pk(to) }, { pub: mint }, { pub: pk(SYSTEM) }, { pub: pk(TOKEN) }], data: Buffer.from([1]) }); }
  const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(BigInt(units), 1); data[9] = 6;   // TransferChecked, 6 decimals
  ixs.push({ program: pk(TOKEN), keys: [{ pub: pk(src.address), writable: true }, { pub: mint }, { pub: dest, writable: true }, { pub: kp.pub, signer: true }], data });
  return submit(ixs);
}
// 'ok', 'failed' or 'waiting'
async function status(sig) {
  const r = await sol.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]), s = r.value[0];
  if (!s) return 'waiting'; if (s.err) return 'failed';
  return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'ok' : 'waiting';
}
module.exports = { wallet, balance, usdcBalance, topUp, send, sendUsdc, status, toLamports, toUnits, onCurve, ataOf, compile, FEE };
