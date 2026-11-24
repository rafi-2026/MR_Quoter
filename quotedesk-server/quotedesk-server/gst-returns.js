'use strict';
/**
 * gst-returns.js — Statutory GST Return Generation Engine (GSTR-1, GSTR-3B & 2B Matcher)
 *
 * Implements standard GST portal JSON return schemas:
 *   - GSTR-1: Outward Supplies (B2B, B2C Large, B2C Small, HSN Summary, Credit/Debit Notes)
 *   - GSTR-3B: Monthly Summary Return (Table 3.1 Outward, Table 4 Eligible ITC, Table 5 Exempt)
 *   - GSTR-2B Matching: Matches supplier invoices from purchase bills against 2B records
 *   - TDS / TCS Register: Section 194C, 194J, 206C deductions & payable logs
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees, roundToRupee } = require('./paise.js');

function round(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Generate GSTR-1 JSON return payload conforming to GST Portal Schema
 * @param {string} companyId
 * @param {string} returnPeriod - e.g. "042026" (MMYYYY)
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 */
async function generateGstr1Json(companyId, returnPeriod, fromDate, toDate) {
  const vchCol = await getCollection('vouchers');
  const query = {
    companyId,
    voucherType: { $in: ['sales', 'credit_note', 'debit_note'] },
    cancelled: false
  };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };

  const vouchers = await vchCol.find(query).toArray();

  const b2bMap = new Map(); // Group by customer GSTIN
  const b2csList = [];
  const hsnMap = new Map();
  const cdnrList = [];

  for (const v of vouchers) {
    const isB2B = !!(v.billing && v.billing.gstin && v.billing.gstin.trim().length === 15);
    const partyGstin = isB2B ? v.billing.gstin.trim().toUpperCase() : null;

    // Line totals
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    for (const e of (v.entries || [])) {
      if (e.ledgerId === 'led_sales_goods' || e.ledgerId === 'led_sales_services') {
        taxable += (e.credit - e.debit);
      }
      if (e.ledgerId === 'led_cgst_out') cgst += (e.credit - e.debit);
      if (e.ledgerId === 'led_sgst_out') sgst += (e.credit - e.debit);
      if (e.ledgerId === 'led_igst_out') igst += (e.credit - e.debit);
    }

    taxable = round(taxable);
    cgst = round(cgst);
    sgst = round(sgst);
    igst = round(igst);
    const taxRate = taxable > 0 ? Math.round(((cgst + sgst + igst) / taxable) * 100) : 18;

    // 1. Credit / Debit Notes Section
    if (v.voucherType === 'credit_note' || v.voucherType === 'debit_note') {
      cdnrList.push({
        nt_num: v.voucherNo,
        nt_dt: v.date,
        ntty: v.voucherType === 'credit_note' ? 'C' : 'D',
        inum: v.docRef || v.voucherNo,
        val: v.totalAmount,
        itms: [{ num: 1, itm_det: { rt: taxRate, txval: taxable, iamt: igst, camt: cgst, samt: sgst } }]
      });
      continue;
    }

    // 2. B2B Invoices Section
    if (isB2B) {
      if (!b2bMap.has(partyGstin)) {
        b2bMap.set(partyGstin, {
          ctin: partyGstin,
          inv: []
        });
      }
      b2bMap.get(partyGstin).inv.push({
        inum: v.voucherNo,
        idt: v.date,
        val: v.totalAmount,
        pos: partyGstin.slice(0, 2),
        rchrg: 'N',
        inv_typ: 'R',
        itms: [{ num: 1, itm_det: { rt: taxRate, txval: taxable, iamt: igst, camt: cgst, samt: sgst } }]
      });
    } else {
      // 3. B2C Small
      b2csList.push({
        sply_ty: 'INTRA',
        pos: '33', // Default Tamil Nadu or state code
        typ: 'OE',
        rt: taxRate,
        txval: taxable,
        camt: cgst,
        samt: sgst
      });
    }

    // 4. HSN Summary
    const hsn = v.hsnCode || '7604';
    if (!hsnMap.has(hsn)) {
      hsnMap.set(hsn, { hsn_sc: hsn, desc: 'Fabricated Profiles / Windows', uqc: 'KGS', qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 });
    }
    const h = hsnMap.get(hsn);
    h.txval = round(h.txval + taxable);
    h.val = round(h.val + v.totalAmount);
    h.iamt = round(h.iamt + igst);
    h.camt = round(h.camt + cgst);
    h.samt = round(h.samt + sgst);
  }

  return {
    gstin: companyId,
    fp: returnPeriod || '042026',
    b2b: Array.from(b2bMap.values()),
    b2cs: b2csList,
    cdnr: cdnrList,
    hsn: { data: Array.from(hsnMap.values()) }
  };
}

/**
 * Generate GSTR-3B Summary Data Table
 */
async function generateGstr3bData(companyId, fromDate, toDate) {
  const reports = require('./reports.js');
  const gst = await reports.getGstSummary(companyId, fromDate, toDate);

  return {
    table3_1_outward: {
      nature: '3.1(a) Outward taxable supplies (other than zero rated, nil and exempted)',
      taxableValue: gst.gstr1.taxableSupplies,
      igst: gst.gstr1.igst,
      cgst: gst.gstr1.cgst,
      sgst: gst.gstr1.sgst,
      cess: 0
    },
    table4_itc: {
      nature: '4(A)(5) All other ITC (Inward supplies from registered persons)',
      igst: gst.gstr3b.eligibleItc > 0 ? gst.gstr3b.eligibleItc : 0,
      cgst: round(gst.gstr3b.eligibleItc / 2),
      sgst: round(gst.gstr3b.eligibleItc / 2),
      cess: 0
    },
    table6_1_payment: {
      nature: '6.1 Payment of Tax (Net cash liability)',
      totalTaxLiability: gst.gstr3b.outwardTax,
      itcUtilized: gst.gstr3b.eligibleItc,
      netTaxPaidCash: gst.gstr3b.netTaxPayableCash
    }
  };
}

/**
 * GSTR-2B Inward Reconciliation Engine
 * Compares vendor purchase bills in QuoteDesk against an uploaded GSTR-2B JSON.
 */
async function reconcileGstr2b(companyId, gstr2bInvoices = []) {
  const vchCol = await getCollection('vouchers');
  const purchaseVouchers = await vchCol.find({ companyId, voucherType: 'purchase', cancelled: false }).toArray();

  const matched = [];
  const missingInBooks = [];
  const missingIn2b = [];

  const booksMap = new Map();
  for (const p of purchaseVouchers) {
    const key = (p.docRef || p.voucherNo || '').trim().toUpperCase();
    booksMap.set(key, p);
  }

  const gstr2bSet = new Set();
  for (const inv of gstr2bInvoices) {
    const invNo = (inv.inum || inv.invoiceNo || '').trim().toUpperCase();
    gstr2bSet.add(invNo);

    if (booksMap.has(invNo)) {
      const b = booksMap.get(invNo);
      matched.push({
        invoiceNo: invNo,
        supplierGstin: inv.ctin || '',
        booksAmount: b.totalAmount,
        gstr2bAmount: inv.val || 0,
        status: Math.abs(b.totalAmount - (inv.val || 0)) < 1 ? 'Exact Match' : 'Value Mismatch'
      });
    } else {
      missingInBooks.push({
        invoiceNo: invNo,
        supplierGstin: inv.ctin || '',
        gstr2bAmount: inv.val || 0,
        status: 'Missing in Books (Claimable ITC)'
      });
    }
  }

  for (const [key, b] of booksMap.entries()) {
    if (!gstr2bSet.has(key)) {
      missingIn2b.push({
        invoiceNo: key,
        supplierName: b.partyName || '',
        booksAmount: b.totalAmount,
        status: 'Missing in GSTR-2B (Supplier hasn’t filed GSTR-1)'
      });
    }
  }

  return {
    totalInGstr2b: gstr2bInvoices.length,
    totalInBooks: purchaseVouchers.length,
    matchedCount: matched.length,
    missingInBooksCount: missingInBooks.length,
    missingIn2bCount: missingIn2b.length,
    matched,
    missingInBooks,
    missingIn2b
  };
}

/**
 * TDS / TCS Section Register
 */
async function recordTdsEntry(companyId, entry) {
  const col = await getCollection('tds_register');
  const doc = {
    id: 'tds_' + Math.random().toString(36).slice(2, 10),
    companyId,
    voucherId: entry.voucherId,
    section: entry.section || '194C', // 194C (Contractors), 194J (Professional), 206C (TCS)
    partyName: entry.partyName,
    partyPan: entry.partyPan || '',
    baseAmount: entry.baseAmount || 0,
    tdsRate: entry.tdsRate || 1, // 1% or 2% for 194C
    tdsAmount: round((entry.baseAmount * (entry.tdsRate || 1)) / 100),
    date: entry.date || new Date().toISOString().slice(0, 10),
    status: 'Payable',
    createdAt: Date.now()
  };
  await col.insertOne(doc);
  return doc;
}

async function getTdsRegister(companyId, fromDate, toDate) {
  const col = await getCollection('tds_register');
  const query = { companyId };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };
  return await col.find(query).toArray();
}

module.exports = {
  generateGstr1Json,
  generateGstr3bData,
  reconcileGstr2b,
  recordTdsEntry,
  getTdsRegister
};
