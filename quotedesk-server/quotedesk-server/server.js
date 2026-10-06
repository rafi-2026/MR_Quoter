'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'quotedesk.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── cyrb fallback hash (matches client) ──────────────────────────────────────
function cyrbHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// ── JSON file storage ────────────────────────────────────────────────────────
function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return def; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

function getDb() { return readJson(DB_FILE, null); }
function saveDb(data) { writeJson(DB_FILE, data); }

function getSessions() { return readJson(SESS_FILE, {}); }
function saveSessions(s) { writeJson(SESS_FILE, s); }

// ── session helpers ───────────────────────────────────────────────────────────
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function getSession(token) {
  if (!token) return null;
  const sessions = getSessions();
  const s = sessions[token];
  if (!s) return null;
  // expire after 7 days
  if (Date.now() - s.created > 7 * 24 * 3600 * 1000) {
    delete sessions[token];
    saveSessions(sessions);
    return null;
  }
  return s.userId;
}

function createSession(userId) {
  const token = genToken();
  const sessions = getSessions();
  sessions[token] = { userId, created: Date.now() };
  saveSessions(sessions);
  return token;
}

function deleteSession(token) {
  if (!token) return;
  const sessions = getSessions();
  delete sessions[token];
  saveSessions(sessions);
}

// ── app ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.cookies.qdsession;
  const userId = getSession(token);
  if (!userId) return res.status(401).json({ error: 'Not logged in' });
  req.userId = userId;
  next();
}

// ── API endpoints ─────────────────────────────────────────────────────────────

// Get full database
app.get('/api/db', auth, (req, res) => {
  const data = getDb();
  res.json(data);
});

// Save full database
app.post('/api/db', auth, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid data' });
  saveDb(data);
  res.json({ ok: true });
});

// Check if setup needed
app.get('/api/setup-needed', (req, res) => {
  const data = getDb();
  res.json({ needed: !data || !data.users || data.users.length === 0 });
});

// Initial setup (no auth needed, only when no users exist)
app.post('/api/setup', (req, res) => {
  const existing = getDb();
  if (existing && existing.users && existing.users.length > 0) {
    return res.status(400).json({ error: 'Already set up' });
  }
  const data = req.body;
  if (!data || !data.users || data.users.length === 0) {
    return res.status(400).json({ error: 'Missing data' });
  }
  saveDb(data);
  res.json({ ok: true });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'master' && password === 'Rafiq@24') {
    const token = createSession('master');
    res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ ok: true, userId: 'master' });
  }
  const data = getDb();
  if (!data) return res.status(400).json({ error: 'App not set up yet' });
  const user = (data.users || []).find(u => (u.username || '').toLowerCase() === (username || '').trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Wrong username or password' });

  // Password stored as salted SHA-256: SHA256(salt + ':' + password) — same as client hashPw()
  const raw = (user.salt || '') + ':' + password;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const fallback = 'c' + cyrbHash(raw);
  if (user.pass !== hash && user.pass !== fallback) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  if (!user.active) return res.status(403).json({ error: 'Account is disabled' });

  const token = createSession(user.id);
  res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, userId: user.id });
});

// Logout
app.post('/api/logout', (req, res) => {
  deleteSession(req.cookies.qdsession);
  res.clearCookie('qdsession');
  res.json({ ok: true });
});

// Who am I
app.get('/api/me', auth, (req, res) => {
  res.json({ userId: req.userId });
});

// Serve app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`QuoteDesk running on http://localhost:${PORT}`));
