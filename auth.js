// Checks who is calling. Real sign-in is handled by Privy (Google or email); the server only
// verifies the access token Privy gives the browser. Demo sign-in exists for testing without Privy.
const crypto = require('crypto');

const APP_ID = process.env.PRIVY_APP_ID || '';
const KEY = (process.env.PRIVY_VERIFICATION_KEY || '').replace(/\\n/g, '\n');
// Demo sign-in is on only when Privy is not configured, unless DEMO_LOGIN says otherwise.
const DEMO = process.env.DEMO_LOGIN ? process.env.DEMO_LOGIN === '1' : !APP_ID;
const b64 = s => Buffer.from(s, 'base64url');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

let jwks = null, jwksAt = 0;
async function publicKeys() {
  if (KEY) return [crypto.createPublicKey(KEY)];
  if (!jwks || Date.now() - jwksAt > 3600e3) {
    const r = await fetch(`https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`, { headers: { 'privy-app-id': APP_ID } });
    if (!r.ok) throw new Error('Could not load the Privy sign-in key');
    jwks = (await r.json()).keys.map(k => crypto.createPublicKey({ key: k, format: 'jwk' })); jwksAt = Date.now();
  }
  return jwks;
}

async function verify(token, headerEmail) {
  if (token.startsWith('demo.')) {
    if (!DEMO) throw new Error('Demo sign-in is switched off');
    const email = b64(token.slice(5)).toString().trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error('Enter a valid email');
    return { uid: 'demo:' + email, email };
  }
  if (!APP_ID) throw new Error('Sign-in is not set up on the server');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('Bad token');
  if (JSON.parse(b64(h)).alg !== 'ES256') throw new Error('Bad token');
  const ok = (await publicKeys()).some(k => crypto.verify('sha256', Buffer.from(h + '.' + p), { key: k, dsaEncoding: 'ieee-p1363' }, b64(s)));
  if (!ok) throw new Error('Sign-in could not be verified');
  const c = JSON.parse(b64(p));
  if (c.iss !== 'privy.io' || c.aud !== APP_ID || c.exp * 1000 < Date.now()) throw new Error('Sign-in expired. Please sign in again');
  const email = (headerEmail || '').trim().toLowerCase();
  return { uid: c.sub, email: EMAIL.test(email) ? email : '' };
}

const config = () => ({ privyAppId: APP_ID, demoLogin: DEMO });
module.exports = { verify, config };
