// Lets Claude (or any assistant that supports MCP) read a person's own circles. Read-only: nothing here moves money.
// Each person makes a private link in Account. The link is the key, so it can be revoked at any time.
const crypto = require('crypto');
const circle = require('./circle');
const { db, save } = require('./store');

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const ngn = n => '₦' + Number(n || 0).toLocaleString('en-NG');

function create(uid) {
  const u = circle.getUser(uid), token = 'ajo_' + crypto.randomBytes(24).toString('hex');
  u.connector = { hash: sha(token), at: Date.now() }; save(); return token;
}
function revoke(uid) { const u = circle.getUser(uid); delete u.connector; save(); }
function userByToken(token) {
  if (!/^ajo_[0-9a-f]{48}$/.test(token || '')) return null;
  const h = sha(token); return Object.values(db.users).find(u => u.connector && u.connector.hash === h) || null;
}

/* ---------- pay by chat: the assistant prepares, only the person approves inside AjoLabs ---------- */
const REQ_MS = 10 * 60000;
const baseUrl = () => (process.env.PUBLIC_URL || 'https://ajolab.onrender.com').replace(/\/$/, '');
function prepare(uid, ref) {
  const c = circle.status(find(uid, ref).id, uid), me = c.members.find(m => m.you);
  if (!me) throw new Error('You are not a member of that circle.');
  let kind;
  if (c.status === 'deposits') { if (me.deposit) throw new Error('Your deposit for ' + c.name + ' is already paid.'); kind = 'deposit'; }
  else if (c.status === 'active') { if (me.paid) throw new Error('You have already paid round ' + c.round + ' of ' + c.name + '.'); kind = 'round'; }
  else throw new Error(c.name + ' is not taking payments right now (' + c.status + ').');
  const u = circle.getUser(uid); u.payReqs = (u.payReqs || []).filter(r => r.exp > Date.now() && !r.done && r.cid !== c.id);
  const r = { id: crypto.randomBytes(9).toString('hex'), cid: c.id, memberId: me.id, kind, amount: c.amount, name: c.name, exp: Date.now() + REQ_MS };
  u.payReqs.push(r); save(); return { ...r, url: baseUrl() + '/?approve=' + r.id };
}
function reqOf(uid, id) {
  const r = (circle.getUser(uid).payReqs || []).find(x => x.id === id);
  if (!r) throw new Error('That payment request was not found. Ask Claude to prepare it again.');
  if (r.done) throw new Error('That payment was already approved.');
  if (r.exp < Date.now()) throw new Error('That payment request expired. Ask Claude to prepare it again.');
  return r;
}
function describe(uid, id) { const r = reqOf(uid, id), u = circle.getUser(uid); return { id: r.id, circle: r.name, kind: r.kind, amount: r.amount, balance: u.wallet, expiresAt: r.exp }; }
const approving = new Set();
async function approve(uid, id) {
  const r = reqOf(uid, id); if (approving.has(id)) throw new Error('Already working on it.'); approving.add(id);
  try {
    const c = circle.status(r.cid, uid), me = c.members.find(m => m.you);
    if (!me || me.id !== r.memberId) throw new Error('This request is not for your seat.');
    if (r.kind === 'deposit' ? (c.status !== 'deposits' || me.deposit) : (c.status !== 'active' || me.paid)) throw new Error('This circle has moved on, so that payment is no longer needed.');
    await circle.payFromBalance(r.cid, r.memberId, uid, r.kind);
    r.done = true; save(); return circle.status(r.cid, uid);
  } finally { approving.delete(id); }
}

/* ---------- the tools ---------- */
const lite = c => ({ id: c.id, name: c.name, goal: c.goal || null, status: c.status, round: c.status === 'active' ? c.round : null, members: c.members.length + '/' + c.maxMembers, amount: ngn(c.amount), everyDays: c.cycleDays });
function find(uid, ref) {
  const list = circle.mine(uid); if (!list.length) throw new Error('You have no circles yet.');
  if (!ref) { if (list.length === 1) return list[0]; throw new Error('You have ' + list.length + ' circles. Say which one: ' + list.map(c => c.name).join(', ')); }
  const r = String(ref).toLowerCase(), hit = list.find(c => c.id === ref) || list.find(c => c.name.toLowerCase() === r) || list.find(c => c.name.toLowerCase().includes(r));
  if (!hit) throw new Error('No circle matches "' + ref + '". Yours: ' + list.map(c => c.name).join(', '));
  return hit;
}
const TOOLS = {
  my_circles: { d: 'List the circles this person is in, with status and round.', p: {}, run: uid => circle.mine(uid).map(lite) },
  circle_status: { d: 'Detail for one circle: who has paid this round, who receives, deadline, and whether the record on Solana is confirmed. Pass the circle name or id.', p: { circle: 'Circle name or id' },
    run: (uid, a) => { const c = circle.status(find(uid, a.circle).id, uid), me = c.members.find(m => m.you);
      return { ...lite(c), receives: c.status === 'active' ? c.receiver : null, receiverGets: c.status === 'active' ? ngn(c.receiverNet) : null, deadline: c.deadline ? new Date(c.deadline).toISOString() : null,
        youPaid: me ? !!me.paid : null, yourTurnInRound: me ? me.slot : null,
        members: c.members.map(m => ({ name: m.name + (m.you ? ' (you)' : ''), slot: m.slot, paid: !!m.paid, level: m.ajoLevel || 'New' })),
        solanaRecords: c.proof ? { total: c.proof.total, confirmed: c.proof.confirmed, valid: c.proof.valid } : null }; } },
  next_payout: { d: 'When this person gets paid next, across their circles.', p: {},
    run: uid => circle.mine(uid).filter(c => c.status !== 'completed').map(c => { const me = c.members.find(m => m.you); if (!me) return null;
      return { circle: c.name, yourRound: me.slot, currentRound: c.status === 'active' ? c.round : null, status: c.status === 'active' ? (me.slot === c.round ? 'your turn now' : me.slot < c.round ? 'already paid out' : 'in ' + (me.slot - c.round) + ' round(s)') : c.status }; }).filter(Boolean) },
  my_receipts: { d: 'Recent receipts (payments, payouts, transfers).', p: { limit: 'How many, default 5' },
    run: (uid, a) => (circle.getUser(uid).receipts || []).slice(0, Math.min(+a.limit || 5, 20)).map(r => ({ id: r.id, title: r.title, amount: r.amount != null ? ngn(r.amount) : null, circle: r.circleName || null, at: new Date(r.at).toISOString(), status: r.status })) },
  ajo_score: { d: 'This person\'s Ajo Score and level.', p: {}, run: uid => { const p = circle.pub(circle.getUser(uid)); return { score: p.ajo.score, level: p.ajo.level, onTime: p.ajo.onTime, late: p.ajo.late, holdbackTier: p.tier }; } },
  prepare_payment: { d: 'Prepare this person\'s payment (deposit or round contribution) for a circle. This does NOT pay. It returns a private link that the person must open and approve inside AjoLabs. Never tell them it is paid until they confirm they approved it.', p: { circle: 'Circle name or id' }, write: true,
    run: (uid, a) => { const r = prepare(uid, a.circle); return { prepared: true, circle: r.name, pays: ngn(r.amount) + (r.kind === 'deposit' ? ' deposit' : ' round payment'), expiresInMinutes: 10, approveHere: r.url, note: 'Nothing has been paid yet. Ask the person to open the link and tap Approve and pay.' }; } },
  my_balance: { d: 'Balance in the AjoLabs wallet (test money in the sandbox).', p: {}, run: uid => ({ balance: ngn(circle.getUser(uid).wallet) }) }
};

const schema = t => ({ type: 'object', properties: Object.fromEntries(Object.entries(t.p).map(([k, v]) => [k, { type: k === 'limit' ? 'number' : 'string', description: v }])) });
const listTools = () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.d, inputSchema: schema(t), annotations: t.write ? { readOnlyHint: false, destructiveHint: false } : { readOnlyHint: true } }));

// One JSON-RPC message in, one out (or null for a notification).
async function handle(msg, user) {
  const id = msg.id, ok = result => ({ jsonrpc: '2.0', id, result }), bad = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null;
  switch (msg.method) {
    case 'initialize': return ok({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'AjoLabs', version: '1.0.0' }, instructions: 'The user\'s own AjoLabs savings circles. Amounts are in naira. This is a test environment (Paga sandbox), so no real money. You can read everything, and you can PREPARE a payment, but you can never pay: the user approves each payment themselves in AjoLabs.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: listTools() });
    case 'tools/call': {
      const t = TOOLS[msg.params && msg.params.name]; if (!t) return bad(-32602, 'Unknown tool');
      try { const out = await t.run(user.uid, (msg.params && msg.params.arguments) || {}); return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] }); }
      catch (e) { return ok({ isError: true, content: [{ type: 'text', text: e.message }] }); }
    }
    default: return bad(-32601, 'Method not found');
  }
}
module.exports = { create, revoke, userByToken, handle, listTools, prepare, describe, approve };
