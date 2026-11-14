// One place that owns the data, so every module shares the same state.
// With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set, data is saved to Upstash (free, survives Render restarts).
// Without them, it falls back to a local file (which Render's free plan wipes on restart).
const fs = require('fs');
const crypto = require('crypto');

const DB_FILE = process.env.DB_FILE || './data.json';
const URL_ = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = process.env.DB_KEY || 'ajolabs:db';
const REMOTE = !!(URL_ && TOKEN);

const db = { circles: {}, refs: {}, users: {} };
const cmd = async c => {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('store: ' + (d.error || r.status));
  return d.result;
};

async function init() {
  if (REMOTE) { const v = await cmd(['GET', KEY]); if (v) Object.assign(db, JSON.parse(v)); console.log('Data store: Upstash,', Object.keys(db.users).length, 'users loaded'); }
  else { try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {} console.log('Data store: local file (resets on Render restart)'); }
}

let timer = null, dirty = false, inflight = Promise.resolve();
async function flush() {
  if (!REMOTE || !dirty) return;
  dirty = false;
  const json = JSON.stringify(db);
  inflight = inflight.then(() => cmd(['SET', KEY, json])).catch(e => { dirty = true; console.error('save failed, will retry:', e.message); });
  return inflight;
}
function save() {
  if (!REMOTE) return fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  dirty = true; clearTimeout(timer); timer = setTimeout(flush, 250);
}
process.on('SIGTERM', async () => { clearTimeout(timer); await flush().catch(() => {}); process.exit(0); });

const id = (n = 6) => crypto.randomBytes(n).toString('hex');
module.exports = { db, save, id, init, flush, REMOTE };
