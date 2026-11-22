// Email receipts and notices. Needs RESEND_API_KEY (resend.com). Without it, receipts and
// notifications still show inside the app; only the email is skipped.
const KEY = process.env.RESEND_API_KEY || '';
const BREVO = process.env.BREVO_API_KEY || '';                       // Brevo (free, can email anyone). Needs BREVO_SENDER = an email verified in Brevo.
const BREVO_SENDER = process.env.BREVO_SENDER || '';
const BREVO_NAME = process.env.BREVO_SENDER_NAME || 'AjoLabs';
const GAS_URL = process.env.GAS_URL || '', GAS_SECRET = process.env.GAS_SECRET || '';   // Google Apps Script relay: sends from your Gmail to anyone
const ON = !!(GAS_URL && GAS_SECRET) || !!(BREVO && BREVO_SENDER) || !!KEY;
const FROM = process.env.EMAIL_FROM || 'AjoLabs <onboarding@resend.dev>';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Resend's free plan allows about 2 emails per second. Send one at a time and retry if it says "too many requests".
let chain = Promise.resolve();
// Providers to try, in order. If one fails (for example the Apps Script relay is misconfigured), the next one still sends the email.
function providers(payload) {
  const list = [];
  if (GAS_URL && GAS_SECRET) list.push(['Apps Script', () => fetch(GAS_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: GAS_SECRET, to: [].concat(payload.to)[0], subject: payload.subject, html: payload.html, text: payload.text, name: 'AjoLabs' }) }), body => /"ok"\s*:\s*true/.test(body)]);
  if (BREVO && BREVO_SENDER) list.push(['Brevo', () => fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': BREVO, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender: { name: BREVO_NAME, email: BREVO_SENDER }, to: [].concat(payload.to).map(email => ({ email })), subject: payload.subject, htmlContent: payload.html, textContent: payload.text }) }), () => true]);
  if (KEY) list.push(['Resend', () => fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), () => true]);
  return list;
}
function sendMail(payload, label) {
  chain = chain.then(async () => {
    for (const [name, call, okBody] of providers(payload)) {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await call(), body = await r.text();
          if (r.ok && okBody(body)) { await new Promise(z => setTimeout(z, 600)); return true; }
          if (r.status === 429 && i < 2) { await new Promise(z => setTimeout(z, 1200 * (i + 1))); continue; }
          console.error(label + ' failed (' + name + ')', r.status, body.slice(0, 160)); break;
        } catch (e) { console.error(label + ' failed (' + name + ')', e.message); break; }
      }
    }
    return false;
  }).catch(() => false);
  return chain;
}
const ngn = n => '₦' + Number(n).toLocaleString('en-NG');

async function email(user, rc) {
  if (!ON || !user.email || user.email.startsWith('demo:')) return;
  const ok = /^(successful|success|received)$/i.test(rc.status || 'Successful');
  const rows = [['Receipt', rc.id], ['Date', new Date(rc.at).toUTCString()], rc.circleName && ['Circle', rc.circleName],
    rc.amount != null && ['Amount', ngn(rc.amount)], ['Reference', rc.reference || rc.id], ['Status', rc.status]].filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
    <div style="display:inline-block;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:bold;margin-bottom:10px;background:${ok ? '#e3f8ec' : '#fde8e8'};color:${ok ? '#0a7a3d' : '#b42318'}">${ok ? 'Successful' : esc(rc.status)}</div><h2 style="margin:0 0 6px">${esc(rc.title)}</h2><p style="color:#555;margin:0 0 18px">${esc(rc.summary)}</p>
    <table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#666;border-top:1px solid #eee">${esc(k)}</td><td style="padding:8px 0;text-align:right;border-top:1px solid #eee">${esc(v)}</td></tr>`).join('')}</table>
    <p style="color:#888;font-size:12px;margin-top:22px">AjoLabs runs on Paga’s sandbox with test money.</p></div>`;
  const text = `${rc.title}\n${rc.summary}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  await sendMail({ from: FROM, to: [user.email], subject: `${ok ? '' : '[' + rc.status + '] '}${rc.title}${rc.amount != null ? ' · ' + ngn(rc.amount) : ''}`, html, text }, 'email');
}

async function otp(user, code, purpose) {
  if (!ON || !user.email || user.email.startsWith('demo:')) return false;
  const what = purpose === 'mandate' ? 'connect your bank' : 'send money to your bank';
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111"><h2 style="margin:0 0 6px">Your AjoLabs code</h2><p style="color:#555">Use this code to ${what}. It expires in 10 minutes. If this was not you, ignore this email. If it landed in Spam, tap “Not spam” so future codes reach your inbox.</p><p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:18px 0">${esc(code)}</p><p style="color:#888;font-size:12px">AjoLabs is a hackathon prototype running on test money.</p></div>`;
  return sendMail({ from: FROM, to: [user.email], subject: `${code} is your AjoLabs code`, html, text: `Your AjoLabs code: ${code} (expires in 10 minutes)` }, 'otp email');
}

module.exports = { email, otp, enabled: ON };
