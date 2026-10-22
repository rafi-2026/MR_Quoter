'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');

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
const AUDIT_FILE = path.join(DATA_DIR, 'audit_logs.json');
const MONGODB_URI = process.env.MONGODB_URI || '';
const BASE_URL = process.env.BASE_URL || '';

// Master Admin Security & Mail OTP Configuration
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'rafioffl20@gmail.com';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || 'rafioffl20@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'lchtgoajiakktwhb';
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';

let mailTransporter = null;
function getTransporter() {
  if (mailTransporter) return mailTransporter;
  if (SMTP_USER && SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return mailTransporter;
}

// In-memory OTP storage: username => { otp, expires, attempts, ip, lastSent }
const pendingOtps = new Map();

async function sendAdminOtpEmail(email, otp, ip) {
  console.log(`\n=============================================================`);
  console.log(`🔐 [MASTER ADMIN OTP] Generated for: ${email}`);
  console.log(`👉 OTP CODE: ${otp} (Valid for 10 minutes)`);
  console.log(`🌐 Requested from IP: ${ip}`);
  console.log(`⏰ Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`=============================================================\n`);

  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"MR_Quoter Security" <${SMTP_USER}>`,
        to: email,
        subject: `Your Master Admin Security OTP: ${otp} - MR_Quoter`,
        html: `
          <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
            <div style="text-align:center;margin-bottom:24px;">
              <h2 style="color:#0f172a;margin:0;font-size:22px;">MR_Quoter Platform Security</h2>
              <p style="color:#64748b;font-size:14px;margin-top:4px;">Master Admin Verification</p>
            </div>
            <div style="background:#f8fafc;border-radius:8px;padding:20px;text-align:center;margin-bottom:20px;border:1px solid #cbd5e1;">
              <p style="margin:0 0 10px;color:#475569;font-size:14px;">Your one-time security code is:</p>
              <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0284c7;padding:6px 0;">${otp}</div>
              <p style="margin:10px 0 0;color:#dc2626;font-size:13px;font-weight:600;">Valid for 10 minutes</p>
            </div>
            <div style="font-size:13px;color:#64748b;line-height:1.5;margin-bottom:20px;">
              <p style="margin:0 0 6px;"><b>Login Details:</b></p>
              <p style="margin:0 0 4px;">• IP Address: <code>${ip}</code></p>
              <p style="margin:0 0 4px;">• Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:14px;margin:0;">
              If you did not request this login code, please review your server logs and secure your account immediately.
            </p>
          </div>
        `
      });
      console.log(`✅ [Email] Successfully sent OTP email to ${email}`);
      return { success: true };
    } catch (err) {
      console.error(`⚠️ [Email Error] Could not send OTP email via SMTP:`, err.message);
      return { success: false, error: err.message, fallbackConsole: true };
    }
  } else {
    console.log(`ℹ️ [Email Notice] SMTP credentials not set in .env. OTP printed to server log above for direct access.`);
    return { success: true, fallbackConsole: true };
  }
}

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
      try { fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb), 'utf8'); } catch (e) {}
      console.log('[Storage] Loaded latest client data from Cloud Database.');
    } else {
      const local = readJson(DB_FILE, null);
      if (local) {
        memoryDb = local;
        await mongoDb.collection('app_data').updateOne(
          { _id: 'quotedesk_main' },
          { $set: { _id: 'quotedesk_main', data: local, updatedAt: new Date() } },
          { upsert: true }
        );
        console.log('[Storage] Initialized MongoDB Cloud Database from local!');
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
  if (memoryDb) {
    if (memoryDb.settings && memoryDb.settings.company === 'Crescent Technobuild Pvt Ltd') {
      memoryDb.settings.company = 'MR_Quoter';
      if (memoryDb.settings.prefix === 'CTB/Q') memoryDb.settings.prefix = 'QT';
      if (memoryDb.settings.gstin === '33AAICC1673Q1Z9') memoryDb.settings.gstin = '';
      saveDb(memoryDb);
    }
    return memoryDb;
  }
  memoryDb = readJson(DB_FILE, null);
  if (memoryDb && memoryDb.settings && memoryDb.settings.company === 'Crescent Technobuild Pvt Ltd') {
    memoryDb.settings.company = 'MR_Quoter';
    if (memoryDb.settings.prefix === 'CTB/Q') memoryDb.settings.prefix = 'QT';
    if (memoryDb.settings.gstin === '33AAICC1673Q1Z9') memoryDb.settings.gstin = '';
    saveDb(memoryDb);
  }
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

// ── Login Activity Audit Helpers ─────────────────────────────────────────────
let memoryAuditLogs = null;

function getAuditLogs() {
  if (memoryAuditLogs) return memoryAuditLogs;
  memoryAuditLogs = readJson(AUDIT_FILE, []);
  return memoryAuditLogs;
}

function saveAuditLogs(logs) {
  memoryAuditLogs = logs;
  writeJson(AUDIT_FILE, logs);
  if (mongoConnected && mongoDb) {
    mongoDb.collection('audit_logs').updateOne(
      { _id: 'recent_audits' },
      { $set: { _id: 'recent_audits', logs: logs.slice(0, 500), updatedAt: new Date() } },
      { upsert: true }
    ).catch(err => console.error('[Audit] Cloud sync error:', err.message));
  }
}

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const list = xForwardedFor.split(',');
    return list[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress.replace(/^::ffff:/, '') : req.ip || 'Unknown';
}

function recordLoginLog(req, { companyId, companyName, userId, username, role, status, reason }) {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const logs = getAuditLogs();
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    timestamp: Date.now(),
    dateStr: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    ip: ip,
    companyId: companyId || '-',
    companyName: companyName || (role === 'master' ? 'Master Platform Admin' : 'General'),
    userId: userId || '-',
    username: username || '-',
    role: role || '-',
    userAgent: userAgent,
    status: status, // 'SUCCESS' | 'FAILED' | 'BLOCKED'
    reason: reason || ''
  };
  logs.unshift(entry);
  if (logs.length > 500) logs.length = 500;
  saveAuditLogs(logs);
  return entry;
}

// ── app ───────────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
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

// ── DEFAULT blank settings template for a fresh company ──────────────────────
const DEFAULT_COMPANY_SETTINGS = {
  company: '',
  tagline: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  website: '',
  gstin: '',
  prefix: 'QT/Q',
  validity: 30,
  gstRate: 18,
  approvalMode: 'rules',
  approvalAbove: 500000,
  maxDisc: 10,
  terms: 'Prices are valid for the period stated in this quotation.\nGST is charged as shown in the totals of this quotation.',
  pay: [
    { label: 'Advance with order', pct: 50 },
    { label: 'On material delivery at site', pct: 40 },
    { label: 'On completion and handover', pct: 10 }
  ],
  bank: { acName: '', bank: '', acNo: '', ifsc: '', branch: '', upiId: '' },
  headerImg: '',
  footerImg: '',
  authorisedDefault: 'Managing Director',
  authorisedTitleDefault: 'Authorised Signatory',
  glass: [
    { name: '5 mm clear glass', add: 0 },
    { name: '5 mm tinted glass', add: 25 },
    { name: '6 mm toughened clear', add: 45 },
    { name: '5+5 mm laminated', add: 90 },
    { name: 'DGU 6+12+6 mm toughened', add: 180 },
    { name: '6 mm reflective toughened', add: 70 }
  ],
  finish: [
    { name: 'Standard (anodised / white)', add: 0 },
    { name: 'Powder coated - standard colour', add: 30 },
    { name: 'Black matt', add: 35 },
    { name: 'Wooden finish', add: 70 }
  ],
  accentColor: '#1e40af',
  headerColor: '#000000'
};

// Get database - strictly tenant-isolated for company users
app.get('/api/db', auth, (req, res) => {
  const data = getDb();

  if (req.userId === 'master') {
    // Auto-tag any orphaned records to 'master' namespace on first read
    let dirty = false;
    const knownCompanyIds = new Set((data.companies || []).map(c => c.id));
    knownCompanyIds.add('master');

    (data.quotes || []).forEach(q => {
      if (!q.companyId || !knownCompanyIds.has(q.companyId)) {
        q.companyId = 'master'; dirty = true;
      }
    });
    (data.customers || []).forEach(c => {
      if (!c.companyId || !knownCompanyIds.has(c.companyId)) {
        c.companyId = 'master'; dirty = true;
      }
    });
    (data.users || []).forEach(u => {
      if (u.id !== 'master' && (!u.companyId || !knownCompanyIds.has(u.companyId))) {
        u.companyId = 'master'; dirty = true;
      }
    });
    if (dirty) saveDb(data);

    // ── MASTER sees ONLY its own data — company client data is PRIVATE ──────────
    // Master can manage companies/users (platform administration)
    // but CANNOT read any company's private quotes or customers
    return res.json({
      settings:        data.settings,
      companies:       data.companies || [],          // for management panel
      users:           (data.users || []).filter(u => u.companyId === 'master' || !u.companyId),  // master-level users only
      quotes:          (data.quotes    || []).filter(q => q.companyId === 'master'),  // master's own quotes only
      customers:       (data.customers || []).filter(c => c.companyId === 'master'),  // master's own customers only
      products:        data.products || [],
      items:           data.items || [],
      profiles:        data.profiles || [],
      seq:             (data.companySeq && data.companySeq['master']) || data.seq || {},
      companySettings: data.companySettings || {},     // for admin tools only
      companySeq:      data.companySeq || {}           // for admin tools only
    });
  }

  // ── COMPANY USER ─────────────────────────────────────────────────────────────
  const user = (data.users || []).find(u => u.id === req.userId);
  if (!user || !user.companyId) {
    // No company assigned — return empty safe shell
    return res.json({
      settings: { ...DEFAULT_COMPANY_SETTINGS },
      users: [], quotes: [], customers: [],
      products: [], items: [], companies: [],
      seq: {}, profiles: []
    });
  }

  const coId = user.companyId;
  const targetCompany = (data.companies || []).find(c => c.id === coId);

  // Load this company's OWN saved settings, falling back to blank defaults
  // NEVER inherit master settings (bank details, terms, header/footer, etc.)
  const companySettings = (data.companySettings && data.companySettings[coId])
    ? { ...DEFAULT_COMPANY_SETTINGS, ...data.companySettings[coId] }
    : { ...DEFAULT_COMPANY_SETTINGS };

  // Always override company/gstin/state/prefix from the companies registry
  // (master controls these fields when creating a company)
  companySettings.company = (targetCompany && targetCompany.name) || companySettings.company || '';
  companySettings.gstin   = (targetCompany && targetCompany.gstin)  || companySettings.gstin  || '';
  companySettings.state   = (targetCompany && targetCompany.state)  || companySettings.state  || '';
  companySettings.prefix  = (targetCompany && targetCompany.code)
    ? targetCompany.code + '/Q'
    : companySettings.prefix;

  const companyDb = {
    settings: companySettings,
    users:     (data.users     || []).filter(u => u.companyId === coId),
    quotes:    (data.quotes    || []).filter(q => q.companyId === coId),
    customers: (data.customers || []).filter(c => c.companyId === coId),
    products:  (data.products  || []).filter(p => !p.companyId || p.companyId === coId),
    items:     (data.items     || []).filter(i => !i.companyId || i.companyId === coId),
    companies: targetCompany ? [targetCompany] : [],
    seq:       (data.companySeq && data.companySeq[coId]) || {},
    profiles:  []
  };
  res.json(companyDb);
});

// Save database - strictly tenant-isolated for company users
app.post('/api/db', auth, (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Invalid data' });

  if (req.userId === 'master') {
    // ── MASTER SAVE: surgical merge — only update master's own namespace ─────────
    // NEVER overwrite company clients' private quotes, customers, settings, or users
    const fullData = getDb();

    // 1. Update master's own settings (bank, terms, etc.)
    if (incoming.settings) {
      fullData.settings = incoming.settings;
    }

    // 2. Replace master's own quotes only (companyId === 'master')
    if (Array.isArray(incoming.quotes)) {
      const masterQuotes = incoming.quotes.map(q => ({ ...q, companyId: 'master' }));
      fullData.quotes = [
        ...(fullData.quotes || []).filter(q => q.companyId !== 'master'),
        ...masterQuotes
      ];
    }

    // 3. Replace master's own customers only
    if (Array.isArray(incoming.customers)) {
      const masterCustomers = incoming.customers.map(c => ({ ...c, companyId: 'master' }));
      fullData.customers = [
        ...(fullData.customers || []).filter(c => c.companyId !== 'master'),
        ...masterCustomers
      ];
    }

    // 4. Update company list (master manages companies)
    if (Array.isArray(incoming.companies)) {
      fullData.companies = incoming.companies;
    }

    // 5. Update shared product catalog if sent
    if (Array.isArray(incoming.products)) {
      fullData.products = incoming.products;
    }
    if (Array.isArray(incoming.items)) {
      fullData.items = incoming.items;
    }

    // 6. Save master's own seq separately
    if (incoming.seq) {
      if (!fullData.companySeq) fullData.companySeq = {};
      fullData.companySeq['master'] = incoming.seq;
    }

    // 7. Update master-level users if sent (but preserve company users)
    if (Array.isArray(incoming.users)) {
      const masterUsers = incoming.users.map(u => ({ ...u, companyId: u.companyId || 'master' }));
      // Only replace users that belong to master, keep all company users intact
      const companyUsers = (fullData.users || []).filter(u => u.companyId && u.companyId !== 'master');
      fullData.users = [...companyUsers, ...masterUsers.filter(u => u.companyId === 'master')];
    }

    // NOTE: fullData.companySettings and company-tagged quotes/customers/users are NEVER touched
    saveDb(fullData);
    return res.json({ ok: true });
  }

  // ── COMPANY USER SAVE ─────────────────────────────────────────────────────────
  const fullData = getDb();
  const user = (fullData.users || []).find(u => u.id === req.userId);
  const coId = user && user.companyId;
  if (!coId) {
    return res.status(403).json({ error: 'No company assigned to user.' });
  }

  // 1. Save this company's settings into its own private namespace
  if (incoming.settings) {
    if (!fullData.companySettings) fullData.companySettings = {};
    // Strip out company/gstin/state/prefix — those are controlled by master
    const { company, gstin, state, prefix, ...ownSettings } = incoming.settings;
    fullData.companySettings[coId] = ownSettings;
  }

  // 2. Tag and merge quotes
  const incomingQuotes = (incoming.quotes || []).map(q => ({ ...q, companyId: coId }));
  fullData.quotes = [
    ...(fullData.quotes || []).filter(q => q.companyId !== coId),
    ...incomingQuotes
  ];

  // 3. Tag and merge customers
  const incomingCustomers = (incoming.customers || []).map(c => ({ ...c, companyId: coId }));
  fullData.customers = [
    ...(fullData.customers || []).filter(c => c.companyId !== coId),
    ...incomingCustomers
  ];

  // 4. Tag and merge users
  const incomingUsers = (incoming.users || []).map(u => ({ ...u, companyId: coId }));
  fullData.users = [
    ...(fullData.users || []).filter(u => u.companyId !== coId),
    ...incomingUsers
  ];

  // 5. Save company quote sequence separately (no number clash across companies)
  if (!fullData.companySeq) fullData.companySeq = {};
  if (incoming.seq) fullData.companySeq[coId] = incoming.seq;

  saveDb(fullData);
  res.json({ ok: true });
});

// Check if setup needed
app.get('/api/setup-needed', (req, res) => {
  const data = getDb();
  res.json({ needed: !data || !data.users || data.users.length === 0 });
});

// Public init endpoint - returns minimal data for login/setup screen (no auth needed)
app.get('/api/init', (req, res) => {
  const data = getDb();
  const hasUsers = !!(data && data.users && data.users.length > 0);
  const company = (data && data.settings && data.settings.company) || '';
  const accentColor = (data && data.settings && data.settings.accentColor) || '';
  const headerColor = (data && data.settings && data.settings.headerColor) || '';
  res.json({ hasUsers, company, accentColor, headerColor });
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

// Login with IP tracking & Multi-Company support
app.post('/api/login', async (req, res) => {
  const { username, password, companyCode } = req.body || {};
  const clientIp = getClientIp(req);
  const un = (username || '').trim().toLowerCase();

  // 1. MASTER SUPERADMIN LOGIN -> Instant direct login
  if (un === 'master') {
    if (password === 'Rafiq@24') {
      const token = createSession('master');
      res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
      recordLoginLog(req, {
        companyId: 'MASTER',
        companyName: 'Master Platform Admin',
        userId: 'master',
        username: 'master',
        role: 'master',
        status: 'SUCCESS',
        reason: 'Master Admin direct sign in'
      });
      return res.json({
        ok: true,
        userId: 'master',
        role: 'master',
        token
      });
    } else {
      recordLoginLog(req, {
        username: 'master',
        role: 'master',
        status: 'FAILED',
        reason: 'Incorrect master password'
      });
      return res.status(401).json({ error: 'Wrong username or password' });
    }
  }

  // 2. COMPANY USER LOGIN
  const data = getDb();
  if (!data) return res.status(400).json({ error: 'App not set up yet' });

  const companies = data.companies || [];
  let user = null;
  let targetCompany = null;

  // Filter by companyCode if provided
  if (companyCode) {
    const codeClean = companyCode.trim().toLowerCase();
    targetCompany = companies.find(c =>
      (c.code && c.code.toLowerCase() === codeClean) ||
      (c.id && c.id.toLowerCase() === codeClean) ||
      (c.name && c.name.toLowerCase().includes(codeClean))
    );
    if (!targetCompany) {
      recordLoginLog(req, {
        username: un,
        status: 'FAILED',
        reason: `Company code "${companyCode}" not found`
      });
      return res.status(404).json({ error: 'Company not found with that code.' });
    }
    if (targetCompany.active === false) {
      recordLoginLog(req, {
        companyId: targetCompany.id,
        companyName: targetCompany.name,
        username: un,
        status: 'BLOCKED',
        reason: 'Company account is deactivated'
      });
      return res.status(403).json({ error: 'Company account is disabled by Master Admin.' });
    }
    user = (data.users || []).find(u =>
      (u.companyId === targetCompany.id || (!u.companyId && targetCompany.id === 'k88ft5zx1un')) &&
      (u.username || '').toLowerCase() === un
    );
  } else {
    // Direct username lookup across active users
    user = (data.users || []).find(u => (u.username || '').toLowerCase() === un);
    if (user && user.companyId) {
      targetCompany = companies.find(c => c.id === user.companyId);
    }
    if (!targetCompany && companies.length > 0) {
      targetCompany = companies.find(c => c.active) || companies[0];
    }
  }

  if (!user) {
    recordLoginLog(req, {
      username: un,
      status: 'FAILED',
      reason: 'User not found'
    });
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  // Verify password hash
  const raw = (user.salt || '') + ':' + password;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const fallback = 'c' + cyrbHash(raw);
  if (user.pass !== hash && user.pass !== fallback) {
    recordLoginLog(req, {
      companyId: targetCompany ? targetCompany.id : (user.companyId || '-'),
      companyName: targetCompany ? targetCompany.name : ((data.settings && data.settings.company) || 'Primary Company'),
      userId: user.id,
      username: user.username,
      role: user.role,
      status: 'FAILED',
      reason: 'Incorrect password'
    });
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  if (targetCompany && targetCompany.active === false) {
    recordLoginLog(req, {
      companyId: targetCompany.id,
      companyName: targetCompany.name,
      userId: user.id,
      username: user.username,
      status: 'BLOCKED',
      reason: 'Company disabled'
    });
    return res.status(403).json({ error: 'This company account is disabled. Contact Master Admin.' });
  }

  if (!user.active) {
    recordLoginLog(req, {
      companyId: targetCompany ? targetCompany.id : '-',
      companyName: targetCompany ? targetCompany.name : '-',
      userId: user.id,
      username: user.username,
      status: 'BLOCKED',
      reason: 'User account disabled'
    });
    return res.status(403).json({ error: 'Your account is disabled. Contact company administrator.' });
  }

  // Record successful login with client IP
  recordLoginLog(req, {
    companyId: targetCompany ? targetCompany.id : (user.companyId || '-'),
    companyName: targetCompany ? targetCompany.name : ((data.settings && data.settings.company) || 'Primary Company'),
    userId: user.id,
    username: user.username,
    role: user.role,
    status: 'SUCCESS'
  });

  const token = createSession(user.id);
  res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, userId: user.id, companyId: user.companyId || (targetCompany && targetCompany.id) });
});

// Master Admin OTP Verification
app.post('/api/admin/verify-otp', (req, res) => {
  const { otp } = req.body || {};
  const clientIp = getClientIp(req);
  const pending = pendingOtps.get('master');

  // Accept valid OTP or master password directly
  if (otp === 'Rafiq@24' || (pending && String(otp || '').trim() === String(pending.otp).trim())) {
    pendingOtps.delete('master');
    const token = createSession('master');
    res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    recordLoginLog(req, {
      companyId: 'MASTER',
      companyName: 'Master Platform Admin',
      userId: 'master',
      username: 'master',
      role: 'master',
      status: 'SUCCESS',
      reason: 'Verified OTP'
    });
    return res.json({ ok: true, userId: 'master' });
  }

  if (!pending) {
    return res.status(400).json({ error: 'No OTP session found or expired. Please sign in again.' });
  }

  if (Date.now() > pending.expires) {
    pendingOtps.delete('master');
    return res.status(400).json({ error: 'Security OTP expired. Please sign in again.' });
  }

  if (pending.attempts >= 4) {
    pendingOtps.delete('master');
    recordLoginLog(req, {
      username: 'master',
      role: 'master',
      status: 'BLOCKED',
      reason: 'Maximum OTP attempts exceeded'
    });
    return res.status(403).json({ error: 'Too many incorrect attempts. Please sign in again.' });
  }

  if (String(otp || '').trim() !== String(pending.otp).trim()) {
    pending.attempts += 1;
    recordLoginLog(req, {
      username: 'master',
      role: 'master',
      status: 'FAILED',
      reason: `Wrong OTP entered (Attempt ${pending.attempts}/4)`
    });
    return res.status(400).json({ error: `Invalid security code. (${4 - pending.attempts} attempts remaining)` });
  }

  // OTP verified successfully
  pendingOtps.delete('master');
  const token = createSession('master');
  res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });

  recordLoginLog(req, {
    companyId: 'MASTER',
    companyName: 'Master Platform Admin',
    userId: 'master',
    username: 'master',
    role: 'master',
    status: 'SUCCESS',
    reason: 'Verified via Email OTP'
  });

  res.json({ ok: true, userId: 'master' });
});

// Resend Admin OTP
app.post('/api/admin/resend-otp', async (req, res) => {
  const clientIp = getClientIp(req);
  const pending = pendingOtps.get('master');
  if (pending && Date.now() - (pending.lastSent || 0) < 30000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before requesting another code.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  pendingOtps.set('master', {
    otp,
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    ip: clientIp,
    lastSent: Date.now()
  });

  await sendAdminOtpEmail(ADMIN_EMAIL, otp, clientIp);

  res.json({
    ok: true,
    message: 'New security code sent to ' + ADMIN_EMAIL.replace(/(^.{2})(.*)(?=@)/, (m, a, b) => a + '*'.repeat(Math.max(1, b.length))),
    devHint: !SMTP_USER ? `Dev Notice: Check server console for code (${otp})` : null
  });
});

// Master Admin: Reset all demo/sample data to clean state
app.post('/api/admin/reset-data', auth, (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const cleanDb = {
    settings: {
      company: '',
      tagline: '',
      prefix: 'QT/Q',
      validity: 30,
      gstRate: 18,
      approvalMode: 'rules',
      approvalAbove: 500000,
      maxDisc: 10,
      terms: 'Prices are valid for the period stated in this quotation.\nGST is charged as shown in the totals of this quotation.\nFinal sizes and quantities will be confirmed after site measurement; billing will follow executed work.\nDelivery and completion schedule will be confirmed after receipt of advance and approval of drawings.\nThe client will provide clear site access, power, water and safe storage during execution.\nWork not mentioned in this quotation will be charged extra.\nWarranty and defect liability will be as per our standard terms confirmed in the work order.',
      pay: [{ label: 'Advance with order', pct: 50 }, { label: 'On material delivery at site', pct: 40 }, { label: 'On completion and handover', pct: 10 }],
      bank: { acName: '', bank: '', acNo: '', ifsc: '', branch: '' },
      headerImg: '',
      footerImg: '',
      authorisedDefault: 'Managing Director',
      authorisedTitleDefault: 'Authorised Signatory',
      glass: [{ name: '5 mm clear glass', add: 0 }, { name: '5 mm tinted glass', add: 25 }, { name: '6 mm toughened clear', add: 45 }, { name: '5+5 mm laminated', add: 90 }, { name: 'DGU 6+12+6 mm toughened', add: 180 }, { name: '6 mm reflective toughened', add: 70 }],
      finish: [{ name: 'Standard (anodised / white)', add: 0 }, { name: 'Powder coated - standard colour', add: 30 }, { name: 'Black matt', add: 35 }, { name: 'Wooden finish', add: 70 }],
      accentColor: '#1e40af',
      headerColor: '#000000'
    },
    companies: [],
    users: [],
    customers: [],
    quotes: [],
    products: [],
    items: [],
    profiles: [],
    seq: {}
  };

  saveDb(cleanDb);

  recordLoginLog(req, {
    companyId: 'MASTER',
    companyName: 'Master Platform Admin',
    userId: 'master',
    username: 'master',
    role: 'master',
    status: 'SUCCESS',
    reason: 'Wiped all company and quote data to clean slate'
  });

  res.json({ ok: true, message: 'All demo and existing data erased. Software is now a clean slate.' });
});

// Master Admin: View Login Audit Logs with IP Tracker
app.get('/api/admin/login-audit', auth, (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const logs = getAuditLogs();
  res.json({ ok: true, logs });
});

// Master Admin: Delete Company
app.delete('/api/admin/companies/:id', auth, (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const companyId = req.params.id;
  const data = getDb();
  if (!data || !data.companies) return res.status(404).json({ error: 'No data' });

  const idx = data.companies.findIndex(c => c.id === companyId);
  if (idx === -1) return res.status(404).json({ error: 'Company not found' });

  const removed = data.companies.splice(idx, 1)[0];

  // Also remove users associated specifically with this deleted company
  if (data.users) {
    data.users = data.users.filter(u => u.companyId !== companyId);
  }

  saveDb(data);

  recordLoginLog(req, {
    companyId,
    companyName: removed.name,
    userId: 'master',
    username: 'master',
    role: 'master',
    status: 'SUCCESS',
    reason: `Deleted company "${removed.name}"`
  });

  res.json({ ok: true, message: `Company "${removed.name}" deleted successfully.` });
});

// Master Admin: Alter / Edit Company
app.put('/api/admin/companies/:id', auth, (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const companyId = req.params.id;
  const { name, code, gstin, state, active } = req.body || {};
  const data = getDb();
  if (!data || !data.companies) return res.status(404).json({ error: 'No data' });

  const comp = data.companies.find(c => c.id === companyId);
  if (!comp) return res.status(404).json({ error: 'Company not found' });

  if (name !== undefined) comp.name = String(name).trim();
  if (code !== undefined) comp.code = String(code).trim().toUpperCase();
  if (gstin !== undefined) comp.gstin = String(gstin).trim().toUpperCase();
  if (state !== undefined) comp.state = String(state).trim();
  if (active !== undefined) comp.active = !!active;
  comp.updatedAt = Date.now();

  saveDb(data);
  res.json({ ok: true, company: comp });
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

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Send quotation email with PDF attachment
app.post('/api/quotes/:id/email-pdf', auth, async (req, res) => {
  const { recipientEmail, subject, message, pdfBase64 } = req.body || {};
  if (!recipientEmail) return res.status(400).json({ error: 'Recipient email is required.' });
  if (!pdfBase64) return res.status(400).json({ error: 'PDF data is required.' });

  const data = getDb();
  const q = (data && data.quotes || []).find(x => x.id === req.params.id);
  const company = (data && data.settings && data.settings.company) || 'MR_Quoter';
  const transporter = getTransporter();

  if (!transporter) {
    return res.status(500).json({ error: 'Email service is not configured with SMTP credentials.' });
  }

  const safeFilename = `Quotation_${(q ? q.no : 'quote').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
  const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');

  try {
    await transporter.sendMail({
      from: `"${company}" <${SMTP_USER}>`,
      to: recipientEmail,
      subject: subject || `Quotation ${q ? q.no : ''} from ${company}`,
      html: `
        <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff">
          <h2 style="color:#1b2a2f;margin-top:0">${esc(company)}</h2>
          <div style="color:#334155;font-size:15px;line-height:1.6;white-space:pre-line;margin-bottom:20px">${esc(message || '')}</div>
          <div style="background:#f8fafc;padding:14px 18px;border-radius:8px;border:1px solid #cbd5e1;margin:20px 0;display:flex;align-items:center;gap:12px">
            <span style="font-size:24px">📄</span>
            <div>
              <b style="color:#0f172a">${safeFilename}</b>
              <div style="color:#64748b;font-size:13px">Official quotation document attached.</div>
            </div>
          </div>
          <p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:14px;margin-bottom:0">
            Sent via MR_Quoter Platform.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: safeFilename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    res.json({ ok: true, message: `Quotation PDF sent successfully to ${recipientEmail}!` });
  } catch (err) {
    console.error('Email PDF send error:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// ── Share quote: generate token + WhatsApp link ────────────────────────────
app.post('/api/quotes/:id/share', auth, (req, res) => {
  const data = getDb();
  if (!data || !data.quotes) return res.status(404).json({ error: 'No data' });
  const quote = data.quotes.find(q => q.id === req.params.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  if (!['approved', 'sent', 'won'].includes(quote.status))
    return res.status(400).json({ error: 'Quote must be approved first before sharing.' });

  // Generate or reuse token
  if (!quote.shareToken) quote.shareToken = crypto.randomBytes(16).toString('hex');
  if (!quote.sentAt) quote.sentAt = Date.now();
  if (quote.status === 'approved') quote.status = 'sent';

  saveDb(data);

  const host = BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${host}/q/${quote.shareToken}`;
  const phone = String(quote.cust && quote.cust.phone || '').replace(/\D/g, '');
  const customerName = (quote.cust && quote.cust.contact) || (quote.cust && quote.cust.name) || 'Sir/Madam';
  const companyName = (data.settings && data.settings.company) || 'Us';
  const msg = `Dear ${customerName},\n\nPlease find our Quotation *${quote.no}* at the link below:\n${url}\n\nYou can view the full quotation and formally accept it online.\n\nRegards,\n${companyName}`;
  const waPhone = phone.length === 10 ? '91' + phone : phone;
  const whatsapp = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;

  res.json({
    url,
    whatsapp,
    token: quote.shareToken,
    viewCount: quote.viewCount || 0,
    acceptedBy: quote.acceptedBy || null,
    acceptedAt: quote.acceptedAt || null
  });
});

// Helper: Live SVG Window/Door drawing for public quotation view
function renderPublicSvg(glyph, w, h) {
  const numW = Math.max(parseFloat(w) || 1200, 100);
  const numH = Math.max(parseFloat(h) || 1200, 100);
  const maxW = 120, maxH = 90;
  const s = Math.min(maxW / numW, maxH / numH);
  const W = Math.round(numW * s), H = Math.round(numH * s), f = 4;
  let inner = '';
  const type = String(glyph || '').toLowerCase();
  if (type.includes('slid')) {
    const pw = Math.round((W - 2 * f) / 2 + 2);
    inner = `<rect x="${f}" y="${f}" width="${pw}" height="${H - 2 * f}" fill="#cfe8f1" stroke="#5a7f8c" stroke-width="1"/><rect x="${W - f - pw}" y="${f}" width="${pw}" height="${H - 2 * f}" fill="#e3f2f8" stroke="#5a7f8c" stroke-width="1"/><path d="M${Math.round(W * 0.3)} ${Math.round(H / 2)} h${Math.round(W * 0.15)} m-4 -3 l4 3 l-4 3" stroke="#2a6080" fill="none" stroke-width="1"/>`;
  } else if (type.includes('case')) {
    inner = `<rect x="${f}" y="${f}" width="${W - 2 * f}" height="${H - 2 * f}" fill="#cfe8f1" stroke="#5a7f8c" stroke-width="1"/><path d="M${f} ${f} L${W - f} ${Math.round(H / 2)} L${f} ${H - f}" stroke="#2a6080" fill="none" stroke-dasharray="3 3" stroke-width="1"/>`;
  } else if (type.includes('door')) {
    inner = `<rect x="${f}" y="${f}" width="${W - 2 * f}" height="${H - 2 * f}" fill="#f5ede0" stroke="#8b6347" stroke-width="1"/><circle cx="${W - f - 5}" cy="${Math.round(H / 2)}" r="2" fill="#8b6347"/>`;
  } else {
    inner = `<rect x="${f}" y="${f}" width="${W - 2 * f}" height="${H - 2 * f}" fill="#cfe8f1" stroke="#5a7f8c" stroke-width="1"/><line x1="${f + 4}" y1="${H - f - 4}" x2="${W - f - 4}" y2="${f + 4}" stroke="#8ab8cc" stroke-width="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -14 ${W + 4} ${H + 18}" width="${W + 4}" height="${H + 18}" style="display:inline-block;vertical-align:middle;margin-right:8px"><rect width="${W}" height="${H}" fill="#9aa5ad" stroke="#334" stroke-width="1" rx="1"/>${inner}<text x="${W / 2}" y="-3" text-anchor="middle" font-size="9" fill="#2a6080" font-family="sans-serif">${numW}×${numH}mm</text></svg>`;
}

// ── Public client quote view (no login) ───────────────────────────────────
app.get('/q/:token', (req, res) => {
  const data = getDb();
  if (!data || !data.quotes) return res.status(404).send('Link not found.');
  const q = data.quotes.find(x => x.shareToken === req.params.token);
  if (!q) return res.status(404).send('<h2 style="font-family:sans-serif;padding:40px;color:#b91c1c">This link has expired or is invalid.</h2>');

  // Track views
  q.viewCount = (q.viewCount || 0) + 1;
  if (!q.firstViewedAt) q.firstViewedAt = Date.now();
  saveDb(data);

  const s = data.settings || {};
  const c = q.cust || {};
  const b = s.bank || {};

  // Compute pricing totals
  let subtotal = 0;
  const processedLines = (q.lines || []).map((l, idx) => {
    if (l.type === 'section') return { ...l, isSec: true };
    const qty = parseFloat(l.qty) || 1;
    let amt = 0, area = 0, billedArea = 0;
    if (l.type === 'boq') {
      const rate = parseFloat(l.rate) || 0;
      let gross = qty * rate;
      const disc = parseFloat(l.disc) || 0;
      amt = Math.max(0, gross - (gross * disc / 100));
      subtotal += amt;
      return { ...l, amt, rate, qty, idx: idx + 1 };
    }
    const w = parseFloat(l.w) || 0, h = parseFloat(l.h) || 0;
    area = (w / 304.8) * (h / 304.8);
    const minArea = parseFloat(l.minArea) || 0;
    billedArea = Math.max(area, minArea);
    const rate = parseFloat(l.rate) || 0;
    const hw = parseFloat(l.hw) || 0;
    let gross = (billedArea * rate + hw) * qty;
    const disc = parseFloat(l.disc) || 0;
    amt = Math.max(0, gross - (gross * disc / 100));
    subtotal += amt;
    return { ...l, amt, rate, qty, billedArea, totalArea: billedArea * qty, idx: idx + 1 };
  });

  let discount = 0;
  if (q.discVal) {
    if (q.discType === 'flat') discount = parseFloat(q.discVal) || 0;
    else discount = subtotal * (parseFloat(q.discVal) || 0) / 100;
  }
  const extras = (q.extras || []).reduce((acc, ex) => acc + (parseFloat(ex.amount) || 0), 0);
  const taxable = Math.max(0, subtotal - discount + extras);
  const gstRate = q.gst ? (parseFloat(q.gstRate) || 18) : 0;
  const gstAmt = q.gst ? Math.round(taxable * gstRate / 100) : 0;
  const grandTotal = Math.round(taxable + gstAmt);

  const fmt = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const inr = n => '₹' + fmt(n);

  const statusBanner = q.acceptedBy
    ? `<div style="background:#ecfdf5;border:2px solid #10b981;border-radius:10px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 6px rgba(16,185,129,0.15)">
        <span style="font-size:24px">✅</span>
        <div><b style="color:#065f46;font-size:1.05rem">Accepted by ${q.acceptedBy}</b><br><small style="color:#047857">Formally accepted online on ${new Date(q.acceptedAt).toLocaleString('en-IN')}</small></div>
       </div>`
    : q.status === 'sent'
      ? `<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div><b style="color:#92400e;font-size:1rem">📋 Official Quotation awaiting your confirmation</b><br><small style="color:#b45309">Please review the details below. You can accept this quotation directly online.</small></div>
          <a href="#acceptSection" style="background:#16a34a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:0.95rem;display:inline-block">Accept Quotation &darr;</a>
         </div>`
      : `<div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:12px 20px;margin-bottom:20px">Status: <b>${q.status.toUpperCase()}</b></div>`;

  const acceptSection = (!q.acceptedBy && q.status === 'sent') ? `
    <div id="acceptSection" style="background:#f0fdf4;border:2px solid #22c55e;border-radius:12px;padding:28px 24px;margin:28px auto;max-width:540px;box-shadow:0 4px 14px rgba(34,197,94,0.15)">
      <h3 style="margin:0 0 10px;color:#15803d;font-size:1.3rem;display:flex;align-items:center;gap:8px"><span>✍️</span> Accept Quotation Online</h3>
      <p style="margin:0 0 16px;color:#374151;font-size:0.95rem;line-height:1.4">By entering your name and clicking Accept, you confirm your approval of this quotation and authorization to proceed with the specified work and terms.</p>
      <input id="acceptName" placeholder="Enter your full name *" style="width:100%;padding:12px 14px;border:1.5px solid #86efac;border-radius:8px;font-size:16px;margin-bottom:14px;box-sizing:border-box;outline:none" value="${c.contact || c.name || ''}">
      <button id="acceptBtn" onclick="submitAccept()" style="background:#16a34a;color:#fff;border:0;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;width:100%;box-shadow:0 2px 6px rgba(22,163,74,0.3);transition:background .2s">Confirm &amp; Accept Quotation</button>
      <div id="acceptMsg" style="margin-top:12px;text-align:center;font-weight:500"></div>
    </div>
    <script>
    async function submitAccept() {
      const name = document.getElementById('acceptName').value.trim();
      if (!name || name.length < 2) {
        document.getElementById('acceptMsg').innerHTML = '<span style="color:#dc2626">Please enter your full name.</span>';
        return;
      }
      const btn = document.getElementById('acceptBtn');
      btn.disabled = true;
      btn.textContent = 'Submitting acceptance...';
      try {
        const r = await fetch('/q/${req.params.token}/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const d = await r.json();
        if (d.ok) {
          document.getElementById('acceptSection').innerHTML = '<div style="text-align:center;padding:16px"><h2 style="color:#15803d;margin:0 0 8px">🎉 Thank you, ' + name + '!</h2><p style="color:#374151;font-size:1.1rem;margin:0">Quotation accepted successfully. The company has been notified to proceed.</p></div>';
          setTimeout(() => location.reload(), 2500);
        } else {
          document.getElementById('acceptMsg').innerHTML = '<span style="color:#dc2626">' + (d.error || 'Could not complete. Please contact us.') + '</span>';
          btn.disabled = false;
          btn.textContent = 'Confirm & Accept Quotation';
        }
      } catch(e) {
        document.getElementById('acceptMsg').innerHTML = '<span style="color:#dc2626">Network error. Please try again.</span>';
        btn.disabled = false;
        btn.textContent = 'Confirm & Accept Quotation';
      }
    }
    </script>` : '';

  let rowCounter = 0;
  const lineRowsHtml = processedLines.map(l => {
    if (l.isSec) {
      return `<tr style="background:#f1f5f9;font-weight:700;color:#334155"><td colspan="6" style="padding:10px 12px">${l.title || 'Section'}</td></tr>`;
    }
    rowCounter++;
    const isSize = l.type === 'size';
    const svgPreview = isSize && l.w && l.h ? renderPublicSvg(l.glyph, l.w, l.h) : '';
    const specs = [
      (l.tag || l.loc) ? `<b>${[l.tag && 'Mark ' + l.tag, l.loc].filter(Boolean).join(' - ')}</b>` : '',
      l.spec || '',
      [l.glassName, l.finishName].filter(Boolean).join('; ')
    ].filter(Boolean).join('<br>');

    return `<tr style="border-bottom:1px solid #e2e8f0">
      <td style="text-align:center;padding:12px 8px;vertical-align:top;color:#64748b">${rowCounter}</td>
      <td style="padding:12px 10px;vertical-align:top">
        <div style="display:flex;align-items:flex-start;gap:8px">
          ${svgPreview}
          <div>
            <div style="font-weight:700;font-size:0.95rem;color:#0f172a">${l.name || (isSize ? 'Window / Door' : 'Item')}</div>
            ${specs ? `<div style="font-size:0.85rem;color:#475569;margin-top:4px;line-height:1.4">${specs}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="text-align:right;padding:12px 10px;vertical-align:top;color:#334155;white-space:nowrap">${isSize ? `${l.w} × ${l.h} ${q.dimUnit || 'mm'}` : '-'}</td>
      <td style="text-align:right;padding:12px 10px;vertical-align:top;color:#334155;white-space:nowrap">${l.qty} ${l.unit || (isSize ? 'nos' : '')}</td>
      <td style="text-align:right;padding:12px 10px;vertical-align:top;color:#334155;white-space:nowrap">${inr(l.rate)}<div style="font-size:0.75rem;color:#64748b">${isSize ? '/ sq ft' : ''}</div></td>
      <td style="text-align:right;padding:12px 10px;vertical-align:top;font-weight:700;color:#0f172a;white-space:nowrap">${inr(l.amt)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="padding:20px;text-align:center;color:#64748b">No line items in this quotation.</td></tr>`;

  const paymentsHtml = (q.pay || []).filter(p => p.label || p.pct).map(p => {
    const amt = Math.round(grandTotal * (parseFloat(p.pct) || 0) / 100);
    return `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 10px">${p.label}</td><td style="text-align:right;padding:8px 10px">${p.pct}%</td><td style="text-align:right;padding:8px 10px;font-weight:600">${inr(amt)}</td></tr>`;
  }).join('');

  const termsHtml = (q.terms || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => `<li style="margin-bottom:4px">${t}</li>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Quotation ${q.no} - ${(s.company || 'QuoteDesk')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
  <style>
    body { background:#f1f5f9; color:#1e293b; margin:0; padding:20px; font-family:'Plus Jakarta Sans',sans-serif; -webkit-font-smoothing:antialiased }
    .wrap { max-width:920px; margin:0 auto }
    .bar { background:#fff; padding:14px 22px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.06); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px }
    .sheet { background:#fff; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,.08); padding:40px; box-sizing:border-box }
    .hdr-grid { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #e2e8f0; padding-bottom:24px; margin-bottom:24px; gap:20px; flex-wrap:wrap }
    .meta-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 18px; font-size:0.9rem }
    .meta-box table td { padding:3px 6px }
    .party-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px }
    .tot-table { width:100%; border-collapse:collapse; margin-top:12px }
    .tot-table td { padding:6px 10px }
    .doc-table { width:100%; border-collapse:collapse; margin:20px 0 }
    .doc-table th { background:#f8fafc; color:#475569; font-weight:600; text-align:left; padding:10px 10px; font-size:0.85rem; border-bottom:2px solid #cbd5e1 }
    @media (max-width:640px) {
      body { padding:10px }
      .sheet { padding:20px 16px }
      .party-grid { grid-template-columns:1fr }
    }
    @media print {
      .bar, #acceptSection, .no-print { display:none!important }
      body { background:#fff; padding:0 }
      .sheet { box-shadow:none; padding:0; border-radius:0 }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <div>
        <h2 style="margin:0;font-size:1.15rem;color:#0f172a">${s.company || 'Quotation'}</h2>
        <small style="color:#64748b">Ref: <b>${q.no}</b> &bull; Viewed ${q.viewCount} time${q.viewCount !== 1 ? 's' : ''}</small>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="window.print()" style="background:#0284c7;color:#fff;border:0;padding:9px 18px;border-radius:6px;font-weight:600;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;gap:6px">🖨️ Print / Save PDF</button>
      </div>
    </div>

    ${statusBanner}

    <div class="sheet">
      <!-- Company Header -->
      <div class="hdr-grid">
        <div>
          <h1 style="margin:0 0 4px;font-size:1.6rem;color:#0f172a">${s.company || 'QUOTATION'}</h1>
          ${s.tagline ? `<div style="color:#64748b;font-size:0.95rem;margin-bottom:6px">${s.tagline}</div>` : ''}
          <div style="font-size:0.85rem;color:#475569;line-height:1.4">
            ${[s.address1, s.address2, s.city, s.state && (s.state + (s.pincode ? ' - ' + s.pincode : ''))].filter(Boolean).join(', ')}<br>
            ${[s.phone && 'Phone: ' + s.phone, s.email && 'Email: ' + s.email, s.website].filter(Boolean).join(' &bull; ')}<br>
            ${s.gstin ? `<b>GSTIN:</b> ${s.gstin}` : ''}
          </div>
        </div>
        <div class="meta-box">
          <div style="font-weight:700;font-size:1.2rem;color:#0284c7;margin-bottom:8px">QUOTATION</div>
          <table style="border-collapse:collapse">
            <tr><td style="color:#64748b">Quote No:</td><td><b>${q.no}</b></td></tr>
            <tr><td style="color:#64748b">Date:</td><td><b>${q.date}</b></td></tr>
            <tr><td style="color:#64748b">Valid Until:</td><td><b>${q.validUntil || (q.validity ? q.validity + ' days' : '30 days')}</b></td></tr>
            ${q.rev ? `<tr><td style="color:#64748b">Revision:</td><td>${q.rev}</td></tr>` : ''}
          </table>
        </div>
      </div>

      <!-- Parties -->
      <div class="party-grid">
        <div style="background:#f8fafc;padding:14px;border-radius:8px;border:1px solid #e2e8f0">
          <div style="font-size:0.75rem;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:4px">Quotation For:</div>
          <div style="font-weight:700;font-size:1.05rem;color:#0f172a">${c.name || 'Valued Customer'}</div>
          ${c.contact ? `<div>Attn: ${c.contact}</div>` : ''}
          ${c.site ? `<div>Site: ${c.site}</div>` : ''}
          ${c.phone ? `<div>Phone: ${c.phone}</div>` : ''}
          ${c.email ? `<div>Email: ${c.email}</div>` : ''}
          ${c.gstin ? `<div>GSTIN: ${c.gstin}</div>` : ''}
        </div>
        <div style="background:#f8fafc;padding:14px;border-radius:8px;border:1px solid #e2e8f0">
          <div style="font-size:0.75rem;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:4px">Project Details:</div>
          <div style="font-weight:700;font-size:1.05rem;color:#0f172a">${q.project || 'Supply and Installation'}</div>
          ${q.subject ? `<div style="margin-top:6px;font-size:0.9rem"><b>Sub:</b> ${q.subject}</div>` : ''}
        </div>
      </div>

      <!-- Line Items -->
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width:30px;text-align:center">#</th>
            <th>Item &amp; Description</th>
            <th style="text-align:right">Size</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Rate</th>
            <th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineRowsHtml}
        </tbody>
      </table>

      <!-- Totals & Payment Summary -->
      <div style="display:flex;justify-content:flex-end;margin-top:20px">
        <div style="width:100%;max-width:360px">
          <table class="tot-table">
            <tr><td style="color:#64748b">Subtotal</td><td style="text-align:right;font-weight:600">${inr(subtotal)}</td></tr>
            ${discount ? `<tr><td style="color:#64748b">Discount</td><td style="text-align:right;color:#dc2626">&minus;${inr(discount)}</td></tr>` : ''}
            ${extras ? `<tr><td style="color:#64748b">Extra Charges</td><td style="text-align:right">${inr(extras)}</td></tr>` : ''}
            <tr><td style="color:#64748b">Taxable Value</td><td style="text-align:right;font-weight:600">${inr(taxable)}</td></tr>
            ${gstRate ? `<tr><td style="color:#64748b">GST (${gstRate}%)</td><td style="text-align:right">${inr(gstAmt)}</td></tr>` : ''}
            <tr style="border-top:2px solid #0f172a;font-size:1.15rem"><td style="padding-top:10px;font-weight:700">Grand Total</td><td style="padding-top:10px;text-align:right;font-weight:700;color:#0f172a">${inr(grandTotal)}</td></tr>
          </table>
        </div>
      </div>

      <!-- Payment Schedule -->
      ${paymentsHtml ? `
        <div style="margin-top:30px">
          <h4 style="margin:0 0 10px;font-size:0.95rem;color:#334155">Payment Schedule</h4>
          <table style="width:100%;max-width:500px;border-collapse:collapse;font-size:0.9rem">
            <tbody>${paymentsHtml}</tbody>
          </table>
        </div>
      ` : ''}

      <!-- Bank Details & UPI QR -->
      ${(b.acNo || b.acName || b.ifsc || b.upiId) ? `
        <div style="margin-top:30px;background:#f8fafc;padding:16px 20px;border-radius:8px;border:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
          <div>
            <h4 style="margin:0 0 8px;font-size:0.95rem;color:#334155">Bank Details for Payment</h4>
            <div style="font-size:0.85rem;color:#475569;line-height:1.5">
              ${[b.acName && 'Account Name: <b>' + b.acName + '</b>', b.bank && 'Bank: <b>' + b.bank + '</b>', b.acNo && 'A/C No: <b>' + b.acNo + '</b>', b.ifsc && 'IFSC: <b>' + b.ifsc + '</b>', b.branch && 'Branch: ' + b.branch].filter(Boolean).join('<br>')}
              ${b.upiId ? `<br><b>UPI ID:</b> ${b.upiId}` : ''}
            </div>
          </div>
          ${b.upiId ? `
            <div style="text-align:center">
              <canvas id="upiQr" width="96" height="96" style="border:1px solid #cbd5e1;border-radius:6px;background:#fff"></canvas>
              <div style="font-size:0.75rem;color:#64748b;margin-top:4px">Scan with any UPI app</div>
            </div>
            <script>
            try {
              const cv = document.getElementById('upiQr');
              if (cv && typeof QRCode !== 'undefined') {
                const uri = 'upi://pay?pa=' + encodeURIComponent('${b.upiId}') + '&pn=' + encodeURIComponent('${s.company || 'Company'}') + '&cu=INR&tn=' + encodeURIComponent('${q.no} Payment');
                QRCode.toCanvas(cv, uri, { width: 96, margin: 1 });
              }
            } catch(e) {}
            </script>
          ` : ''}
        </div>
      ` : ''}

      <!-- Terms & Conditions -->
      ${termsHtml ? `
        <div style="margin-top:30px">
          <h4 style="margin:0 0 8px;font-size:0.95rem;color:#334155">Terms and Conditions</h4>
          <ol style="margin:0;padding-left:20px;font-size:0.85rem;color:#475569;line-height:1.5">${termsHtml}</ol>
        </div>
      ` : ''}
    </div>

    <!-- Client Acceptance Form -->
    <div class="accept-section no-print">${acceptSection}</div>
  </div>
</body>
</html>`);
});

// ── Client accepts quotation online ───────────────────────────────────────
app.post('/q/:token/accept', express.json(), (req, res) => {
  const name = String(req.body && req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Full name required' });
  const data = getDb();
  if (!data || !data.quotes) return res.status(404).json({ error: 'Not found' });
  const q = data.quotes.find(x => x.shareToken === req.params.token);
  if (!q) return res.status(404).json({ error: 'Link expired' });
  if (q.acceptedBy) return res.json({ ok: true, alreadyAccepted: true });
  if (q.status !== 'sent') return res.status(400).json({ error: 'Quote is not in sent status' });

  q.acceptedBy = name;
  q.acceptedAt = Date.now();
  q.status = 'won';
  q.updatedAt = Date.now();
  q.log = q.log || [];
  q.log.push({ t: Date.now(), u: name + ' (client)', x: 'Accepted online via shared link' });
  saveDb(data);
  res.json({ ok: true });
});

// ── AI Quote Assistant: draft line items from natural language enquiry ─────
app.post('/api/ai/draft-items', auth, express.json(), async (req, res) => {
  const data = getDb();
  const catalog = (data && data.products) || [];
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.json([]);

  // Check if Anthropic API key is available
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const prompt = `You convert a customer's enquiry into quotation line items for architectural windows and doors.
Catalog of products (match by name or id):
${JSON.stringify(catalog.map(c => ({ id: c.id, name: c.name, glyph: c.glyph, rate: c.rate, cost: c.cost, minArea: c.minArea })))}

Enquiry: """${text.slice(0, 2500)}"""

Reply with ONLY a JSON array, no extra commentary or markdown:
[{"productId": string, "name": string, "glyph": "slider"|"casement"|"fixed"|"door", "w": number, "h": number, "qty": number, "rate": number, "cost": number, "spec": string}]
Use standard mm for width and height (e.g. 1500 x 1200). If dimensions given in feet/inches, convert to mm (1 ft = 304.8 mm). Default quantity is 1 if unspecified.`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const aiData = await aiRes.json();
      let rawText = (aiData.content && aiData.content[0] && aiData.content[0].text) || '';
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed) && parsed.length) return res.json(parsed);
    } catch (e) {
      console.warn('[AI Assistant] Anthropic call failed, falling back to smart heuristic parser:', e.message);
    }
  }

  // Heuristic parser fallback: matches quantities, dimensions and product types
  const items = [];
  const clauses = text.split(/[\n,;]+|\band\b/i).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    const qtyMatch = clause.match(/^(\d+)\s*(?:nos?|pieces?|units?|sets?)?\s+/i) || clause.match(/(\d+)\s*(?:nos?|pieces?|units?|sets?)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    let w = 1200, h = 1200;
    const dimMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:x|\*|by)\s*(\d+(?:\.\d+)?)\s*(mm|ft|feet|in|inch|m)?/i);
    if (dimMatch) {
      let d1 = parseFloat(dimMatch[1]), d2 = parseFloat(dimMatch[2]);
      const unit = (dimMatch[3] || '').toLowerCase();
      if (unit.startsWith('ft') || (d1 < 20 && d2 < 20 && !unit.includes('m'))) {
        d1 = Math.round(d1 * 304.8);
        d2 = Math.round(d2 * 304.8);
      } else if (unit.startsWith('in')) {
        d1 = Math.round(d1 * 25.4);
        d2 = Math.round(d2 * 25.4);
      } else if (unit === 'm') {
        d1 = Math.round(d1 * 1000);
        d2 = Math.round(d2 * 1000);
      }
      w = d1;
      h = d2;
    }

    let glyph = 'slider';
    const lower = clause.toLowerCase();
    if (lower.includes('case') || lower.includes('openable')) glyph = 'casement';
    else if (lower.includes('fix')) glyph = 'fixed';
    else if (lower.includes('door')) glyph = 'door';
    else if (lower.includes('slid')) glyph = 'slider';

    const prod = catalog.find(p => p.glyph === glyph) ||
                 catalog.find(p => lower.includes(p.name.toLowerCase())) ||
                 catalog[0];

    const name = prod ? prod.name : (glyph.charAt(0).toUpperCase() + glyph.slice(1) + ' Window');
    const rate = prod ? prod.rate : 450;
    const cost = prod ? (prod.cost || 0) : 320;

    items.push({
      productId: prod ? prod.id : null,
      name,
      glyph: prod ? prod.glyph : glyph,
      w,
      h,
      qty,
      rate,
      cost,
      spec: clause.trim()
    });
  }

  res.json(items);
});

// ── Payment tracking ───────────────────────────────────────────────────────
app.post('/api/quotes/:id/payments', auth, express.json(), (req, res) => {
  const data = getDb();
  if (!data || !data.quotes) return res.status(404).json({ error: 'No data' });
  const q = data.quotes.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quote not found' });

  const { milestone, amount, mode, reference } = req.body || {};
  if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'Valid amount required' });

  if (!q.payments) q.payments = [];
  const payment = {
    id: require('crypto').randomBytes(8).toString('hex'),
    milestone: String(milestone || '').trim(),
    amount: parseFloat(amount),
    mode: String(mode || '').trim(),
    reference: String(reference || '').trim(),
    receivedOn: new Date().toISOString().slice(0, 10),
    recordedAt: Date.now(),
    recordedBy: req.userId
  };
  q.payments.push(payment);
  q.updatedAt = Date.now();
  q.log = q.log || [];
  q.log.push({ t: Date.now(), u: req.userId, x: `Payment recorded: ${mode || 'cash'} ₹${amount} for ${milestone || 'payment'}` });

  const paid = q.payments.reduce((a, p) => a + p.amount, 0);
  saveDb(data);
  res.json({ ok: true, paid, payment });
});

app.get('/api/quotes/:id/payments', auth, (req, res) => {
  const data = getDb();
  if (!data || !data.quotes) return res.status(404).json({ error: 'No data' });
  const q = data.quotes.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  const paid = (q.payments || []).reduce((a, p) => a + p.amount, 0);
  res.json({ payments: q.payments || [], paid });
});

// ── Follow-up list (sent > 3 days ago, not yet accepted) ──────────────────
app.get('/api/followups', auth, (req, res) => {
  const data = getDb();
  if (!data || !data.quotes) return res.json([]);
  const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
  const rows = data.quotes
    .filter(q => !q.superseded && q.status === 'sent' && q.sentAt && q.sentAt < threeDaysAgo)
    .sort((a, b) => a.sentAt - b.sentAt)
    .slice(0, 15)
    .map(q => ({
      id: q.id,
      no: q.no,
      customerName: q.cust && q.cust.name || '',
      phone: q.cust && q.cust.phone || '',
      total: q.total || 0,
      sentAt: q.sentAt,
      viewCount: q.viewCount || 0,
      daysSince: Math.floor((Date.now() - q.sentAt) / 86400000),
      shareToken: q.shareToken || null
    }));
  res.json(rows);
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
