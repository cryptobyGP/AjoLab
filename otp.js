// One-time email codes for sensitive actions (connecting a bank, sending money out). Codes live in memory for 10 minutes.
const crypto = require('crypto');
const codes = new Map();   // uid:purpose -> { hash, exp, tries, sentAt }
const h = c => crypto.createHash('sha256').update(String(c)).digest('hex');

function create(uid, purpose) {
  const k = uid + ':' + purpose, old = codes.get(k);
  if (old && Date.now() - old.sentAt < 30000) throw new Error('Wait 30 seconds before asking for another code');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  codes.set(k, { hash: h(code), exp: Date.now() + 600000, tries: 0, sentAt: Date.now() });
  return code;
}
function verify(uid, purpose, code) {
  const k = uid + ':' + purpose, c = codes.get(k);
  if (!c || c.exp < Date.now()) { codes.delete(k); throw Object.assign(new Error('Verification needed. Ask for a new code.'), { otp: true }); }
  if (++c.tries > 5) { codes.delete(k); throw Object.assign(new Error('Too many wrong codes. Ask for a new code.'), { otp: true }); }
  if (h(String(code || '').trim()) !== c.hash) throw Object.assign(new Error('That code is not right'), { otp: true });
  codes.delete(k);   // one use only
}
module.exports = { create, verify };
