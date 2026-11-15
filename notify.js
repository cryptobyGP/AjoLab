// Email receipts and notices. Needs RESEND_API_KEY (resend.com). Without it, receipts and
// notifications still show inside the app; only the email is skipped.
const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'AjoLabs <onboarding@resend.dev>';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ngn = n => '₦' + Number(n).toLocaleString('en-NG');

async function email(user, rc) {
  if (!KEY || !user.email || user.email.startsWith('demo:')) return;
  const ok = /^(successful|success|received)$/i.test(rc.status || 'Successful');
  const rows = [['Receipt', rc.id], ['Date', new Date(rc.at).toUTCString()], rc.circleName && ['Circle', rc.circleName],
    rc.amount != null && ['Amount', ngn(rc.amount)], ['Reference', rc.reference || rc.id], ['Status', rc.status]].filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
    <div style="display:inline-block;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:bold;margin-bottom:10px;background:${ok ? '#e3f8ec' : '#fde8e8'};color:${ok ? '#0a7a3d' : '#b42318'}">${ok ? 'Successful' : esc(rc.status)}</div><h2 style="margin:0 0 6px">${esc(rc.title)}</h2><p style="color:#555;margin:0 0 18px">${esc(rc.summary)}</p>
    <table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#666;border-top:1px solid #eee">${esc(k)}</td><td style="padding:8px 0;text-align:right;border-top:1px solid #eee">${esc(v)}</td></tr>`).join('')}</table>
    <p style="color:#888;font-size:12px;margin-top:22px">AjoLabs is a hackathon prototype running on test money. The name AjoLabs is a placeholder.</p></div>`;
  const text = `${rc.title}\n${rc.summary}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [user.email], subject: `${ok ? '' : '[' + rc.status + '] '}${rc.title}${rc.amount != null ? ' · ' + ngn(rc.amount) : ''}`, html, text }) });
    if (!r.ok) console.error('email failed', r.status, await r.text());
  } catch (e) { console.error('email failed', e.message); }
}

async function otp(user, code, purpose) {
  if (!KEY || !user.email || user.email.startsWith('demo:')) return false;
  const what = purpose === 'mandate' ? 'connect your bank' : 'send money to your bank';
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111"><h2 style="margin:0 0 6px">Your AjoLabs code</h2><p style="color:#555">Use this code to ${what}. It expires in 10 minutes. If this was not you, ignore this email.</p><p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:18px 0">${esc(code)}</p><p style="color:#888;font-size:12px">AjoLabs is a hackathon prototype running on test money.</p></div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [user.email], subject: `${code} is your AjoLabs code`, html, text: `Your AjoLabs code: ${code} (expires in 10 minutes)` }) });
    if (!r.ok) { console.error('otp email failed', r.status, await r.text()); return false; }
    return true;
  } catch (e) { console.error('otp email failed', e.message); return false; }
}

module.exports = { email, otp, enabled: !!KEY };
