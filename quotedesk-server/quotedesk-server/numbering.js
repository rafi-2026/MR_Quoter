'use strict';
/**
 * numbering.js — Gap-less, per-company, per-FY, per-doctype document number series.
 * Golden Rule: never touches or modifies existing quote numbering in getDb().
 *
 * Statutory GST 16-character limit strictly respected:
 *   Tax Invoice:       MRI/26-27/0001   or CTBI/26-27/0001  (<= 16 chars)
 *   Delivery Challan:  MRD/26-27/0001   or CTBD/26-27/0001  (<= 16 chars)
 *   Credit Note:       MRC/26-27/0001   or CTBC/26-27/0001  (<= 16 chars)
 *   Debit Note:        MRN/26-27/0001   or CTBN/26-27/0001  (<= 16 chars)
 *
 * Non-statutory documents (free prefixing and revision suffixing):
 *   Proforma Invoice:      CTB/PI/26-27/0001
 *   Customer PO:           CTB/PO/26-27/0001
 *   Material Requisition:  CTB/MRL/26-27/0001
 *   Vendor PO:             CTB/VPO/26-27/0001
 */

const { getCollection } = require('./db.js');

/** Indian FY string for a given date, e.g. "26-27" for Nov 2026 */
function fyOf(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-based
  const startYear = m >= 3 ? y : y - 1; // April (3) starts new FY
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Document type config: prefix, maxLen validation, description
 */
const DOC_TYPES = {
  pi:    { label: 'Proforma Invoice',          prefix: 'PI',  shortCode: 'PI', maxLen: null, revisable: true  },
  cpo:   { label: 'Customer PO / Work Order',  prefix: 'PO',  shortCode: 'PO', maxLen: null, revisable: true  },
  dc:    { label: 'Delivery Challan',          prefix: 'DC',  shortCode: 'D',  maxLen: 16,   revisable: false }, // GST 16-char rule
  mrl:   { label: 'Material Requisition',      prefix: 'MRL', shortCode: 'MR', maxLen: null, revisable: true  },
  vpo:   { label: 'Vendor Purchase Order',     prefix: 'VPO', shortCode: 'VP', maxLen: null, revisable: true  },
  grn:   { label: 'Goods Received Note',       prefix: 'GRN', shortCode: 'GR', maxLen: null, revisable: false },
  inv:   { label: 'Tax Invoice',               prefix: 'INV', shortCode: 'I',  maxLen: 16,   revisable: false }, // GST 16-char strict
  ra:    { label: 'Running Account Bill',      prefix: 'RA',  shortCode: 'RA', maxLen: null, revisable: false },
  cn:    { label: 'Credit Note',               prefix: 'CN',  shortCode: 'C',  maxLen: 16,   revisable: false },
  dn:    { label: 'Debit Note',                prefix: 'DN',  shortCode: 'N',  maxLen: 16,   revisable: false },
  pb:    { label: 'Purchase Bill',             prefix: 'PB',  shortCode: 'PB', maxLen: null, revisable: false },
  rv:    { label: 'Receipt Voucher',           prefix: 'RV',  shortCode: 'RV', maxLen: null, revisable: false },
  pv:    { label: 'Payment Voucher',           prefix: 'PV',  shortCode: 'PV', maxLen: null, revisable: false },
  jv:    { label: 'Journal Voucher',           prefix: 'JV',  shortCode: 'JV', maxLen: null, revisable: false },
  pc:    { label: 'Petty Cash Voucher',        prefix: 'PC',  shortCode: 'PC', maxLen: null, revisable: false },
};

/**
 * Format document number cleanly based on statutory limits
 */
function formatNumber(companyCode, docType, fy, seq) {
  const cfg = DOC_TYPES[docType];
  const paddedSeq = String(seq).padStart(4, '0');
  const code = (companyCode || 'MR').toUpperCase().replace(/[^A-Za-z0-9]/g, '');

  if (cfg.maxLen && cfg.maxLen <= 16) {
    // For 16-char statutory documents (Tax Invoice, Delivery Challan, Credit Note, Debit Note):
    // e.g. MRI/26-27/0001 (14 chars) or CTBI/26-27/0001 (15 chars)
    const basePrefix = code.length > 3 ? code.slice(0, 3) : code;
    return `${basePrefix}${cfg.shortCode}/${fy}/${paddedSeq}`;
  }

  // Non-statutory documents (e.g. CTB/PI/26-27/0001)
  return `${code}/${cfg.prefix}/${fy}/${paddedSeq}`;
}

/**
 * Validate a document number.
 * For Tax Invoice, DC, CN, DN: max 16 chars, only A-Z 0-9 / -
 */
function validateDocNumber(no, docType) {
  const cfg = DOC_TYPES[docType];
  if (!cfg) return;
  if (cfg.maxLen && no.length > cfg.maxLen) {
    throw new Error(
      `${cfg.label} number "${no}" is ${no.length} characters — GST rules allow max ${cfg.maxLen} characters. ` +
      `Use a shorter company prefix in Settings.`
    );
  }
  if (cfg.maxLen && !/^[A-Za-z0-9/\-]+$/.test(no)) {
    throw new Error(
      `${cfg.label} number "${no}" contains invalid characters. ` +
      `GST allows only letters, digits, / and - in invoice numbers.`
    );
  }
}

/**
 * Atomically allocate the next sequence number and return the formatted doc number.
 */
async function allocateNumber(companyId, companyCode, docType, dateStr) {
  const cfg = DOC_TYPES[docType];
  if (!cfg) throw new Error(`Unknown document type: ${docType}`);

  const fy = fyOf(dateStr);
  const seqKey = `${companyId}:${docType}:${fy}`;
  const col = await getCollection('doc_sequences');

  // Atomic increment — MongoDB guarantees no two callers get the same number
  const result = await col.findOneAndUpdate(
    { _id: seqKey },
    { $inc: { seq: 1 }, $setOnInsert: { companyId, docType, fy, createdAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );

  const seq = result.seq;
  const no = formatNumber(companyCode, docType, fy, seq);

  // Validate BEFORE returning
  validateDocNumber(no, docType);

  return { no, seq, fy };
}

/**
 * Preview the next number without allocating it (for display only).
 */
async function previewNextNumber(companyId, companyCode, docType, dateStr) {
  const cfg = DOC_TYPES[docType];
  if (!cfg) throw new Error(`Unknown document type: ${docType}`);

  const fy = fyOf(dateStr);
  const seqKey = `${companyId}:${docType}:${fy}`;
  const col = await getCollection('doc_sequences');

  const existing = await col.findOne({ _id: seqKey });
  const nextSeq = existing ? existing.seq + 1 : 1;
  const no = formatNumber(companyCode, docType, fy, nextSeq);
  return { no, seq: nextSeq, fy };
}

module.exports = { allocateNumber, previewNextNumber, validateDocNumber, DOC_TYPES, fyOf, formatNumber };
