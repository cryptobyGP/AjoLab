// Zero-dependency server: API + webhook + static UI from ./public
const http = require('http'), fs = require('fs'), path = require('path');
const paga = require('./paga'); const circle = require('./circle');
const PORT = process.env.PORT || 3000;

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => r(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;
  try {
    if (m === 'GET' && p === '/health') return send(res, 200, { ok: true, mode: paga.MODE });

    if (m === 'POST' && p === '/webhooks/paga') {                       // Paga tells us a payment landed
      const raw = await readBody(req);
      if (!paga.verifyWebhook(raw, req.headers)) return send(res, 401, { error: 'bad signature' });
      const body = JSON.parse(raw || '{}');
      const reference = body.referenceNumber || body.reference;          // TODO: match Paga's payload field name
      return send(res, 200, await circle.markPaid(reference));
    }

    if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/simulate-pay') {   // demo helper, mock mode only
      const { reference } = JSON.parse((await readBody(req)) || '{}');
      return send(res, 200, await circle.markPaid(reference));
    }

    if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/skip-time') {      // demo helper, mock mode only
      const { id } = JSON.parse((await readBody(req)) || '{}'); circle.skipTime(id);
      return send(res, 200, circle.status(id));
    }

    let mt;
    if ((mt = p.match(/^\/api\/circles\/(\w+)\/settle$/)) && m === 'POST') { await circle.settle(mt[1]); return send(res, 200, circle.status(mt[1])); }
    if ((mt = p.match(/^\/api\/circles\/(\w+)\/deposit\/(\w+)$/)) && m === 'POST') return send(res, 200, await circle.requestPayment(mt[1], mt[2], 'deposit'));
    if (m === 'POST' && p === '/api/circles') return send(res, 201, circle.status(circle.createCircle(JSON.parse(await readBody(req))).id));
    if ((mt = p.match(/^\/api\/circles\/(\w+)$/)) && m === 'GET') return send(res, 200, circle.status(mt[1]));
    if ((mt = p.match(/^\/api\/circles\/(\w+)\/join$/)) && m === 'POST') { circle.joinCircle(mt[1], JSON.parse(await readBody(req))); return send(res, 200, circle.status(mt[1])); }
    if ((mt = p.match(/^\/api\/circles\/(\w+)\/pay\/(\w+)$/)) && m === 'POST') return send(res, 200, await circle.requestPayment(mt[1], mt[2]));

    // static files
    const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (file.startsWith(path.join(__dirname, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile())
      return send(res, 200, fs.readFileSync(file), file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
}).listen(PORT, () => console.log(`AjoLabs on :${PORT} (Paga mode: ${paga.MODE})`));
