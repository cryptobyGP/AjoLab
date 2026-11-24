// Solana devnet helpers (plain JSON-RPC, no packages). Shows wallet balances in dollars and verifies wallet payments.
const RPC = process.env.SOL_RPC || 'https://api.devnet.solana.com';
const TREASURY = (process.env.SOL_TREASURY || '').trim();                  // devnet address that receives wallet payments
const SOL_USD = Number(process.env.SOL_USD || 150);                         // fixed demo price, devnet SOL has no real value
const NGN_PER_USD = Number(process.env.NGN_PER_USD || 1500);                // fixed demo rate
const USDC_MINT = process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GfPPjkWQEwFYk7M2zz';   // Circle's devnet USDC

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('Solana network: ' + ((d.error && d.error.message) || r.status));
  return d.result;
}
const config = () => ({ treasury: TREASURY, solUsd: SOL_USD, ngnPerUsd: NGN_PER_USD, usdcMint: USDC_MINT, network: 'devnet' });

async function balances(address) {
  const [b, t] = await Promise.all([rpc('getBalance', [address]), rpc('getTokenAccountsByOwner', [address, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]).catch(() => ({ value: [] }))]);
  const sol = (b.value || 0) / 1e9;
  const usdc = (t.value || []).reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  const usd = Math.round((usdc + sol * SOL_USD) * 100) / 100;
  return { address, sol, usdc, solUsd: Math.round(sol * SOL_USD * 100) / 100, totalUsd: usd, ...config() };
}

// Check a wallet payment sent to the treasury: either a SOL transfer or a USDC transfer, from the user's linked wallet.
// Returns { pending } or { token, lamports, usdc, naira }.
async function verifyPayment(signature, fromAddress) {
  if (!TREASURY) throw new Error('Wallet payments are not set up yet');
  const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx) return { pending: true };
  if (tx.meta && tx.meta.err) throw new Error('That wallet payment failed on Solana');
  const signers = (tx.transaction.message.accountKeys || []).filter(k => k.signer).map(k => k.pubkey);
  if (!signers.includes(fromAddress)) throw new Error('That payment was not signed by your connected wallet');
  const ix = (tx.transaction.message.instructions || []).find(i => i.program === 'system' && i.parsed && i.parsed.type === 'transfer' && i.parsed.info.source === fromAddress && i.parsed.info.destination === TREASURY);
  if (ix) { const lamports = Number(ix.parsed.info.lamports); return { token: 'SOL', lamports, usdc: 0, naira: Math.floor(lamports / 1e9 * SOL_USD * NGN_PER_USD) }; }
  // USDC: the treasury's USDC balance must have gone up in this transaction, and the sender's must have gone down
  const bal = (list, owner) => (list || []).filter(b => b.owner === owner && b.mint === USDC_MINT).reduce((n, b) => n + Number(b.uiTokenAmount.amount), 0);
  const gained = bal(tx.meta.postTokenBalances, TREASURY) - bal(tx.meta.preTokenBalances, TREASURY);
  const spent = bal(tx.meta.preTokenBalances, fromAddress) - bal(tx.meta.postTokenBalances, fromAddress);
  if (gained > 0 && spent >= gained) { const usdc = gained / 1e6; return { token: 'USDC', lamports: 0, usdc, naira: Math.floor(usdc * NGN_PER_USD) }; }
  throw new Error('That payment did not go from your wallet to AjoLabs');
}
module.exports = { balances, verifyPayment, config, rpc };
