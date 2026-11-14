// Paga adapter. Everything that talks to Paga lives here.
// PAGA_MODE=mock -> no network, the full flow works for demos and tests.
// PAGA_MODE=live -> real calls to Paga (sandbox by default, live when PAGA_ENV=live).
//
// Two Paga APIs are used (see developer-docs.paga.com):
//  - Collect API (virtual accounts, checkout, direct debit): Basic auth + `hash` header
//  - Business API (payouts to banks): `principal` + `credentials` + `hash` headers
const crypto = require('crypto');

const MODE = process.env.PAGA_MODE || 'mock';
const LIVE_ENV = process.env.PAGA_ENV === 'live';
const COLLECT = process.env.PAGA_COLLECT_URL || (LIVE_ENV ? 'https://collect.paga.com' : 'https://beta-collect.paga.com');
const BUSINESS = (process.env.PAGA_BUSINESS_URL || (LIVE_ENV ? 'https://www.mypaga.com' : 'https://beta.mypaga.com')) + '/paga-webservices/business-rest/secured';
const PUBLIC_KEY = process.env.PAGA_PUBLIC_KEY || '';
const SECRET_KEY = process.env.PAGA_SECRET_KEY || '';
const HASH_KEY = process.env.PAGA_HMAC_KEY || '';
const HASH_MODE = process.env.PAGA_HASH_MODE || 'sha';   // 'sha' = sha512(fields + hashKey). 'hmac' = HMAC-SHA512 of fields (the docs disagree, so this is switchable)
const PUBLIC_URL = process.env.PUBLIC_URL || '';

const clean = f => f.filter(x => x !== undefined && x !== null && x !== '').join('');
function sign(fields) {
  const s = clean(fields);
  return HASH_MODE === 'hmac' ? crypto.createHmac('sha512', HASH_KEY).update(s).digest('hex') : crypto.createHash('sha512').update(s + HASH_KEY).digest('hex');
}
const sha = s => crypto.createHash('sha512').update(s).digest('hex');
const safeEq = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function collect(path, body, hashFields) {
  const res = await fetch(COLLECT + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(PUBLIC_KEY + ':' + SECRET_KEY).toString('base64'), hash: sign(hashFields) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Paga ${path} failed (${res.status}) ${data.statusMessage || data.message || ''}`.trim());
  return data;
}
async function business(path, body, hashFields) {
  const res = await fetch(BUSINESS + path, { method: 'POST', headers: { 'Content-Type': 'application/json', principal: PUBLIC_KEY, credentials: SECRET_KEY, hash: sha(clean(hashFields) + HASH_KEY) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Paga ${path} failed (${res.status}) ${data.message || ''}`.trim());
  return data;
}

/* ---------- virtual account: each user's own Paga account number ---------- */
async function createAccount({ uid, name, email, phone }) {
  if (MODE === 'mock') { let h = 0; for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) % 100000000; return { number: '99' + String(h).padStart(8, '0'), bank: 'Paga (test)', name }; }
  const accountReference = ('AJO' + sha(uid).slice(0, 20)).toUpperCase();     // 12 to 30 characters, unique per user
  const reference = 'acct-' + sha(uid).slice(0, 16);
  const parts = String(name).trim().split(/\s+/), firstName = parts[0], lastName = parts.slice(1).join(' ') || parts[0];
  const callbackUrl = PUBLIC_URL + '/webhooks/paga-account';
  const body = { referenceNumber: reference, accountName: name, firstName, lastName, accountReference, callbackUrl };
  if (phone) body.phoneNumber = phone; else if (email) body.email = email;
  const d = await collect('/registerPersistentPaymentAccount', body, [reference, accountReference, '', '', '', callbackUrl]);
  if (String(d.statusCode) !== '0' || !d.accountNumber) throw new Error('Paga could not create your account: ' + (d.statusMessage || 'unknown error'));
  return { number: d.accountNumber, bank: 'Paga', name, ref: accountReference };
}
// A deposit into a user's account. Hash: statusCode + accountNumber + amount + clearingFeeAmount + transferFeeAmount + hashKey
function verifyAccountCallback(b) {
  if (MODE === 'mock') return true;
  return safeEq(b.hash, sign([b.statusCode, b.accountNumber, b.amount, b.clearingFeeAmount, b.transferFeeAmount]));
}

/* ---------- banks and payouts ---------- */
const MOCK_BANKS = [["058", "GTBank"], ["044", "Access Bank"], ["033", "UBA"], ["057", "Zenith Bank"], ["011", "First Bank"], ["090267", "Kuda"], ["100004", "Opay"], ["100033", "PalmPay"], ["090405", "Moniepoint"], ["035", "Wema Bank"], ["232", "Sterling Bank"], ["070", "Fidelity Bank"], ["214", "FCMB"], ["032", "Union Bank"], ["039", "Stanbic IBTC"], ["076", "Polaris Bank"], ["050", "Ecobank"], ["082", "Keystone Bank"]].map(([id, name]) => ({ id, name }));
let bankCache = null, bankAt = 0;
async function banks() {
  if (MODE === 'mock') return MOCK_BANKS;
  if (!bankCache || Date.now() - bankAt > 864e5) {
    const reference = 'banks-' + Date.now();
    const d = await business('/getBanks', { referenceNumber: reference }, [reference]);
    bankCache = (d.banks || []).map(b => ({ id: b.uuid, name: b.name })).sort((a, b) => a.name.localeCompare(b.name)); bankAt = Date.now();
  }
  return bankCache;
}

// Send money to a bank account. Paga confirms the final result later by callback.
async function payout({ reference, amount, bankCode, accountNumber, name }) {
  if (MODE === 'mock') return { reference, status: 'SUCCESS', mock: true };
  const amt = String(amount), f = [reference, amt, bankCode, accountNumber];
  const base = { referenceNumber: reference, amount: amt, currency: 'NGN', destinationBankUUID: bankCode, destinationBankAccountNumber: accountNumber };
  const v = await business('/validateDepositToBank', base, f);
  if (Number(v.responseCode) !== 0) throw new Error('Paga could not validate that bank account' + (v.message ? ': ' + v.message : ''));
  const d = await business('/depositToBank', { ...base, recipientName: name, remarks: 'AjoLabs transfer', statusCallbackUrl: PUBLIC_URL + '/webhooks/paga-payout' }, f);
  if (Number(d.responseCode) !== 0) throw new Error('Paga did not accept the transfer' + (d.message ? ': ' + d.message : ''));
  return { reference, status: 'SUCCESS', fee: d.fee, raw: d };
}
// Payout result callback. Hash = sha512(values of the fields named in x-paga-hash-parameters + hashKey)
function verifyPayoutCallback(body, headers) {
  if (MODE === 'mock') return true;
  const names = String(headers['x-paga-hash-parameters'] || 'referenceNumber,transactionDate,transactionId,amount,sessionId').split(/[,\s]+/).filter(Boolean);
  return safeEq(headers['x-paga-hash'], sha(names.map(n => body[n] ?? '').join('') + HASH_KEY));
}

/* ---------- checkout / payment request (kept for later) ---------- */
async function requestPayment({ reference, amount, payerName, payerPhone, payerEmail }) {
  if (MODE === 'mock') return { reference, checkoutUrl: `/mock-pay?ref=${reference}` };
  const body = { referenceNumber: reference, amount, currency: 'NGN', payer: { name: payerName, phoneNumber: payerPhone, email: payerEmail }, payee: { name: 'AjoLabs' }, payerCollectionFeeShare: 1, payeeCollectionFeeShare: 0, isSuppressMessages: true, paymentMethods: ['BANK_TRANSFER'], callBackUrl: PUBLIC_URL + '/webhooks/paga' };
  const d = await collect('/paymentRequest', body, [reference, String(amount), 'NGN', payerPhone, payerEmail, '', '', '', '']);
  return { reference, raw: d };
}
// Payment request callback. Hash: notificationId + statusCode + externalReferenceNumber + state + outstandingBalance + hashKey
function verifyWebhook(rawBody) {
  if (MODE === 'mock') return true;
  let b; try { b = JSON.parse(rawBody); } catch { return false; }
  const ob = b.outstandingBalance == null ? '' : Number(b.outstandingBalance).toFixed(2);
  return safeEq(b.hash, sign([b.notificationId, b.statusCode, b.externalReferenceNumber, b.state, ob]));
}

module.exports = { MODE, createAccount, verifyAccountCallback, banks, payout, verifyPayoutCallback, requestPayment, verifyWebhook };
