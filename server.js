// Zero-dependency server: API + webhook + static UI from ./public
const http = require('http'), fs = require('fs'), path = require('path');
const paga = require('./paga'), circle = require('./circle'), auth = require('./auth'), notify = require('./notify'), otp = require('./otp'), sol = require('./sol'), connector = require('./connector');
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method; let mt0;
  try {
    if (m === 'GET' && p === '/health') return send(res, 200, { ok: true, mode: paga.MODE, storage: require('./store').REMOTE ? 'upstash' : 'file' });
    if (m === 'GET' && p === '/api/config') return send(res, 200, { ...auth.config(), mode: paga.MODE, topup: paga.MODE === 'mock' || process.env.TEST_TOPUP === '1', emailReceipts: notify.enabled });

    if (m === 'POST' && p === '/webhooks/paga') {                       // Paga tells us a payment landed
      const raw = await readBody(req);
      if (!paga.verifyWebhook(raw, req.headers)) return send(res, 401, { error: 'bad signature' });
      const body = JSON.parse(raw || '{}');
      const reference = body.referenceNumber || body.externalReferenceNumber || body.reference;   // TODO: confirm Paga's field name
      return send(res, 200, await circle.markPaid(reference));
    }

    if (m === 'GET' && p === '/mock-pay' && paga.MODE === 'mock') {       // stand-in for Paga's checkout page
      const ref = url.searchParams.get('ref'); await circle.markPaid(ref);
      res.writeHead(302, { Location: '/?funded=1' }); return res.end();
    }
    if (m === 'GET' && p === '/mock-mandate' && paga.MODE === 'mock') {   // stand-in for Paga's direct debit page
      circle.mandateEvent({ referenceNumber: url.searchParams.get('ref'), mandateStatus: 'APPROVED', bankName: 'Opay', accountNumber: '0000008197' });
      res.writeHead(302, { Location: '/?mandate=done' }); return res.end();
    }
    if (m === 'POST' && p === '/webhooks/paga-mandate') {                // direct debit: mandate status and charge results
      const b = await json(req);
      if (b.event === 'Charge_Complete') { if (!paga.verifyChargeCallback(b)) return send(res, 401, { error: 'bad signature' }); circle.chargeDone(b); circle.autoTick(); }
      else { if (!paga.verifyMandateCallback(b)) return send(res, 401, { error: 'bad signature' }); circle.mandateEvent(b); }
      return send(res, 200, { status: 'SUCCESS' });
    }
    if (m === 'POST' && p === '/webhooks/paga-account') {                // a transfer arrived in a user's Paga account
      const b = await json(req);
      const okSig = paga.verifyAccountCallback(b);
      console.error('Paga account callback', okSig ? 'signature ok' : 'BAD SIGNATURE', JSON.stringify({ ...b, hash: undefined }).slice(0, 400));
      if (!okSig) return send(res, 401, { error: 'bad signature' });
      const u = circle.userByAccount(String(b.accountNumber));
      if (u && Number(b.statusCode) === 0) {
        const amount = Number(String(b.amount).replace(/[^0-9.]/g, ''));   // Paga writes "5,000.00"
        try { circle.fund(u.uid, amount, 'fund-' + (b.transactionReference || b.fundingPaymentReference)); console.error('Paga account funded', u.uid, amount); }
        catch (e) { console.error('Paga account fund failed', e.message); }
      } else console.error('Paga account callback: no user for', b.accountNumber);
      return send(res, 200, { status: 'SUCCESS' });
    }
    if (m === 'POST' && p === '/webhooks/paga-payout') {                 // Paga reports the result of a bank transfer
      const b = await json(req);
      if (!paga.verifyPayoutCallback(b, req.headers)) return send(res, 401, { error: 'bad signature' });
      circle.payoutResult(b.referenceNumber, b.responseCode);
      return send(res, 200, { status: 'SUCCESS' });
    }

    // chat connector (MCP): the private link is the key. Read-only.
    if ((mt0 = p.match(/^\/mcp(?:\/(ajo_[0-9a-f]{48}))?$/))) {
      if (m === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }); return res.end(); }
      const tok = mt0[1] || (req.headers.authorization || '').replace(/^Bearer /, ''), cu = connector.userByToken(tok);
      const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
      if (!cu) { res.writeHead(401, cors); return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid or revoked AjoLabs connector link' } })); }
      if (m !== 'POST') { res.writeHead(405, { ...cors, Allow: 'POST' }); return res.end(JSON.stringify({ error: 'Use POST' })); }
      const body = await json(req), batch = Array.isArray(body), outs = [];
      for (const msg of (batch ? body : [body])) { const r = await connector.handle(msg, cu); if (r) outs.push(r); }
      if (!outs.length) { res.writeHead(202, cors); return res.end(); }
      res.writeHead(200, cors); return res.end(JSON.stringify(batch ? outs : outs[0]));
    }

    // public: lets someone see a circle from an invite link before they sign in
    let mt;
    if ((mt = p.match(/^\/api\/preview\/(\w+)$/)) && m === 'GET') return send(res, 200, circle.preview(mt[1]));
    if ((mt = p.match(/^\/api\/proof\/(\w+)$/)) && m === 'GET') return send(res, 200, circle.proofOf(mt[1]));   // anyone can check a circle's record

    if (p.startsWith('/api/')) {
      const uid = await who(req);
      if (m === 'POST' && p === '/api/connector') { const b = await json(req); if (b.revoke) { connector.revoke(uid); return send(res, 200, { on: false }); } return send(res, 200, { on: true, token: connector.create(uid) }); }
      if ((mt = p.match(/^\/api\/approve\/(\w+)$/)) && m === 'GET') return send(res, 200, connector.describe(uid, mt[1]));
      if ((mt = p.match(/^\/api\/approve\/(\w+)$/)) && m === 'POST') { await connector.approve(uid, mt[1]); return send(res, 200, circle.pub(circle.getUser(uid))); }
      if (m === 'GET' && p === '/api/banks') return send(res, 200, await paga.banks());
      if (m === 'GET' && p === '/api/me') return send(res, 200, circle.pub(circle.getUser(uid)));
      if (m === 'POST' && p === '/api/me') return send(res, 200, circle.profile(uid, await json(req)));
      if (m === 'POST' && p === '/api/me/read') { const u = circle.getUser(uid); u.notes.forEach(n => (n.read = true)); require('./store').save(); return send(res, 200, circle.pub(u)); }
      if (m === 'POST' && p === '/api/checkout') return send(res, 200, await circle.startCheckout(uid, (await json(req)).amount));
      if (m === 'GET' && p === '/api/wallet/balances') { const u = circle.getUser(uid); if (!u.sol) throw new Error('Connect a wallet first'); return send(res, 200, await sol.balances(u.sol.address)); }
      if (m === 'POST' && p === '/api/wallet/fund') {
        const u = circle.getUser(uid); if (!u.sol) throw new Error('Connect a wallet first');
        const b = await json(req), v = await sol.verifyPayment(String(b.signature || ''), u.sol.address);
        if (v.pending) return send(res, 200, { pending: true });
        return send(res, 200, { me: circle.creditWallet(uid, b.signature, v.naira, v.lamports), naira: v.naira });
      }
      if (m === 'GET' && p === '/api/wallet/config') return send(res, 200, sol.config());
      if (m === 'POST' && p === '/api/wallet') { const b = await json(req); return send(res, 200, b.unlink ? circle.unlinkWallet(uid) : circle.linkWallet(uid, b.address, b.message, b.signature)); }
      if (m === 'POST' && p === '/api/mandate') { otp.verify(uid, 'mandate', (await json(req)).otp); return send(res, 200, await circle.startMandate(uid)); }
      if (m === 'POST' && p === '/api/account') return send(res, 200, await circle.account(uid));
      if ((paga.MODE === 'mock' || process.env.TEST_TOPUP === '1') && m === 'POST' && p === '/api/dev/simulate-fund') return send(res, 200, circle.fund(uid, (await json(req)).amount));
      if (m === 'POST' && p === '/api/otp/send') {
        const purpose = (await json(req)).purpose === 'mandate' ? 'mandate' : 'withdraw', u = circle.getUser(uid), code = otp.create(uid, purpose);
        const sent = await notify.otp(u, code, purpose);
        if (!sent && paga.MODE !== 'mock') throw new Error('Could not send the code to your email. Try again.');
        return send(res, 200, { sent, testCode: sent ? undefined : code, email: u.email && !u.email.startsWith('demo:') ? u.email : '' });   // in test mode with no email service, the code is shown on screen
      }
      if (m === 'POST' && p === '/api/withdraw') { const b = await json(req); otp.verify(uid, 'withdraw', b.otp); return send(res, 200, await circle.withdraw(uid, b.amount)); }
      if (m === 'GET' && p === '/api/circles') return send(res, 200, circle.mine(uid));
      if (m === 'POST' && p === '/api/circles') return send(res, 201, circle.status(circle.createCircle(await json(req), uid).id, uid));

      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/simulate-pay') { const { reference } = await json(req); return send(res, 200, await circle.markPaid(reference)); }
      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/skip-time') { const { id } = await json(req); circle.skipTime(id); return send(res, 200, circle.status(id, uid)); }

      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/fill') { const { id, except } = await json(req); circle.devFill(id); await circle.devPayOthers(id, uid, except); return send(res, 200, circle.status(id, uid)); }
      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/fill') { const { id } = await json(req); circle.devFill(id); return send(res, 200, circle.status(id, uid)); }
      if (paga.MODE === 'mock' && m === 'POST' && p === '/api/dev/pay-others') { const { id, except } = await json(req); await circle.devPayOthers(id, uid, except); return send(res, 200, circle.status(id, uid)); }

      const own = (cid, memberId) => { const s = circle.status(cid, uid); if (s.myId !== memberId) throw new Error('That is not your seat'); };
      if ((mt = p.match(/^\/api\/circles\/(\w+)$/)) && m === 'GET') return send(res, 200, circle.status(mt[1], uid));
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/autopay$/)) && m === 'POST') return send(res, 200, await circle.setAuto(mt[1], uid, (await json(req)).on));
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/join$/)) && m === 'POST') { circle.joinCircle(mt[1], uid); return send(res, 200, circle.status(mt[1], uid)); }
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/settle$/)) && m === 'POST') { if (!circle.status(mt[1], uid).myId) throw new Error('Only members can settle'); await circle.settle(mt[1]); return send(res, 200, circle.status(mt[1], uid)); }
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/deposit\/(\w+)$/)) && m === 'POST') { own(mt[1], mt[2]); await circle.payFromBalance(mt[1], mt[2], uid, 'deposit'); return send(res, 200, circle.status(mt[1], uid)); }
      if ((mt = p.match(/^\/api\/circles\/(\w+)\/pay\/(\w+)$/)) && m === 'POST') { own(mt[1], mt[2]); await circle.payFromBalance(mt[1], mt[2], uid); return send(res, 200, circle.status(mt[1], uid)); }
      return send(res, 404, { error: 'not found' });
    }

    // static files
    const root = path.join(__dirname, 'public');
    const file = path.join(root, p === '/' ? 'index.html' : p);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      if (file === path.join(root, 'index.html')) {   // put the Privy app id in the page itself so sign-in starts loading immediately
        const id = JSON.stringify(auth.config().privyAppId || '').replace(/</g, '');
        return send(res, 200, fs.readFileSync(file, 'utf8').replace('<head>', '<head><script>window.__PRIVY=' + id + '</script>'), 'text/html; charset=utf-8');
      }
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, e.code === 401 ? 401 : 400, { error: e.message }); }
});
require('./store').init().then(() => { setInterval(() => circle.autoTick(), 60000); server.listen(PORT, () => console.log(`AjoLabs on :${PORT} (Paga mode: ${paga.MODE})`)); }).catch(e => { console.error('Could not load data:', e.message); process.exit(1); });
