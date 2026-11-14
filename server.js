// Zero-dependency server: API + webhook + static UI from ./public
const http = require('http'), fs = require('fs'), path = require('path');
const paga = require('./paga'), circle = require('./circle'), auth = require('./auth'), notify = require('./notify');
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => r(b)); });
const json = async req => JSON.parse((await readBody(req)) || '{}');

async function who(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw Object.assign(new Error('Please sign in'), { code: 401 });
  let v; try { v = await auth.verify(h.slice(7), req.headers['x-user-email']); } catch (e) { throw Object.assign(e, { code: 401 }); }
  return circle.upsertUser(v.uid, v.email).uid;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;
  try {
    if (m === 'GET' && p === '/health') return send(res, 200, { ok: true, mode: paga.MODE });
    if (m === 'GET' && p === '/api/config') return send(res, 200, { ...auth.config(), mode: paga.MODE, emailReceipts: notify.enabled });

    if (m === 'POST' && p === '/webhooks/paga') {                       // Paga tells us a payment landed
      const raw = await readBody(req);
      if (!paga.verifyWebhook(raw, req.headers)) return send(res, 401, { error: 'bad signature' });
      const body = JSON.parse(raw || '{}');
      const reference = body.referenceNumber || body.externalReferenceNumber || body.reference;   // TODO: confirm Paga's field name
      return send(res, 200, await circle.markPaid(reference));
    }

    // public: lets someone see a circle from an invite link before they sign in
    let mt;
    if ((mt = p.match(/^\/api\/preview\/(\w+)$/)) && m === 'GET') return send(res, 200, circle.preview(mt[1]));

    if (p.startsWith('/api/')) {
      const uid = await who(req);
      if (m === 'GET' && p === '/api/me') return send(res, 200, circle.pub(circle.getUser(uid)));
      if (m === 'POST' && p === '/api/me') return send(res, 200, circle.profile(uid, await json(req)));
      if (m === 'POST' && p === '/api/me/read') { const u = circle.getUser(uid); u.notes.forEach(n => (n.read = true)); require('./store').save(); return send(res, 200, circle.pub(u)); }
      if (m === 'POST' && p === '/api/withdraw') return send(res, 200, await circle.withdraw(uid, (await json(req)).amount));
      if (m === 'GET' && p === '/api/circles') return send(res, 200, circle.mine(uid));
      if (m === 'POST' && p === '/api/circles') return send(res, 201, circle.status(circle.createCircle(await json(req), uid).id, uid));

      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/simulate-pay') { const { reference } = await json(req); return send(res, 200, await circle.markPaid(reference)); }
      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/skip-time') { const { id } = await json(req); circle.skipTime(id); return send(res, 200, circle.status(id, uid)); }

      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/fill') { const { id, except } = await json(req); circle.devFill(id); await circle.devPayOthers(id, uid, except); return send(res, 200, circle.status(id, uid)); }
      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/fill') { const { id } = await json(req); circle.devFill(id); return send(res, 200, circle.status(id, uid)); }
      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/pay-others') { const { id, except } = await json(req); await circle.devPayOthers(id, uid, except); return send(res, 200, circle.status(id, uid)); }

      const own = (cid, memberId) => { const s = circle.status(cid, uid); if (s.myId !== memberId) throw new Error('That is not your seat'); };
      if ((mt = p.match(/^\/api\/circles\/(\w+)$/)) && m === 'GET') return send(res, 200, circle.status(mt[1], uid));
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/join$/)) && m === 'POST') { circle.joinCircle(mt[1], uid); return send(res, 200, circle.status(mt[1], uid)); }
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/settle$/)) && m === 'POST') { if (!circle.status(mt[1], uid).myId) throw new Error('Only members can settle'); await circle.settle(mt[1]); return send(res, 200, circle.status(mt[1], uid)); }
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/deposit\/(\w+)$/)) && m === 'POST') { own(mt[1], mt[2]); return send(res, 200, await circle.requestPayment(mt[1], mt[2], 'deposit')); }
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/pay\/(\w+)$/)) && m === 'POST') { own(mt[1], mt[2]); return send(res, 200, await circle.requestPayment(mt[1], mt[2])); }
      return send(res, 404, { error: 'not found' });
    }

    // static files
    const root = path.join(__dirname, 'public');
    const file = path.join(root, p === '/' ? 'index.html' : p);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile())
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, e.code === 401 ? 401 : 400, { error: e.message }); }
}).listen(PORT, () => console.log(`AjoLabs on :${PORT} (Paga mode: ${paga.MODE})`));
