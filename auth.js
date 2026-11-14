// Checks who is calling. Real sign-in is handled by Privy (Google or email); the server only
// verifies the access token Privy gives the browser. Demo sign-in exists for testing without Privy.
const crypto = require('crypto');

const APP_ID = process.env.PRIVY_APP_ID || '';
const KEY = (process.env.PRIVY_VERIFICATION_KEY || '').replace(/\\n/g, '\n');
// Demo sign-in is on only when Privy is not configured, unless DEMO_LOGIN says otherwise.
const DEMO = process.env.DEMO_LOGIN ? process.env.DEMO_LOGIN === '1' : !APP_ID;
const b64 = s => Buffer.from(s, 'base64url');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function verify(token, headerEmail) {
  if (token.startsWith('demo.')) {
    if (!DEMO) throw new Error('Demo sign-in is switched off');
    const email = b64(token.slice(5)).toString().trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error('Enter a valid email');
    return { uid: 'demo:' + email, email };
  }
  if (!APP_ID) throw new Error('Sign-in is not set up on the server');
  if (!KEY) throw new Error('PRIVY_VERIFICATION_KEY is missing on the server');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('Bad token');
  if (JSON.parse(b64(h)).alg !== 'ES256') throw new Error('Bad token');
  const ok = crypto.verify('sha256', Buffer.from(h + '.' + p), { key: KEY, dsaEncoding: 'ieee-p1363' }, b64(s));
  if (!ok) throw new Error('Sign-in could not be verified');
  const c = JSON.parse(b64(p));
  if (c.iss !== 'privy.io' || c.aud !== APP_ID || c.exp * 1000 < Date.now()) throw new Error('Sign-in expired. Please sign in again');
  const email = (headerEmail || '').trim().toLowerCase();
  return { uid: c.sub, email: EMAIL.test(email) ? email : '' };
}

const config = () => ({ privyAppId: APP_ID, demoLogin: DEMO });
module.exports = { verify, config };
