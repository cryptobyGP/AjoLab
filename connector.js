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
  my_balance: { d: 'Balance in the AjoLabs wallet (test money in the sandbox).', p: {}, run: uid => ({ balance: ngn(circle.getUser(uid).wallet) }) }
};

const schema = t => ({ type: 'object', properties: Object.fromEntries(Object.entries(t.p).map(([k, v]) => [k, { type: k === 'limit' ? 'number' : 'string', description: v }])) });
const listTools = () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.d, inputSchema: schema(t), annotations: { readOnlyHint: true } }));

// One JSON-RPC message in, one out (or null for a notification).
async function handle(msg, user) {
  const id = msg.id, ok = result => ({ jsonrpc: '2.0', id, result }), bad = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null;
  switch (msg.method) {
    case 'initialize': return ok({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'AjoLabs', version: '1.0.0' }, instructions: 'Read-only view of the user\'s own AjoLabs savings circles. Amounts are in naira. This is a test environment (Paga sandbox), so no real money.' });
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
module.exports = { create, revoke, userByToken, handle, listTools };
