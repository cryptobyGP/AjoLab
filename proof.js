// On-chain proof: every key event in a circle is added to a hash chain, then written to Solana devnet as a Memo.
// The money still moves through Paga. Solana only holds a record nobody can edit afterwards.
// Memos hold no names, emails or phone numbers: only the circle id, the event, the round, and a hash that covers the details.
const crypto = require('crypto');
const sol = require('./sol');
const { db, save } = require('./store');

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ZERO = '0'.repeat(64);
const MAX_TRIES = 30;
const off = () => process.env.SOL_ANCHOR === 'off';

/* ---------- small helpers: base58 and a signed transaction, with no packages ---------- */
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58e(buf) {
  let n = BigInt('0x0' + buf.toString('hex')), s = '';
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58d(str) {
  let n = 0n;
  for (const ch of str) { const i = A.indexOf(ch); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  let z = 0; for (const ch of str) { if (ch === '1') z++; else break; }
  return Buffer.concat([Buffer.alloc(z), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')]);
}
const shortvec = n => { const out = []; do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };

function keypair(seed) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { priv, pub, address: b58e(pub) };
}
// The key that pays the (tiny) network fee. Use SOL_RECORDER_KEY in Render. Without it, a devnet-only key is made once and kept in the data store.
function recorder() {
  const env = (process.env.SOL_RECORDER_KEY || '').trim();
  let seed;
  if (env) { seed = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : b58d(env).subarray(0, 32); if (seed.length !== 32) throw new Error('SOL_RECORDER_KEY is not a valid key'); }
  else { db.meta = db.meta || {}; if (!db.meta.recorderSeed) { db.meta.recorderSeed = crypto.randomBytes(32).toString('hex'); save(); } seed = Buffer.from(db.meta.recorderSeed, 'hex'); }
  return keypair(seed);
}

// Build and sign a transaction with one Memo instruction.
function memoTx(kp, text, blockhash) {
  const data = Buffer.from(text, 'utf8');
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),                                  // 1 signer, 0 read-only signers, 1 read-only unsigned (the memo program)
    shortvec(2), kp.pub, b58d(MEMO_PROGRAM),                 // accounts: fee payer, memo program
    b58d(blockhash),
    shortvec(1), Buffer.from([1]), shortvec(0), shortvec(data.length), data   // one instruction: program index 1, no accounts, the memo
  ]);
  const sig = crypto.sign(null, message, kp.priv);
  return { tx: Buffer.concat([shortvec(1), sig, message]), signature: b58e(sig), message, sig };
}

/* ---------- the hash chain ---------- */
const refOf = (c, m) => crypto.createHash('sha256').update(c.id + ':' + m.id).digest('hex').slice(0, 8);   // a seat code, not a name
const hashOf = (cid, e) => crypto.createHash('sha256').update([cid, e.seq, e.at, e.kind, JSON.stringify(e.d), e.prev].join('|')).digest('hex');

function record(c, kind, d) {
  c.chain = c.chain || [];
  const prev = c.chain.length ? c.chain[c.chain.length - 1].hash : ZERO;
  const e = { seq: c.chain.length + 1, at: Date.now(), kind, d: d || {}, prev };
  e.hash = hashOf(c.id, e); c.chain.push(e);
  if (!off()) setImmediate(() => anchorPending().catch(() => {}));
  return e;
}
function verifyChain(c) {
  let prev = ZERO;
  for (const e of c.chain || []) { if (e.prev !== prev || e.hash !== hashOf(c.id, e)) return false; prev = e.hash; }
  return true;
}
const memoFor = (c, e) => `AjoLabs v1|${c.id}|${e.seq}|${e.kind}|${e.hash}`;

/* ---------- writing to Solana (best effort: a failure never stops a payment) ---------- */
let running = false, lastAirdrop = 0, lastError = '';
async function ensureFunds(kp) {
  const b = (await sol.rpc('getBalance', [kp.address])).value || 0;
  if (b >= 5000000 || Date.now() - lastAirdrop < 10 * 60000) return;
  lastAirdrop = Date.now();
  try { await sol.rpc('requestAirdrop', [kp.address, 1e9]); console.log('Proof wallet asked for devnet SOL:', kp.address); } catch (e) { console.error('Proof wallet needs devnet SOL, send some to', kp.address, '(' + e.message + ')'); }
}
async function send(kp, text) {
  const bh = (await sol.rpc('getLatestBlockhash', [{ commitment: 'finalized' }])).value.blockhash;
  const t = memoTx(kp, text, bh);
  const got = await sol.rpc('sendTransaction', [t.tx.toString('base64'), { encoding: 'base64' }]);
  return got || t.signature;
}
async function confirmSent() {
  const pend = [];
  for (const c of Object.values(db.circles)) for (const e of c.chain || []) if (e.sig && !e.ok) pend.push(e);
  if (!pend.length) return;
  const batch = pend.slice(0, 50);
  const r = await sol.rpc('getSignatureStatuses', [batch.map(e => e.sig), { searchTransactionHistory: true }]);
  r.value.forEach((s, i) => {
    const e = batch[i];
    if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) e.ok = true;
    else if ((s && s.err) || Date.now() - (e.anchoredAt || 0) > 120000) { e.sig = null; e.tries = (e.tries || 0) + 1; }   // dropped or failed: send it again
  });
  save();
}
async function anchorPending() {
  if (running || off()) return; running = true;
  try {
    const kp = recorder(); let funded = false;
    for (const c of Object.values(db.circles)) {
      for (const e of c.chain || []) {
        if (e.sig || (e.tries || 0) >= MAX_TRIES) continue;
        try {
          if (!funded) { await ensureFunds(kp); funded = true; }
          e.sig = await send(kp, memoFor(c, e)); e.anchoredAt = Date.now(); e.err = undefined; lastError = ''; save();
        } catch (err) { e.tries = (e.tries || 0) + 1; e.err = String(err.message).slice(0, 120); lastError = e.err; save(); return; }   // stop here so records stay in order
      }
    }
    await confirmSent();
  } catch (e) { lastError = e.message; console.error('Proof anchoring:', e.message); }
  finally { running = false; }
}

/* ---------- what the screens see ---------- */
function summary(c) {
  const chain = c.chain || [];
  let address = ''; try { address = recorder().address; } catch {}
  return { network: 'devnet', recorder: address, total: chain.length, confirmed: chain.filter(e => e.ok).length, valid: verifyChain(c), live: !off(),
    last: chain.slice(-8).reverse().map(e => ({ seq: e.seq, kind: e.kind, round: e.d.round || null, at: e.at, hash: e.hash.slice(0, 10), sig: e.sig || null, ok: !!e.ok })) };
}
const publicChain = c => ({ circle: c.id, network: 'devnet', recorder: (() => { try { return recorder().address; } catch { return ''; } })(), valid: verifyChain(c),
  entries: (c.chain || []).map(e => ({ seq: e.seq, at: e.at, kind: e.kind, data: e.d, prev: e.prev, hash: e.hash, sig: e.sig || null, confirmed: !!e.ok })) });

module.exports = { record, refOf, summary, publicChain, anchorPending, verifyChain, memoTx, keypair, b58e, b58d, MEMO_PROGRAM, hashOf, get lastError() { return lastError; } };
