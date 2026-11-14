// Email receipts and notices. Needs RESEND_API_KEY (resend.com). Without it, receipts and
// notifications still show inside the app; only the email is skipped.
const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'AjoLabs <onboarding@resend.dev>';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ngn = n => '₦' + Number(n).toLocaleString('en-NG');

async function email(user, rc) {
  if (!KEY || !user.email || user.email.startsWith('demo:')) return;
  const rows = [['Receipt', rc.id], ['Date', new Date(rc.at).toUTCString()], rc.circleName && ['Circle', rc.circleName],
    rc.amount != null && ['Amount', ngn(rc.amount)], ['Reference', rc.reference || rc.id], ['Status', rc.status]].filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
    <h2 style="margin:0 0 6px">${esc(rc.title)}</h2><p style="color:#555;margin:0 0 18px">${esc(rc.summary)}</p>
    <table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#666;border-top:1px solid #eee">${esc(k)}</td><td style="padding:8px 0;text-align:right;border-top:1px solid #eee">${esc(v)}</td></tr>`).join('')}</table>
    <p style="color:#888;font-size:12px;margin-top:22px">AjoLabs is a hackathon prototype running on test money. The name AjoLabs is a placeholder.</p></div>`;
  const text = `${rc.title}\n${rc.summary}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [user.email], subject: `${rc.title}${rc.amount != null ? ' · ' + ngn(rc.amount) : ''}`, html, text }) });
    if (!r.ok) console.error('email failed', r.status, await r.text());
  } catch (e) { console.error('email failed', e.message); }
}

module.exports = { email, enabled: !!KEY };
