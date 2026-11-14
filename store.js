// One place that owns the data file, so every module shares the same state.
const fs = require('fs');
const crypto = require('crypto');

const DB_FILE = process.env.DB_FILE || './data.json';
const db = { circles: {}, refs: {}, users: {} };
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}

const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const id = (n = 6) => crypto.randomBytes(n).toString('hex');

module.exports = { db, save, id };
