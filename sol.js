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
const config = () => ({ treasury: TREASURY, solUsd: SOL_USD, ngnPerUsd: NGN_PER_USD, network: 'devnet' });

async function balances(address) {
  const [b, t] = await Promise.all([rpc('getBalance', [address]), rpc('getTokenAccountsByOwner', [address, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]).catch(() => ({ value: [] }))]);
  const sol = (b.value || 0) / 1e9;
  const usdc = (t.value || []).reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  const usd = Math.round((usdc + sol * SOL_USD) * 100) / 100;
  return { address, sol, usdc, solUsd: Math.round(sol * SOL_USD * 100) / 100, totalUsd: usd, ...config() };
}

// Check a wallet payment: a SOL transfer from the user's linked wallet to the treasury. Returns { pending } or { lamports, naira }.
async function verifyPayment(signature, fromAddress) {
  if (!TREASURY) throw new Error('Wallet payments are not set up yet');
  const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx) return { pending: true };
  if (tx.meta && tx.meta.err) throw new Error('That wallet payment failed on Solana');
  const ix = (tx.transaction.message.instructions || []).find(i => i.program === 'system' && i.parsed && i.parsed.type === 'transfer' && i.parsed.info.source === fromAddress && i.parsed.info.destination === TREASURY);
  if (!ix) throw new Error('That payment did not go from your wallet to AjoLabs');
  const lamports = Number(ix.parsed.info.lamports);
  return { lamports, naira: Math.floor(lamports / 1e9 * SOL_USD * NGN_PER_USD) };
}
module.exports = { balances, verifyPayment, config, rpc };
