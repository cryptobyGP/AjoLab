// Paga adapter. Everything that talks to Paga lives here.
// PAGA_MODE=mock  -> no network, the full flow works for local demos and tests.
// PAGA_MODE=live  -> calls Paga. The endpoint paths and signing below are PLACEHOLDERS:
//                    confirm each one against the Paga Engine docs the shipathon gives you.
const crypto = require('crypto');

const MODE = process.env.PAGA_MODE || 'mock';
const BASE = process.env.PAGA_BASE_URL || '';          // sandbox base URL from Paga docs
const PUBLIC_KEY = process.env.PAGA_PUBLIC_KEY || '';
const SECRET_KEY = process.env.PAGA_SECRET_KEY || '';
const HMAC_KEY = process.env.PAGA_HMAC_KEY || '';

// Hash signing. Paga signs requests with a hash of selected fields plus the HMAC key.
// TODO: replace with the exact field order and algorithm from the docs.
function sign(fields) {
  return crypto.createHash('sha512').update(fields.join('') + HMAC_KEY).digest('hex');
}

async function call(path, body, fieldsToSign) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      principal: PUBLIC_KEY,
      credentials: SECRET_KEY,
      hash: sign(fieldsToSign),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Paga ${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// Ask a member to pay their share. Returns a reference we match against the webhook.
async function requestPayment({ reference, amount, payerName, payerPhone, payerEmail }) {
  if (MODE === 'mock') return { reference, checkoutUrl: `/mock-pay?ref=${reference}` };
  // TODO: use the collect / payment-request endpoint from the docs.
  const data = await call('/PATH_FOR_PAYMENT_REQUEST', {
    referenceNumber: reference, amount, currency: 'NGN', payer: { name: payerName, phoneNumber: payerPhone, email: payerEmail },
    callbackUrl: process.env.PUBLIC_URL + '/webhooks/paga',
  }, [reference, String(amount)]);
  return { reference, checkoutUrl: data.checkoutUrl || data.paymentUrl || null, raw: data };
}

// Send the pot to the winner's bank account.
async function payout({ reference, amount, bankCode, accountNumber, name }) {
  if (MODE === 'mock') return { reference, status: 'SUCCESS', mock: true };
  // TODO: use the money transfer to bank endpoint from the docs.
  const data = await call('/PATH_FOR_BANK_TRANSFER', {
    referenceNumber: reference, amount, currency: 'NGN',
    destinationBankUUID: bankCode, destinationBankAccountNumber: accountNumber, recipientName: name,
  }, [reference, String(amount), accountNumber]);
  return { reference, status: 'SUCCESS', raw: data };
}

// Check a webhook really came from Paga. TODO: confirm the header name and algorithm.
function verifyWebhook(rawBody, headers) {
  if (MODE === 'mock') return true;
  const given = headers['x-paga-signature'] || headers['hash'] || '';
  const expected = crypto.createHmac('sha512', HMAC_KEY).update(rawBody).digest('hex');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Gives each user their own bank account number at Paga, in their name, to fund their balance.
// LIVE: placeholder until the Paga persistent-account docs are confirmed.
async function createAccount({ uid, name, email, phone }) {
  if (MODE === 'mock') { let h = 0; for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) % 100000000; return { number: '99' + String(h).padStart(8, '0'), bank: 'Paga (test)', name }; }
  throw new Error('Paga account creation is not connected yet');
}

module.exports = { createAccount, MODE, requestPayment, payout, verifyWebhook };
