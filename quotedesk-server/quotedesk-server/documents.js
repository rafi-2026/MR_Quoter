'use strict';
/**
 * documents.js — Universal Document Engine with Revisions
 * Supports: PI (Proforma Invoice), CPO (Customer PO), DC (Delivery Challan),
 *           MRL (Material Requisition), VPO (Vendor PO), INV (Tax Invoice),
 *           RA (Running Account Bill), CN (Credit Note), DN (Debit Note).
 *
 * Golden Rules:
 *  - Reusable revision engine mirroring quote revision pattern
 *  - Existing quotations are completely untouched
 *  - Mandatory revision reason
 *  - Full audit trail
 *  - Strict 16-char validation for statutory documents (INV, DC, CN, DN)
 *  - Dual persistence: MongoDB Atlas 'documents' collection + local JSON fallback
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getCollection } = require('./db.js');
const { allocateNumber, validateDocNumber, DOC_TYPES } = require('./numbering.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');

// Local in-memory / file cache for fast reads and offline support
let memoryDocs = null;

function readLocalDocs() {
  if (memoryDocs) return memoryDocs;
  try {
    if (fs.existsSync(DOCS_FILE)) {
      memoryDocs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
    } else {
      memoryDocs = [];
    }
  } catch (e) {
    memoryDocs = [];
  }
  return memoryDocs;
}

function writeLocalDocs(docs) {
  memoryDocs = docs;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DOCS_FILE, JSON.stringify(docs, null, 2), 'utf8');
  } catch (e) {
    console.warn('[documents.js] Local file write warning:', e.message);
  }
}

/**
 * Generate a unique ID for documents
 */
function uid(prefix = 'doc') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Calculate totals for a document
 */
function calcDocTotals(lines = [], gstRate = 18, isInterState = false) {
  let subtotal = 0;
  let totalDiscount = 0;
  let taxable = 0;

  const calculatedLines = lines.map(line => {
    const qty = Number(line.qty) || 0;
    const rate = Number(line.rate) || 0;
    const gross = qty * rate;
    const disc = Number(line.disc) || 0;
    const lineDiscount = line.discType === 'pct' ? (gross * disc / 100) : disc;
    const lineTaxable = Math.max(0, gross - lineDiscount);

    subtotal += gross;
    totalDiscount += lineDiscount;
    taxable += lineTaxable;

    const lineGstRate = Number(line.gstRate != null ? line.gstRate : gstRate);
    let cgst = 0, sgst = 0, igst = 0;

    if (isInterState) {
      igst = Math.round(lineTaxable * lineGstRate / 100);
    } else {
      cgst = Math.round(lineTaxable * (lineGstRate / 2) / 100);
      sgst = Math.round(lineTaxable * (lineGstRate / 2) / 100);
    }
    const total = lineTaxable + cgst + sgst + igst;

    return {
      ...line,
      qty,
      rate,
      gross: Math.round(gross),
      discount: Math.round(lineDiscount),
      taxable: Math.round(lineTaxable),
      gstRate: lineGstRate,
      cgst,
      sgst,
      igst,
      total: Math.round(total)
    };
  });

  let cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
  if (isInterState) {
    igstTotal = Math.round(taxable * gstRate / 100);
  } else {
    cgstTotal = Math.round(taxable * (gstRate / 2) / 100);
    sgstTotal = Math.round(taxable * (gstRate / 2) / 100);
  }

  const rawGrand = taxable + cgstTotal + sgstTotal + igstTotal;
  const grandTotal = Math.round(rawGrand);
  const roundOff = +(grandTotal - rawGrand).toFixed(2);

  return {
    lines: calculatedLines,
    totals: {
      subtotal: Math.round(subtotal),
      discount: Math.round(totalDiscount),
      taxable: Math.round(taxable),
      cgst: cgstTotal,
      sgst: sgstTotal,
      igst: igstTotal,
      totalTax: cgstTotal + sgstTotal + igstTotal,
      roundOff,
      grandTotal
    }
  };
}

/**
 * Persist document to MongoDB and local JSON
 */
async function saveDoc(doc) {
  // 1. Local update
  const list = readLocalDocs();
  const idx = list.findIndex(d => d.id === doc.id);
  if (idx >= 0) {
    list[idx] = doc;
  } else {
    list.push(doc);
  }
  writeLocalDocs(list);

  // 2. Cloud MongoDB update if available
  try {
    const col = await getCollection('documents');
    await col.replaceOne({ id: doc.id }, doc, { upsert: true });
  } catch (err) {
    console.warn('[documents.js] Cloud DB sync warning (persisted locally):', err.message);
  }
}

/**
 * Get all documents for a company (or all if master), optionally filtered by docType
 */
async function listDocuments({ companyId, docType, status, isMaster = false, showAllRevs = false }) {
  let list = readLocalDocs();

  // Try to sync with MongoDB
  try {
    const col = await getCollection('documents');
    const query = {};
    if (!isMaster && companyId) query.companyId = companyId;
    if (docType && docType !== 'all') query.docType = docType;
    if (status && status !== 'all') query.status = status;
    if (!showAllRevs) query.superseded = { $ne: true };

    const cloudDocs = await col.find(query).sort({ createdAt: -1 }).toArray();
    if (cloudDocs && cloudDocs.length > 0) {
      // Merge or prefer cloud docs
      return cloudDocs;
    }
  } catch (e) {
    // fallback to local
  }

  return list.filter(d => {
    if (!isMaster && companyId && d.companyId !== companyId) return false;
    if (docType && docType !== 'all' && d.docType !== docType) return false;
    if (status && status !== 'all' && d.status !== status) return false;
    if (!showAllRevs && d.superseded) return false;
    return true;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Get single document by ID
 */
async function getDocumentById(id) {
  const local = readLocalDocs().find(d => d.id === id);
  try {
    const col = await getCollection('documents');
    const cloud = await col.findOne({ id });
    if (cloud) return cloud;
  } catch (e) { }
  return local || null;
}

/**
 * Create a new document (Revision 0)
 */
async function createDocument(data, user) {
  const {
    companyId,
    companyCode,
    docType,
    date = new Date().toISOString().slice(0, 10),
    cust = {},
    vendor = {},
    project = '',
    site = '',
    pos = 'Tamil Nadu',
    lines = [],
    terms = '',
    notes = '',
    gstRate = 18,
    isInterState = false,
    sourceDocId = null,
    sourceDocNo = null,
    sourceDocType = null,
    sourceRev = null,
    metadata = {}
  } = data;

  if (!DOC_TYPES[docType]) {
    throw new Error(`Invalid document type: ${docType}`);
  }

  // Allocate document number
  const numInfo = await allocateNumber(companyId || 'default', companyCode || 'MRQ', docType, date);
  const calculated = calcDocTotals(lines, gstRate, isInterState);
  const id = uid(docType);

  const doc = {
    id,
    rootId: id,
    rev: 0,
    baseNo: numInfo.no,
    no: numInfo.no,
    docType,
    date,
    companyId: companyId || 'default',
    companyCode: companyCode || 'MRQ',
    status: 'draft',
    superseded: false,
    revReason: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: user ? user.id : '',
    preparedByName: user ? user.name : '',
    preparedByRole: user ? user.role : '',
    cust,
    vendor,
    project,
    site,
    pos,
    gstRate,
    isInterState,
    lines: calculated.lines,
    totals: calculated.totals,
    terms,
    notes,
    sourceDocId,
    sourceDocNo,
    sourceDocType,
    sourceRev,
    metadata: metadata || {},
    shareToken: crypto.randomBytes(16).toString('hex'),
    log: [
      {
        t: Date.now(),
        u: user ? user.name : 'System',
        x: `Created ${DOC_TYPES[docType].label} ${numInfo.no}`,
        reason: ''
      }
    ]
  };

  await saveDoc(doc);
  return doc;
}

/**
 * Update a document while it is in editable state (draft / pending)
 */
async function updateDocument(id, updates, user) {
  const doc = await getDocumentById(id);
  if (!doc) throw new Error('Document not found');

  if (doc.superseded) {
    throw new Error('Cannot edit a superseded document revision.');
  }

  // Statutory lock for Tax Invoices
  if (doc.docType === 'inv' && ['issued', 'finalised'].includes(doc.status)) {
    throw new Error('A finalised Tax Invoice cannot be edited. It must be cancelled or adjusted via Credit/Debit Note.');
  }

  const {
    date,
    cust,
    vendor,
    project,
    site,
    pos,
    lines,
    terms,
    notes,
    gstRate,
    isInterState,
    metadata
  } = updates;

  if (date) doc.date = date;
  if (cust) doc.cust = { ...doc.cust, ...cust };
  if (vendor) doc.vendor = { ...doc.vendor, ...vendor };
  if (project !== undefined) doc.project = project;
  if (site !== undefined) doc.site = site;
  if (pos !== undefined) doc.pos = pos;
  if (terms !== undefined) doc.terms = terms;
  if (notes !== undefined) doc.notes = notes;
  if (gstRate !== undefined) doc.gstRate = gstRate;
  if (isInterState !== undefined) doc.isInterState = isInterState;
  if (metadata) doc.metadata = { ...doc.metadata, ...metadata };

  if (lines) {
    const calculated = calcDocTotals(lines, doc.gstRate, doc.isInterState);
    doc.lines = calculated.lines;
    doc.totals = calculated.totals;
  }

  doc.updatedAt = Date.now();
  doc.log.push({
    t: Date.now(),
    u: user ? user.name : 'System',
    x: 'Updated document contents',
    reason: updates.updateNote || ''
  });

  await saveDoc(doc);
  return doc;
}

/**
 * Create a new revision of an existing document.
 * Follows the Universal Revision Engine specification:
 * - Copies latest version into a NEW record linked to rootId
 * - Old version marked superseded: true and locked
 * - Suffix is /R1, /R2 etc. (unless statutory rules disallow)
 * - Mandatory revReason
 */
async function createRevision(id, revReason, user) {
  if (!revReason || !revReason.trim()) {
    throw new Error('A mandatory "Reason for revision" is required.');
  }

  const current = await getDocumentById(id);
  if (!current) throw new Error('Document not found');

  // Statutory rule check for Tax Invoice
  if (current.docType === 'inv' && ['issued', 'finalised'].includes(current.status)) {
    throw new Error(
      'Per GST regulations, an issued Tax Invoice cannot be revised. ' +
      'Please cancel and reissue with a new number, or issue a Credit/Debit Note.'
    );
  }

  const allRevs = await getRevisionHistory(current.rootId);
  const nextRev = Math.max(...allRevs.map(d => d.rev || 0)) + 1;
  const newId = uid(current.docType);

  let newNo = current.baseNo;
  // Non-statutory documents get revision suffix
  if (DOC_TYPES[current.docType] && DOC_TYPES[current.docType].revisable) {
    newNo = `${current.baseNo}/R${nextRev}`;
  } else {
    // For DC/INV in draft mode, keep the root number within 16 chars
    newNo = current.baseNo;
  }

  // Validate number length
  validateDocNumber(newNo, current.docType);

  // Mark all existing revisions of this root as superseded
  for (const r of allRevs) {
    r.superseded = true;
    r.updatedAt = Date.now();
    await saveDoc(r);
  }

  // Create clone for new revision
  const newDoc = JSON.parse(JSON.stringify(current));
  newDoc.id = newId;
  newDoc.rev = nextRev;
  newDoc.no = newNo;
  newDoc.status = 'draft';
  newDoc.superseded = false;
  newDoc.revReason = revReason.trim();
  newDoc.createdAt = Date.now();
  newDoc.updatedAt = Date.now();
  newDoc.createdBy = user ? user.id : '';
  newDoc.preparedByName = user ? user.name : '';
  newDoc.preparedByRole = user ? user.role : '';
  newDoc.shareToken = crypto.randomBytes(16).toString('hex');
  newDoc.lines = newDoc.lines.map(l => ({ ...l, id: uid('line') }));

  newDoc.log = [
    {
      t: Date.now(),
      u: user ? user.name : 'System',
      x: `Created Revision ${nextRev} from ${current.no}`,
      reason: revReason.trim()
    }
  ];

  await saveDoc(newDoc);
  return newDoc;
}

/**
 * Get all revisions for a root document
 */
async function getRevisionHistory(rootId) {
  let list = readLocalDocs().filter(d => d.rootId === rootId);
  try {
    const col = await getCollection('documents');
    const cloud = await col.find({ rootId }).sort({ rev: 1 }).toArray();
    if (cloud && cloud.length) list = cloud;
  } catch (e) { }

  return list.sort((a, b) => (a.rev || 0) - (b.rev || 0));
}

/**
 * Compare any two revisions side-by-side
 */
async function compareRevisions(docIdA, docIdB) {
  const docA = await getDocumentById(docIdA);
  const docB = await getDocumentById(docIdB);

  if (!docA || !docB) throw new Error('One or both documents not found for comparison.');

  const linesA = docA.lines || [];
  const linesB = docB.lines || [];

  // Map by description/name/hsn for intelligent matching
  const mapA = new Map(linesA.map((l, i) => [(l.name || l.desc || '') + '::' + (l.unit || ''), l]));
  const mapB = new Map(linesB.map((l, i) => [(l.name || l.desc || '') + '::' + (l.unit || ''), l]));

  const comparison = [];
  const allKeys = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));

  for (const k of allKeys) {
    const itemA = mapA.get(k);
    const itemB = mapB.get(k);

    if (!itemA && itemB) {
      comparison.push({
        key: k,
        name: itemB.name || itemB.desc,
        unit: itemB.unit,
        status: 'ADDED',
        revA: null,
        revB: { qty: itemB.qty, rate: itemB.rate, total: itemB.total },
        qtyDiff: itemB.qty,
        totalDiff: itemB.total
      });
    } else if (itemA && !itemB) {
      comparison.push({
        key: k,
        name: itemA.name || itemA.desc,
        unit: itemA.unit,
        status: 'REMOVED',
        revA: { qty: itemA.qty, rate: itemA.rate, total: itemA.total },
        revB: null,
        qtyDiff: -itemA.qty,
        totalDiff: -itemA.total
      });
    } else {
      const qtyDiff = (itemB.qty || 0) - (itemA.qty || 0);
      const totalDiff = (itemB.total || 0) - (itemA.total || 0);
      const rateDiff = (itemB.rate || 0) - (itemA.rate || 0);
      const isChanged = qtyDiff !== 0 || totalDiff !== 0 || rateDiff !== 0;

      comparison.push({
        key: k,
        name: itemB.name || itemB.desc,
        unit: itemB.unit,
        status: isChanged ? 'MODIFIED' : 'UNCHANGED',
        revA: { qty: itemA.qty, rate: itemA.rate, total: itemA.total },
        revB: { qty: itemB.qty, rate: itemB.rate, total: itemB.total },
        qtyDiff,
        rateDiff,
        totalDiff
      });
    }
  }

  const grandA = (docA.totals && docA.totals.grandTotal) || 0;
  const grandB = (docB.totals && docB.totals.grandTotal) || 0;

  return {
    docA: { id: docA.id, no: docA.no, rev: docA.rev, date: docA.date, total: grandA },
    docB: { id: docB.id, no: docB.no, rev: docB.rev, date: docB.date, total: grandB },
    totalDifference: grandB - grandA,
    linesDiff: comparison
  };
}

/**
 * Update document status with audit log
 */
async function setDocumentStatus(id, newStatus, reason = '', user) {
  const doc = await getDocumentById(id);
  if (!doc) throw new Error('Document not found');

  const oldStatus = doc.status;
  doc.status = newStatus;
  doc.updatedAt = Date.now();

  if (newStatus === 'issued' || newStatus === 'finalised') {
    doc.issuedAt = Date.now();
  }

  doc.log.push({
    t: Date.now(),
    u: user ? user.name : 'System',
    x: `Status changed from "${oldStatus}" to "${newStatus}"`,
    reason: reason || ''
  });

  await saveDoc(doc);
  return doc;
}

module.exports = {
  createDocument,
  updateDocument,
  createRevision,
  getDocumentById,
  listDocuments,
  getRevisionHistory,
  compareRevisions,
  setDocumentStatus,
  calcDocTotals,
  DOC_TYPES
};
