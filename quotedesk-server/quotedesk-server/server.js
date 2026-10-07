'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Load local .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(l => {
      const line = l.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const idx = line.indexOf('=');
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    });
  } catch (e) {}
}

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'quotedesk.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Cloud Database State ─────────────────────────────────────────────────────
let mongoClient = null;
let mongoDb = null;
let mongoConnected = false;
let memoryDb = null;
let memorySessions = null;

async function initMongo() {
  if (!MONGODB_URI) {
    console.log('[Storage] Running in LOCAL file storage mode (data/quotedesk.json)');
    return;
  }
  try {
    console.log('[Storage] Connecting to MongoDB Atlas cloud database...');
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
      connectTimeoutMS: 8000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGODB_DBNAME || 'quotedesk');
    mongoConnected = true;
    console.log('✅ [Storage] Successfully connected to MongoDB Atlas Cloud Database!');

    // Initialize data from Cloud or seed local to cloud
    const cloudDoc = await mongoDb.collection('app_data').findOne({ _id: 'quotedesk_main' });
    if (cloudDoc && cloudDoc.data) {
      memoryDb = cloudDoc.data;
      // also keep local replica updated
      try { fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb), 'utf8'); } catch (e) {}
      console.log('[Storage] Loaded latest client data from Cloud Database.');
    } else {
      // If cloud is empty but local exists, migrate local to cloud
      const local = readJson(DB_FILE, null);
      if (local) {
        memoryDb = local;
        await mongoDb.collection('app_data').updateOne(
          { _id: 'quotedesk_main' },
          { $set: { _id: 'quotedesk_main', data: local, updatedAt: new Date() } },
          { upsert: true }
        );
        console.log('[Storage] Migrated existing local data to MongoDB Cloud Database!');
      }
    }
  } catch (err) {
    mongoConnected = false;
    console.error('⚠️ [Storage] MongoDB connection warning:', err.message);
    console.log('[Storage] Falling back to local file storage.');
  }
}

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

// ── Hybrid JSON / Cloud Storage ──────────────────────────────────────────────
function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return def; }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); } catch (e) {}
}

function getDb() {
  if (memoryDb) return memoryDb;
  memoryDb = readJson(DB_FILE, null);
  return memoryDb;
}

function saveDb(data) {
  memoryDb = data;
  // Always write local file backup
  writeJson(DB_FILE, data);
  // Persist to MongoDB Cloud if connected
  if (mongoConnected && mongoDb) {
    mongoDb.collection('app_data').updateOne(
      { _id: 'quotedesk_main' },
      { $set: { _id: 'quotedesk_main', data: data, updatedAt: new Date() } },
      { upsert: true }
    ).catch(err => console.error('[Storage] Cloud sync error:', err.message));
  }
}

function getSessions() {
  if (memorySessions) return memorySessions;
  memorySessions = readJson(SESS_FILE, {});
  return memorySessions;
}

function saveSessions(s) {
  memorySessions = s;
  writeJson(SESS_FILE, s);
}

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

// Cloud status
app.get('/api/cloud-status', (req, res) => {
  res.json({
    ok: true,
    cloud: mongoConnected,
    mode: mongoConnected ? 'MongoDB Atlas (Free Cloud Database)' : 'Local File Storage',
    mongoConfigured: !!MONGODB_URI
  });
});

// Serve app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize Cloud DB and start server
initMongo().then(() => {
  app.listen(PORT, () => console.log(`QuoteDesk running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('[Startup Error]', err);
  app.listen(PORT, () => console.log(`QuoteDesk running on http://localhost:${PORT}`));
});
