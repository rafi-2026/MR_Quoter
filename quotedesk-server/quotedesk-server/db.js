'use strict';
/**
 * db.js — MongoDB collection helpers for MR_Quoter accounting suite
 * Provides getCollection() for new accounting collections alongside
 * the existing getDb() / saveDb() single-document pattern.
 * Golden Rule: never touches or breaks existing getDb() / saveDb() / memoryDb.
 */
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');

// Load local .env if present and MONGODB_URI is not set
if (!process.env.MONGODB_URI) {
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
}

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = 'quotedesk';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

let _client = null;
let _db = null;
let _connected = false;
let _connectFailed = false;

// Fallback in-memory collection map for offline/sandbox testing
const _localCollections = new Map();

class LocalCollection {
  constructor(name) {
    this.name = name;
    this.file = path.join(DATA_DIR, `${name}.json`);
    this.data = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      }
    } catch (e) {
      this.data = [];
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) { }
  }

  find(query = {}) {
    let items = this.data.filter(doc => {
      for (const [k, v] of Object.entries(query)) {
        if (v && typeof v === 'object') {
          if (v.$ne !== undefined && doc[k] === v.$ne) return false;
          if (v.$gte !== undefined && doc[k] < v.$gte) return false;
          if (v.$lte !== undefined && doc[k] > v.$lte) return false;
          if (v.$in !== undefined && !v.$in.includes(doc[k])) return false;
        } else if (doc[k] !== v) {
          return false;
        }
      }
      return true;
    });

    const cursor = {
      sort: (sortObj = {}) => {
        const [field, dir] = Object.entries(sortObj)[0] || ['_id', 1];
        items.sort((a, b) => {
          if (a[field] < b[field]) return -1 * dir;
          if (a[field] > b[field]) return 1 * dir;
          return 0;
        });
        return cursor;
      },
      toArray: async () => items,
      then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
      [Symbol.iterator]: () => items[Symbol.iterator]()
    };
    return cursor;
  }

  async insertOne(doc) {
    this.data.push(doc);
    this.save();
    return { acknowledged: true, insertedId: doc._id || doc.id };
  }

  async insertMany(docs) {
    this.data.push(...docs);
    this.save();
    return { acknowledged: true, insertedCount: docs.length };
  }

  async deleteOne(query) {
    const idx = this.data.findIndex(d => {
      for (const [k, v] of Object.entries(query)) {
        if (d[k] !== v) return false;
      }
      return true;
    });
    if (idx >= 0) {
      this.data.splice(idx, 1);
      this.save();
      return { acknowledged: true, deletedCount: 1 };
    }
    return { acknowledged: true, deletedCount: 0 };
  }

  async findOne(query = {}) {
    return this.data.find(doc => {
      for (const [k, v] of Object.entries(query)) {
        if (doc[k] !== v) return false;
      }
      return true;
    }) || null;
  }

  async replaceOne(query, doc, options = {}) {
    const idx = this.data.findIndex(d => {
      for (const [k, v] of Object.entries(query)) {
        if (d[k] !== v) return false;
      }
      return true;
    });
    if (idx >= 0) {
      this.data[idx] = doc;
    } else if (options.upsert) {
      this.data.push(doc);
    }
    this.save();
    return { acknowledged: true };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    let doc = await this.findOne(filter);
    if (!doc && options.upsert) {
      doc = { ...filter, seq: 0 };
      if (update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
      this.data.push(doc);
    }
    if (doc && update.$inc) {
      for (const [k, incVal] of Object.entries(update.$inc)) {
        doc[k] = (doc[k] || 0) + incVal;
      }
    }
    this.save();
    return doc;
  }

  async createIndex() {
    return true;
  }
}

/**
 * Connect to MongoDB Atlas (re-uses existing connection if already open).
 * Called lazily — first access to any new collection triggers connection.
 */
async function connectAccounting() {
  if (_connected && _db) return _db;
  if (!MONGODB_URI || _connectFailed) {
    return null;
  }
  try {
    if (!_client) {
      _client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: process.env.NODE_ENV === 'test' ? 1000 : 3000,
        socketTimeoutMS: 15000,
      });
    }
    await _client.connect();
    _db = _client.db(DB_NAME);
    _connected = true;
    console.log('[db.js] Accounting collections connected to MongoDB Atlas.');
    return _db;
  } catch (err) {
    _connectFailed = true;
    return null;
  }
}

/**
 * Get a named collection for accounting data (cloud MongoDB or local fallback).
 */
async function getCollection(name) {
  const db = await connectAccounting();
  if (db) {
    return db.collection(name);
  }
  if (!_localCollections.has(name)) {
    _localCollections.set(name, new LocalCollection(name));
  }
  return _localCollections.get(name);
}

/**
 * Run a function inside a MongoDB session (for atomic multi-document writes).
 */
async function withSession(fn) {
  const db = await connectAccounting();
  if (!db || !_client) {
    return await fn(null);
  }
  const session = _client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Ensure indexes exist for a collection (idempotent, safe to call on startup).
 */
async function ensureIndexes() {
  try {
    const db = await connectAccounting();
    if (!db) return;

    const docs = db.collection('documents');
    await docs.createIndex({ companyId: 1, docType: 1, createdAt: -1 });
    await docs.createIndex({ companyId: 1, rootId: 1, rev: 1 });
    await docs.createIndex({ companyId: 1, no: 1 }, { unique: true, sparse: true });
    await docs.createIndex({ shareToken: 1 }, { sparse: true });

    console.log('[db.js] Accounting indexes ensured.');
  } catch (err) {
    console.warn('[db.js] Index setup warning:', err.message);
  }
}

module.exports = { getCollection, withSession, ensureIndexes, connectAccounting };
