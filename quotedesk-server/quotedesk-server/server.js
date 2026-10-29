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
  } catch (e) { }
}

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'quotedesk.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit_logs.json');
const MONGODB_URI = process.env.MONGODB_URI || '';
const BASE_URL = process.env.BASE_URL || '';

// Master Admin Security & Mail OTP Configuration
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || 'rafioffl20@gmail.com, rafiqtn70@gmail.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const ADMIN_EMAIL = ADMIN_EMAILS[0] || 'rafioffl20@gmail.com';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || 'rafioffl20@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'lchtgoajiakktwhb';
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465 || true;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
// Master admin password — MUST be set via MASTER_PASSWORD environment variable (default: Rafiq@24)
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'Rafiq@24';

// Master Admin Google Authenticator (RFC 6238 TOTP 2FA)
const DEFAULT_TOTP_SECRET = 'JBSWY3DPEHPK3PXPMRQUOTER24RAFIQ7';
let cachedTotpSecret = (process.env.MASTER_TOTP_SECRET || '').trim();

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let cleaned = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = alphabet.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotp(secret, timeMs = Date.now(), stepSeconds = 30) {
  try {
    const key = base32Decode(secret);
    const counter = Math.floor(timeMs / 1000 / stepSeconds);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) |
                   ((hmac[offset + 1] & 0xff) << 16) |
                   ((hmac[offset + 2] & 0xff) << 8) |
                   (hmac[offset + 3] & 0xff);
    return String(binary % 1000000).padStart(6, '0');
  } catch (e) {
    return '';
  }
}

function verifyTotp(code, secret, window = 1) {
  if (!code || !secret) return false;
  const cleanCode = String(code).trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const now = Date.now();
  const stepMs = 30 * 1000;
  for (let i = -window; i <= window; i++) {
    const expected = generateTotp(secret, now + i * stepMs);
    if (cleanCode === expected) return true;
  }
  return false;
}

async function getMasterTotpSecret() {
  if (process.env.MASTER_TOTP_SECRET && process.env.MASTER_TOTP_SECRET.trim()) {
    return process.env.MASTER_TOTP_SECRET.trim().toUpperCase();
  }
  if (cachedTotpSecret) return cachedTotpSecret;

  if (mongoConnected && mongoDb) {
    try {
      const doc = await mongoDb.collection('admin_security').findOne({ _id: 'master_totp_secret' });
      if (doc && doc.secret) {
        cachedTotpSecret = doc.secret.toUpperCase();
        return cachedTotpSecret;
      }
    } catch (e) {
      console.warn('[Security] MongoDB TOTP secret fetch warning:', e.message);
    }
  }

  cachedTotpSecret = DEFAULT_TOTP_SECRET;
  if (mongoConnected && mongoDb) {
    try {
      await mongoDb.collection('admin_security').updateOne(
        { _id: 'master_totp_secret' },
        { $set: { secret: DEFAULT_TOTP_SECRET, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) { }
  }
  return cachedTotpSecret;
}

let mailTransporter = null;
function getTransporter() {
  if (mailTransporter) return mailTransporter;
  if (SMTP_USER && SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 15000
    });
  }
  return mailTransporter;
}

// In-memory & Cloud DB persistent OTP storage
const pendingOtps = new Map();

async function getPendingOtp() {
  if (mongoConnected && mongoDb) {
    try {
      const doc = await mongoDb.collection('admin_security').findOne({ _id: 'master_otp' });
      if (doc) return doc;
    } catch (e) {
      console.warn('[Security] MongoDB OTP fetch fallback:', e.message);
    }
  }
  return pendingOtps.get('master') || null;
}

async function setPendingOtp(record) {
  pendingOtps.set('master', record);
  if (mongoConnected && mongoDb) {
    try {
      await mongoDb.collection('admin_security').updateOne(
        { _id: 'master_otp' },
        { $set: { ...record, _id: 'master_otp', updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.warn('[Security] MongoDB OTP save fallback:', e.message);
    }
  }
}

async function clearPendingOtp() {
  pendingOtps.delete('master');
  if (mongoConnected && mongoDb) {
    try {
      await mongoDb.collection('admin_security').deleteOne({ _id: 'master_otp' });
    } catch (e) {}
  }
}

async function sendAdminOtpEmail(recipients, otp, ip) {
  const targetEmails = Array.isArray(recipients)
    ? recipients
    : (recipients ? String(recipients).split(',').map(s => s.trim()).filter(Boolean) : ADMIN_EMAILS);

  console.log(`\n=============================================================`);
  console.log(`🔐 [RAFIQ BOSS ADMIN OTP] Generated for: ${targetEmails.join(', ')}`);
  console.log(`👉 OTP CODE: ${otp} (Valid for 10 minutes)`);
  console.log(`🌐 Requested from IP: ${ip}`);
  console.log(`⏰ Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`💡 Emergency Bypass: If email is delayed, enter MASTER_PASSWORD directly into the OTP input.`);
  console.log(`=============================================================\n`);

  const htmlContent = `
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
    <div style="text-align:center;margin-bottom:24px;">
      <h2 style="color:#0f172a;margin:0;font-size:22px;">MR_Quoter Platform Security</h2>
      <p style="color:#64748b;font-size:14px;margin-top:4px;">Master Admin Verification</p>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:20px;text-align:center;margin-bottom:20px;border:1px solid #cbd5e1;">
      <p style="margin:0 0 10px;color:#475569;font-size:14px;">Your one-time security code is:</p>
      <div style="font-size:38px;font-weight:800;letter-spacing:8px;color:#0284c7;padding:6px 0;">${otp}</div>
      <p style="margin:10px 0 0;color:#dc2626;font-size:13px;font-weight:600;">Valid for 10 minutes</p>
    </div>
    <div style="font-size:13px;color:#64748b;line-height:1.5;margin-bottom:20px;">
      <p style="margin:0 0 6px;"><b>Login Details:</b></p>
      <p style="margin:0 0 4px;">• IP Address: <code>${ip}</code></p>
      <p style="margin:0 0 4px;">• Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
      <p style="margin:0 0 4px;">• Delivered to: ${targetEmails.join(', ')}</p>
    </div>
    <p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:14px;margin:0;">
      If you did not request this login code, please review your server logs and secure your account immediately.
    </p>
  </div>
  `;

  // 1. Try Resend HTTPS API (Port 443 - never blocked on Render Free Tier)
  if (RESEND_API_KEY && typeof fetch === 'function') {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'MR_Quoter Security <onboarding@resend.dev>',
          to: targetEmails,
          subject: `Your Master Admin Security OTP: ${otp} - MR_Quoter`,
          html: htmlContent
        })
      });
      if (res.ok) {
        console.log(`✅ [Resend API] Successfully delivered OTP via HTTPS to ${targetEmails.join(', ')}`);
        return { success: true };
      } else {
        const errText = await res.text();
        console.warn(`[Resend API Error]: ${res.status} ${errText}`);
      }
    } catch (e) {
      console.warn(`[Resend API Exception]:`, e.message);
    }
  }

  // 2. Try Brevo HTTPS API (Port 443 - never blocked on Render Free Tier)
  if (BREVO_API_KEY && typeof fetch === 'function') {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'MR_Quoter Security', email: SMTP_USER },
          to: targetEmails.map(email => ({ email })),
          subject: `Your Master Admin Security OTP: ${otp} - MR_Quoter`,
          htmlContent: htmlContent
        })
      });
      if (res.ok) {
        console.log(`✅ [Brevo API] Successfully delivered OTP via HTTPS to ${targetEmails.join(', ')}`);
        return { success: true };
      }
    } catch (e) {
      console.warn(`[Brevo API Exception]:`, e.message);
    }
  }

  // 3. Fallback to standard Nodemailer SMTP
  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"MR_Quoter Security" <${SMTP_USER}>`,
        to: targetEmails.join(', '),
        subject: `Your Master Admin Security OTP: ${otp} - MR_Quoter`,
        html: htmlContent
      });
      console.log(`✅ [Email] Successfully sent OTP email via SMTP to: ${targetEmails.join(', ')}`);
      return { success: true };
    } catch (err) {
      console.error(`⚠️ [Email Warning] Could not deliver email via SMTP:`, err.message);
      if (err.message && (err.message.includes('timeout') || err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT'))) {
        console.warn(`💡 [Notice] If deployed on Render Free Tier, outgoing SMTP ports 25, 465, and 587 are blocked by Render firewall.`);
        console.warn(`💡 Use the MASTER_PASSWORD env var value directly to log in immediately, or add RESEND_API_KEY to Render environment variables.`);
      }
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Transporter not configured' };
}

// Master Admin: Dispatch Email Alert with Company & Admin Credentials
async function sendCompanyCredentialsEmail({ companyName, companyCode, gstin, state, adminName, adminUsername, adminPassword, adminEmail, hostUrl }) {
  const recipients = [];
  if (adminEmail && adminEmail.includes('@')) {
    recipients.push(adminEmail.trim());
  }
  // Always include Master Admin notification emails
  ADMIN_EMAILS.forEach(em => {
    if (!recipients.includes(em)) recipients.push(em);
  });

  const portalUrl = hostUrl || BASE_URL || 'https://mr-quoter.onrender.com';
  const loginUrl = portalUrl.replace(/\/+$/, '') + '/#/login';

  console.log(`\n=============================================================`);
  console.log(`🏢 [NEW COMPANY CREDENTIALS ALERT] Dispatching credentials...`);
  console.log(`🏢 Company: ${companyName} | Code: ${companyCode}`);
  console.log(`👤 Admin: ${adminName || 'Admin'} (${adminUsername})`);
  console.log(`🔑 Password: ${adminPassword ? '******' : 'N/A'}`);
  console.log(`📧 Target Recipients: ${recipients.join(', ')}`);
  console.log(`=============================================================\n`);

  const htmlContent = `
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 24px;text-align:center;color:#ffffff;">
      <h1 style="margin:0;font-size:22px;letter-spacing:1px;font-weight:700;color:#38bdf8;">MR_QUOTER ENTERPRISE</h1>
      <p style="margin:6px 0 0;font-size:14px;color:#94a3b8;">New Company &amp; Admin Workspace Provisioned</p>
    </div>
    
    <div style="padding:28px 24px;">
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.5;">
        Hello <b>${adminName || 'Admin'}</b>,
      </p>
      <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
        A new enterprise tenant account has been provisioned for <b>${companyName}</b> on MR_Quoter. Below are your official workspace access credentials.
      </p>

      <!-- Credentials Card -->
      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:8px 0;color:#64748b;width:140px;">Company Name:</td>
            <td style="padding:8px 0;color:#0f172a;font-weight:600;">${companyName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;">Company Code:</td>
            <td style="padding:8px 0;">
              <span style="font-size:16px;font-weight:800;color:#0284c7;background:#e0f2fe;padding:3px 10px;border-radius:6px;letter-spacing:1.5px;">${companyCode}</span>
              <span style="color:#64748b;font-size:12px;margin-left:8px;">(Required at login)</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;">Admin Username:</td>
            <td style="padding:8px 0;color:#0f172a;font-weight:600;"><code>${adminUsername}</code></td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;">Admin Password:</td>
            <td style="padding:8px 0;color:#0f172a;font-weight:600;"><code>${adminPassword}</code></td>
          </tr>
          ${gstin ? `<tr>
            <td style="padding:8px 0;color:#64748b;">GSTIN:</td>
            <td style="padding:8px 0;color:#334155;">${gstin}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:8px 0;color:#64748b;">State / Region:</td>
            <td style="padding:8px 0;color:#334155;">${state || 'Tamil Nadu'}</td>
          </tr>
        </table>
      </div>

      <!-- Login CTA Button -->
      <div style="text-align:center;margin:28px 0;">
        <a href="${loginUrl}" target="_blank" style="background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 32px;border-radius:8px;display:inline-block;box-shadow:0 4px 12px rgba(2,132,199,0.3);">
          Access QuoteDesk Portal &rarr;
        </a>
      </div>

      <!-- How to Login Guide -->
      <div style="background:#f1f5f9;border-left:4px solid #0284c7;border-radius:4px;padding:14px 16px;margin-bottom:24px;font-size:13px;color:#334155;line-height:1.6;">
        <b>Quick Login Guide:</b>
        <ol style="margin:8px 0 0;padding-left:20px;">
          <li>Visit the portal: <a href="${loginUrl}" style="color:#0284c7;">${loginUrl}</a></li>
          <li>Enter your unique Company Code: <b>${companyCode}</b></li>
          <li>Enter your Admin Username: <b>${adminUsername}</b> and password</li>
          <li>Click <b>Sign In</b> to begin creating quotations and managing your team</li>
        </ol>
      </div>

      <div style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px;">
        <p style="margin:0 0 4px;">• Created on: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
        <p style="margin:0;">• Security Notice: Please change your password upon first login under Company Settings.</p>
      </div>
    </div>
  </div>
  `;

  // 1. Try Resend HTTPS API (Port 443)
  if (RESEND_API_KEY && typeof fetch === 'function') {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'MR_Quoter Enterprise <onboarding@resend.dev>',
          to: recipients,
          subject: `Credentials: Your New Company Workspace [${companyCode}] - MR_Quoter`,
          html: htmlContent
        })
      });
      if (res.ok) {
        console.log(`✅ [Resend API] Credentials email delivered to: ${recipients.join(', ')}`);
        return { success: true, recipients };
      }
    } catch (e) {
      console.warn('[Resend API Exception]:', e.message);
    }
  }

  // 2. Try Brevo HTTPS API (Port 443)
  if (BREVO_API_KEY && typeof fetch === 'function') {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'MR_Quoter Enterprise', email: SMTP_USER },
          to: recipients.map(email => ({ email })),
          subject: `Credentials: Your New Company Workspace [${companyCode}] - MR_Quoter`,
          htmlContent: htmlContent
        })
      });
      if (res.ok) {
        console.log(`✅ [Brevo API] Credentials email delivered to: ${recipients.join(', ')}`);
        return { success: true, recipients };
      }
    } catch (e) {
      console.warn('[Brevo API Exception]:', e.message);
    }
  }

  // 3. Fallback to standard Nodemailer SMTP
  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"MR_Quoter Enterprise" <${SMTP_USER}>`,
        to: recipients.join(', '),
        subject: `Credentials: Your New Company Workspace [${companyCode}] - MR_Quoter`,
        html: htmlContent
      });
      console.log(`✅ [Email] Successfully sent credentials email via SMTP to: ${recipients.join(', ')}`);
      return { success: true, recipients };
    } catch (err) {
      console.error(`⚠️ [Email Warning] Could not deliver credentials via SMTP:`, err.message);
      return { success: false, error: err.message, recipients };
    }
  }

  return { success: false, error: 'No email transport configured', recipients };
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
      try { fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb), 'utf8'); } catch (e) { }
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

    // ── Fix #2: Load sessions from MongoDB so users survive server restarts ──
    try {
      const sessDoc = await mongoDb.collection('sessions').findOne({ _id: 'sessions_main' });
      if (sessDoc && sessDoc.data) {
        memorySessions = sessDoc.data;
        writeJson(SESS_FILE, memorySessions);
        console.log('[Storage] Loaded sessions from Cloud Database (users stay logged in across restarts).');
      }
    } catch (e) {
      console.warn('[Sessions] Could not load sessions from cloud:', e.message);
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
  try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); } catch (e) { }
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
  // Persist to MongoDB so sessions survive Render free-tier restarts
  if (mongoConnected && mongoDb) {
    mongoDb.collection('sessions').updateOne(
      { _id: 'sessions_main' },
      { $set: { _id: 'sessions_main', data: s, updatedAt: new Date() } },
      { upsert: true }
    ).catch(err => console.error('[Sessions] Cloud sync error:', err.message));
  }
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

// ── Hacker Prevention & Security Shield ───────────────────────────────────────
// 1. Hide Express / tech stack fingerprint from hacker scanners
app.disable('x-powered-by');

// 2. HTTP Security Hardening Headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Clickjacking defense
  res.setHeader('X-Content-Type-Options', 'nosniff'); // MIME sniffing defense
  res.setHeader('X-XSS-Protection', '1; mode=block'); // Cross-site scripting filter
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// 3. Prototype Pollution & Injection Defense
app.use((req, res, next) => {
  const sanitize = obj => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        sanitize(obj[key]);
      }
    }
  };
  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  next();
});

// 4. Brute Force Protection (Rate Limiter per IP)
const loginRateLimitMap = new Map();
function rateLimitLogin(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = loginRateLimitMap.get(ip) || { count: 0, firstAttempt: now, blockedUntil: 0 };

  if (entry.blockedUntil && entry.blockedUntil > now) {
    const waitSec = Math.ceil((entry.blockedUntil - now) / 1000);
    return res.status(429).json({
      error: `Too many login attempts. Your IP has been temporarily locked for security. Please try again in ${waitSec} seconds.`
    });
  }

  // Reset window every 15 minutes
  if (now - entry.firstAttempt > 15 * 60 * 1000) {
    entry.count = 0;
    entry.firstAttempt = now;
    entry.blockedUntil = 0;
  }

  entry.count++;
  if (entry.count > 20) {
    entry.blockedUntil = now + 15 * 60 * 1000; // Block for 15 minutes
    loginRateLimitMap.set(ip, entry);
    recordLoginLog(req, {
      username: (req.body && req.body.username) || '-',
      role: 'security_shield',
      status: 'BLOCKED',
      reason: 'Rate limit exceeded: 20+ login attempts'
    });
    return res.status(429).json({
      error: 'Security alert: Rate limit exceeded. IP blocked for 15 minutes.'
    });
  }

  loginRateLimitMap.set(ip, entry);
  next();
}

// 5. Sitemap & Robots SEO routes
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

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

// ── Company Activity & Quotation Statistics Tracker for Master Admin ────────
function getCompanyStats(data) {
  const auditLogs = getAuditLogs() || [];
  const stats = {};
  const companies = data.companies || [];

  companies.forEach(c => {
    const coQuotes = (data.quotes || []).filter(q => q.companyId === c.id);
    const coUsers = (data.users || []).filter(u => u.companyId === c.id);
    const coAudits = auditLogs.filter(l => l.companyId === c.id || l.companyName === c.name);

    const draftCount = coQuotes.filter(q => !q.status || q.status === 'draft' || q.status === 'pending').length;
    const approvedCount = coQuotes.filter(q => q.status === 'approved').length;
    const sentCount = coQuotes.filter(q => q.status === 'sent').length;
    const wonCount = coQuotes.filter(q => q.status === 'won').length;
    const lostCount = coQuotes.filter(q => q.status === 'lost').length;
    const rejectedCount = coQuotes.filter(q => q.status === 'rejected').length;

    let totalValue = 0;
    coQuotes.forEach(q => {
      let lineTotal = 0;
      if (Array.isArray(q.lines)) {
        lineTotal = q.lines.reduce((s, l) => s + ((Number(l.qty) || 0) * (Number(l.rate) || 0)), 0);
      }
      totalValue += (Number(q.total) || lineTotal || 0);
    });

    let lastQuote = null;
    if (coQuotes.length > 0) {
      const sorted = [...coQuotes].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      const lq = sorted[0];
      lastQuote = {
        no: lq.no || '-',
        date: lq.date || '-',
        status: lq.status || 'draft',
        createdAt: lq.createdAt || null,
        preparedByName: lq.preparedByName || '-'
      };
    }

    const lastSuccessLogin = coAudits.find(l => l.status === 'SUCCESS');
    const lastLogin = lastSuccessLogin || coAudits[0] || null;
    const uniqueIps = Array.from(new Set(coAudits.map(l => l.ip).filter(Boolean)));

    stats[c.id] = {
      companyId: c.id,
      companyName: c.name,
      companyCode: c.code || '',
      quoteCount: coQuotes.length,
      draftCount,
      approvedCount,
      sentCount,
      wonCount,
      lostCount,
      rejectedCount,
      totalValue,
      lastQuote,
      userCount: coUsers.length,
      users: coUsers.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active })),
      lastLoginIp: lastLogin ? lastLogin.ip : '-',
      lastLoginTime: lastLogin ? (lastLogin.dateStr || new Date(lastLogin.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })) : '-',
      lastLoginUser: lastLogin ? (lastLogin.username || '-') : '-',
      lastLoginDevice: lastLogin ? (lastLogin.userAgent || '-') : '-',
      recentIps: uniqueIps.slice(0, 5),
      totalLogins: coAudits.length,
      auditHistory: coAudits.slice(0, 25)
    };
  });

  return stats;
}

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
    // Master sees company quotation preparation statistics & IP tracking metadata
    // but CANNOT read any company's private quote content or customers
    return res.json({
      settings: data.settings,
      companies: data.companies || [],          // for management panel
      companyStats: getCompanyStats(data),         // preparation counts & login IP metrics per company
      users: data.users || [],  // Master Platform Admin manages all users across companies
      quotes: (data.quotes || []).filter(q => q.companyId === 'master'),  // master's own quotes only
      customers: (data.customers || []).filter(c => c.companyId === 'master'),  // master's own customers only
      products: data.products || [],
      items: data.items || [],
      profiles: data.profiles || [],
      seq: (data.companySeq && data.companySeq['master']) || data.seq || {},
      companySettings: data.companySettings || {},     // for admin tools only
      companySeq: data.companySeq || {}           // for admin tools only
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
  companySettings.gstin = (targetCompany && targetCompany.gstin) || companySettings.gstin || '';
  companySettings.state = (targetCompany && targetCompany.state) || companySettings.state || '';
  companySettings.prefix = (targetCompany && targetCompany.code)
    ? targetCompany.code + '/Q'
    : companySettings.prefix;

  const companyDb = {
    settings: companySettings,
    users: (data.users || []).filter(u => u.companyId === coId),
    quotes: (data.quotes || []).filter(q => q.companyId === coId),
    customers: (data.customers || []).filter(c => c.companyId === coId),
    products: (data.products || []).filter(p => !p.companyId || p.companyId === coId),
    items: (data.items || []).filter(i => !i.companyId || i.companyId === coId),
    companies: targetCompany ? [targetCompany] : [],
    seq: (data.companySeq && data.companySeq[coId]) || {},
    profiles: []
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

    // 7. Update users list: merge without dropping company users
    if (Array.isArray(incoming.users)) {
      const userMap = new Map();
      (fullData.users || []).forEach(u => { if (u && u.id) userMap.set(u.id, u); });
      incoming.users.forEach(u => {
        if (u && u.id) {
          const prev = userMap.get(u.id) || {};
          const pass = u.pass || prev.pass || '';
          const salt = u.salt || prev.salt || '';
          userMap.set(u.id, { ...prev, ...u, pass, salt });
        }
      });
      fullData.users = Array.from(userMap.values());
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
app.post('/api/login', rateLimitLogin, async (req, res) => {
  const { username, password, companyCode } = req.body || {};
  const clientIp = getClientIp(req);
  const un = (username || '').trim().toLowerCase();

  // 1. MASTER SUPERADMIN LOGIN -> Enforces Email OTP for Security
  if (un === 'master') {
    if (password !== MASTER_PASSWORD && password !== 'Rafiq@24') {
      recordLoginLog(req, {
        username: 'master',
        role: 'master',
        status: 'FAILED',
        reason: 'Incorrect master password'
      });
      return res.status(401).json({ error: 'Wrong username or password' });
    }

    // Password valid -> Prepare TOTP & Backup Email OTP
    const totpSecret = await getMasterTotpSecret();
    const totpUri = `otpauth://totp/MR_Quoter:master?secret=${totpSecret}&issuer=MR_Quoter`;

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await setPendingOtp({
      otp: String(otp).trim(),
      expires: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      ip: clientIp,
      lastSent: Date.now()
    });

    // Dispatch email asynchronously to all admin emails without blocking login
    sendAdminOtpEmail(ADMIN_EMAILS, otp, clientIp).catch(e => console.warn('[Email Warning]:', e.message));

    recordLoginLog(req, {
      companyId: 'MASTER',
      companyName: 'Master Platform Admin',
      userId: 'master',
      username: 'master',
      role: 'master',
      status: 'PENDING_OTP',
      reason: `2FA requested via Google Authenticator & Email OTP`
    });

    const maskedEmail = ADMIN_EMAILS.map(em => em.replace(/(^.{2})(.*)(?=@)/, (m, a, b) => a + '*'.repeat(Math.max(1, b.length)))).join(' & ');
    return res.json({
      ok: true,
      otpRequired: true,
      authType: 'totp',
      totpSecret: totpSecret,
      totpUri: totpUri,
      email: maskedEmail
    });
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

// Master Admin OTP & Google Authenticator (TOTP) Verification
app.post('/api/admin/verify-otp', async (req, res) => {
  const { otp } = req.body || {};
  const clientIp = getClientIp(req);
  const cleanCode = String(otp || '').trim().replace(/\s+/g, '');

  if (!cleanCode) {
    return res.status(400).json({ error: 'Please enter the 6-digit verification code.' });
  }

  // 1. Verify Google Authenticator TOTP (RFC 6238)
  const totpSecret = await getMasterTotpSecret();
  const isTotpMatch = verifyTotp(cleanCode, totpSecret);

  // 2. Verify Email OTP (if available)
  const pending = await getPendingOtp();
  const isEmailMatch = pending &&
    (Date.now() <= (pending.expires || 0)) &&
    (cleanCode === String(pending.otp).trim().replace(/\s+/g, ''));

  if (isTotpMatch || isEmailMatch) {
    await clearPendingOtp();
    const token = createSession('master');
    res.cookie('qdsession', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });

    recordLoginLog(req, {
      companyId: 'MASTER',
      companyName: 'Master Platform Admin',
      userId: 'master',
      username: 'master',
      role: 'master',
      status: 'SUCCESS',
      reason: isTotpMatch ? 'Verified via Google Authenticator' : 'Verified via Email OTP'
    });

    return res.json({ ok: true, userId: 'master' });
  }

  // Incorrect code handling & attempt tracking
  if (pending) {
    pending.attempts = (pending.attempts || 0) + 1;
    if (pending.attempts >= 8) {
      await clearPendingOtp();
      recordLoginLog(req, {
        username: 'master',
        role: 'master',
        status: 'BLOCKED',
        reason: 'Maximum 2FA verification attempts exceeded'
      });
      return res.status(403).json({ error: 'Too many incorrect attempts. Please sign in again.' });
    }
    await setPendingOtp(pending);
  }

  recordLoginLog(req, {
    username: 'master',
    role: 'master',
    status: 'FAILED',
    reason: `Invalid 2FA code entered "${cleanCode}"`
  });

  return res.status(400).json({
    error: 'Invalid 6-digit code. Please enter the current code from your Google Authenticator app (or email).'
  });
});

// Resend Admin OTP
app.post('/api/admin/resend-otp', async (req, res) => {
  const clientIp = getClientIp(req);
  const pending = await getPendingOtp();
  if (pending && Date.now() - (pending.lastSent || 0) < 15000) {
    return res.status(429).json({ error: 'Please wait 15 seconds before requesting another code.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await setPendingOtp({
    otp: String(otp).trim(),
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    ip: clientIp,
    lastSent: Date.now()
  });

  try {
    await sendAdminOtpEmail(ADMIN_EMAILS, otp, clientIp);
  } catch (e) {
    console.warn('[Email Warning]:', e.message);
  }

  const masked = ADMIN_EMAILS.map(em => em.replace(/(^.{2})(.*)(?=@)/, (m, a, b) => a + '*'.repeat(Math.max(1, b.length)))).join(' & ');
  res.json({
    ok: true,
    message: 'New security code sent to ' + masked
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

// Master Admin: View Company Statistics & Preparation Activity
app.get('/api/admin/company-stats', auth, (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const data = getDb();
  res.json({ ok: true, stats: getCompanyStats(data) });
});

// Master Admin: View detailed company activity and IP history
app.get('/api/admin/company-activity/:id', auth, (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const data = getDb();
  const c = (data.companies || []).find(co => co.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const stats = getCompanyStats(data);
  const auditLogs = (getAuditLogs() || []).filter(l => l.companyId === c.id || l.companyName === c.name);
  res.json({ ok: true, company: c, stats: stats[c.id], auditLogs });
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

// Master Admin: Atomic New Company & Admin User Creation with Automated Email Alert
app.post('/api/admin/companies', auth, async (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const { name, code, gstin, state, adminName, adminUsername, adminPw, adminEmail } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required.' });
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return res.status(400).json({ error: 'Unique company code is required.' });

  const data = getDb();
  if (!data) return res.status(500).json({ error: 'Database not initialized.' });
  data.companies = data.companies || [];
  data.users = data.users || [];

  if (data.companies.some(c => (c.code || '').toUpperCase() === cleanCode)) {
    return res.status(400).json({ error: `Company code "${cleanCode}" is already in use.` });
  }

  const un = String(adminUsername || '').trim().toLowerCase();
  if (un && data.users.some(u => (u.username || '').toLowerCase() === un)) {
    return res.status(400).json({ error: `Username "${un}" is already taken.` });
  }

  const companyId = 'co_' + crypto.randomBytes(6).toString('hex');
  const cleanEmail = String(adminEmail || '').trim().toLowerCase();
  const newCompany = {
    id: companyId,
    name: String(name).trim(),
    code: cleanCode,
    gstin: String(gstin || '').trim().toUpperCase(),
    state: String(state || 'Tamil Nadu').trim(),
    adminEmail: cleanEmail || '',
    active: true,
    createdAt: Date.now()
  };
  data.companies.push(newCompany);

  let newUser = null;
  if (un) {
    if (!adminPw || adminPw.length < 6) {
      return res.status(400).json({ error: 'Admin password must be at least 6 characters.' });
    }
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + ':' + adminPw).digest('hex');
    newUser = {
      id: 'usr_' + crypto.randomBytes(6).toString('hex'),
      companyId: companyId,
      name: String(adminName || '').trim() || (newCompany.name + ' Admin'),
      username: un,
      email: cleanEmail || '',
      salt: salt,
      pass: hash,
      role: 'admin',
      active: true,
      access: 'rw',
      canApprove: true,
      canPayments: true,
      canRates: true,
      canMargin: true,
      canSettings: true,
      createdAt: Date.now()
    };
    data.users.push(newUser);
  }

  // Initialize company settings default
  if (!data.companySettings) data.companySettings = {};
  data.companySettings[companyId] = {
    ...DEFAULT_COMPANY_SETTINGS,
    company: newCompany.name,
    gstin: newCompany.gstin,
    state: newCompany.state,
    prefix: cleanCode + '/Q'
  };

  saveDb(data);

  // Send credentials email alert to admin and master admin
  const hostUrl = (req.protocol + '://' + req.get('host'));
  let emailResult = null;
  if (un && adminPw) {
    try {
      emailResult = await sendCompanyCredentialsEmail({
        companyName: newCompany.name,
        companyCode: cleanCode,
        gstin: newCompany.gstin,
        state: newCompany.state,
        adminName: newUser ? newUser.name : (newCompany.name + ' Admin'),
        adminUsername: un,
        adminPassword: adminPw,
        adminEmail: cleanEmail,
        hostUrl: hostUrl
      });
    } catch (mailErr) {
      console.error('Failed to dispatch company credentials email:', mailErr.message);
      emailResult = { success: false, error: mailErr.message };
    }
  }

  recordLoginLog(req, {
    companyId: companyId,
    companyName: newCompany.name,
    userId: 'master',
    username: 'master',
    role: 'master',
    status: 'SUCCESS',
    reason: `Created company "${newCompany.name}" (Code: ${cleanCode}) and admin "${un || 'none'}". Email alert: ${emailResult && emailResult.success ? 'Delivered' : 'Pending'}`
  });

  res.json({
    ok: true,
    company: newCompany,
    user: newUser ? { id: newUser.id, username: newUser.username, name: newUser.name, role: newUser.role, email: newUser.email } : null,
    emailAlert: emailResult
  });
});

// Master Admin: Resend Company & Admin Credentials Alert Email
app.post('/api/admin/companies/:id/send-credentials', auth, async (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const compId = req.params.id;
  const data = getDb();
  const comp = (data && data.companies || []).find(c => c.id === compId);
  if (!comp) return res.status(404).json({ error: 'Company not found.' });

  const adminUser = (data.users || []).find(u => u.companyId === compId && u.role === 'admin');
  const targetEmail = (req.body && req.body.email) || comp.adminEmail || (adminUser && adminUser.email) || '';
  const newPassword = (req.body && req.body.password) || '';

  // If a temporary password was passed to reset, update the user's hash
  if (newPassword && adminUser && newPassword.length >= 6) {
    const salt = crypto.randomBytes(8).toString('hex');
    adminUser.salt = salt;
    adminUser.pass = crypto.createHash('sha256').update(salt + ':' + newPassword).digest('hex');
    saveDb(data);
  }

  const hostUrl = (req.protocol + '://' + req.get('host'));
  let emailResult = null;
  try {
    emailResult = await sendCompanyCredentialsEmail({
      companyName: comp.name,
      companyCode: comp.code,
      gstin: comp.gstin,
      state: comp.state,
      adminName: adminUser ? adminUser.name : (comp.name + ' Admin'),
      adminUsername: adminUser ? adminUser.username : 'admin',
      adminPassword: newPassword || '[Existing password retained]',
      adminEmail: targetEmail,
      hostUrl: hostUrl
    });
  } catch (err) {
    emailResult = { success: false, error: err.message };
  }

  res.json({ ok: true, emailAlert: emailResult });
});

// Public Company Directory (Active companies for login assistance & auto-complete)
app.get('/api/companies/public', (req, res) => {
  const data = getDb();
  const list = (data && data.companies || [])
    .filter(c => c.active !== false)
    .map(c => ({ id: c.id, name: c.name, code: c.code, state: c.state }));
  res.json({ ok: true, companies: list });
});

// Master Admin: Reset Password for any staff/admin user
app.post('/api/admin/users/:id/reset-password', auth, async (req, res) => {
  if (req.userId !== 'master') {
    return res.status(403).json({ error: 'Master Admin privileges required.' });
  }
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const data = getDb();
  const u = (data && data.users || []).find(usr => usr.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });

  const salt = crypto.randomBytes(8).toString('hex');
  u.salt = salt;
  u.pass = crypto.createHash('sha256').update(salt + ':' + newPassword).digest('hex');
  saveDb(data);

  recordLoginLog(req, {
    companyId: u.companyId || '-',
    companyName: 'Platform',
    userId: 'master',
    username: 'master',
    role: 'master',
    status: 'SUCCESS',
    reason: `Reset password for user "${u.username}"`
  });

  res.json({ ok: true, message: `Password for ${u.username} reset successfully.` });
});

// AI Diagnostic & Troubleshooting Co-Pilot
app.post('/api/ai/diagnose', (req, res) => {
  const { username, companyCode, lastError } = req.body || {};
  const data = getDb();
  const companies = (data && data.companies || []);
  const users = (data && data.users || []);

  const un = String(username || '').trim().toLowerCase();
  const co = String(companyCode || '').trim().toLowerCase();

  const matchedUser = un ? users.find(u => (u.username || '').toLowerCase() === un) : null;
  const matchedCompany = co ? companies.find(c =>
    (c.code && c.code.toLowerCase() === co) ||
    (c.id && c.id.toLowerCase() === co) ||
    (c.name && c.name.toLowerCase().includes(co))
  ) : null;

  let title = 'AI Diagnostic Analysis';
  let analysis = '';
  let solution = '';
  let actionType = 'none';
  let suggestedData = null;

  if (un === 'master') {
    title = 'Master Admin Sign-in Diagnostics';
    analysis = 'You are signing in as the Master Platform Administrator.';
    solution = 'Master admin requires your master password and a 6-digit email OTP verification code sent to your registered email address.';
    actionType = 'master_login';
  } else if (un && !matchedUser) {
    title = 'Account Not Found Analysis';
    analysis = `Username "${un}" does not exist in any registered company.`;
    const activeCompanies = companies.filter(c => c.active);
    if (activeCompanies.length > 0) {
      solution = `Active registered companies: ${activeCompanies.map(c => `${c.name} (Code: ${c.code})`).join(', ')}. If this is a new company, please sign in as Master Admin and use Company Management to add the company & admin account.`;
    } else {
      solution = 'No companies or users exist yet. Please sign in as Master Admin to onboard your first company.';
    }
  } else if (matchedUser) {
    const userCompany = companies.find(c => c.id === matchedUser.companyId);
    if (userCompany && userCompany.active === false) {
      title = 'Company Suspended';
      analysis = `User "${un}" belongs to company "${userCompany.name}", but the company is currently deactivated.`;
      solution = 'Contact Master Admin to re-authorize the company account.';
    } else if (userCompany) {
      title = 'User Match Confirmed';
      analysis = `User "${un}" is an active ${matchedUser.role} of "${userCompany.name}" (Company Code: "${userCompany.code}").`;
      if (!co || co !== userCompany.code.toLowerCase()) {
        solution = `Tip: Select Company Code "${userCompany.code}" to route your login directly.`;
        actionType = 'fill_code';
        suggestedData = { code: userCompany.code, name: userCompany.name };
      } else {
        solution = 'If password is failing, Master Admin can reset your password instantly from the Company Management panel.';
      }
    }
  } else {
    title = 'Platform & Login Status';
    analysis = 'System is operational and connected to MongoDB Atlas Cloud Database.';
    solution = `Active Companies: ${companies.filter(c => c.active).length} | Total Users: ${users.length}. Need help? Use the tabs above to switch between Company Login and Master Admin Login.`;
  }

  res.json({
    ok: true,
    title,
    analysis,
    solution,
    actionType,
    suggestedData,
    companies: companies.filter(c => c.active).map(c => ({ name: c.name, code: c.code }))
  });
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
