'use strict';
/**
 * challan.js — Delivery Challan Module (With-Value & Without-Value modes)
 * Compliant with CGST Rule 55:
 *   - Purpose: supply of goods, job work, supply on approval, line sales, other
 *   - Transport details: vehicle, driver, transporter, LR no
 *   - Dual modes:
 *       1. With Value: rates, taxable value, tax, total (road check-posts / e-way bill)
 *       2. Without Value: items, qty, UOM, HSN only (gate pass / site store / bill claim)
 *   - Print/download audit logging
 *   - Partial delivery quantity tracking against source PO/PI/Quotation
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { getDocumentById, saveDoc } = require('./documents.js');

const CHALLAN_PURPOSES = {
  supply_of_goods:    'Supply of Goods',
  job_work:           'Job Work',
  supply_on_approval: 'Supply on Approval',
  line_sales:         'Line Sales',
  other:              'Other (Site Transfer / Material Movement)'
};

/**
 * Track partial delivery against a source document.
 * Compares source document line quantities against all issued Delivery Challans for that source.
 */
async function getPendingDeliveryQuantities(sourceDocId, companyId) {
  const { listDocuments } = require('./documents.js');
  const sourceDoc = await getDocumentById(sourceDocId);
  if (!sourceDoc) throw new Error('Source document not found');

  // Find all delivery challans linked to this source
  const allDocs = await listDocuments({ companyId, docType: 'dc', showAllRevs: true });
  const relatedChallans = allDocs.filter(d => d.sourceDocId === sourceDocId && d.status !== 'cancelled');

  const deliveredMap = new Map();
  relatedChallans.forEach(ch => {
    (ch.lines || []).forEach(l => {
      const key = l.sourceLineId || (l.name + '::' + (l.unit || ''));
      deliveredMap.set(key, (deliveredMap.get(key) || 0) + (Number(l.qty) || 0));
    });
  });

  return (sourceDoc.lines || []).map(l => {
    const key = l.id || (l.name + '::' + (l.unit || ''));
    const orderedQty = Number(l.qty) || 0;
    const deliveredQty = deliveredMap.get(key) || 0;
    const pendingQty = Math.max(0, orderedQty - deliveredQty);

    return {
      sourceLineId: l.id,
      name: l.name || l.desc,
      unit: l.unit || 'nos',
      hsn: l.hsn || '7610',
      rate: l.rate || 0,
      gstRate: l.gstRate || 18,
      orderedQty,
      deliveredQty,
      pendingQty,
      isFullyDelivered: pendingQty === 0
    };
  });
}

/**
 * Log challan print / download with mode tracking
 */
async function logChallanAccess(docId, mode = 'with_value', user) {
  const doc = await getDocumentById(docId);
  if (!doc) return;

  const modeLabel = mode === 'without_value' ? 'WITHOUT VALUE (Gate / Site Copy)' : 'WITH VALUE (Commercial / EWB Copy)';
  const userName = user ? user.name : 'Authorized Staff';

  doc.log = doc.log || [];
  doc.log.push({
    t: Date.now(),
    u: userName,
    x: `Printed / Exported Challan [${modeLabel}]`,
    reason: `Mode: ${mode}`
  });

  const { saveDoc } = require('./documents.js');
  // Local save
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
  try {
    if (fs.existsSync(DOCS_FILE)) {
      const list = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
      const idx = list.findIndex(d => d.id === doc.id);
      if (idx >= 0) { list[idx] = doc; fs.writeFileSync(DOCS_FILE, JSON.stringify(list, null, 2), 'utf8'); }
    }
  } catch (e) { }
}

/**
 * Generate Delivery Challan PDF Buffer
 * @param {Object} doc - Document record
 * @param {Object} settings - Company settings
 * @param {boolean} withValue - true for with-value, false for without-value
 */
function generateDeliveryChallanPdf(doc, settings = {}, withValue = true) {
  return new Promise((resolve, reject) => {
    try {
      const docPdf = new PDFDocument({
        size: 'A4',
        margin: 36,
        info: {
          Title: `Delivery Challan ${doc.no}`,
          Author: settings.company || 'MR_Quoter'
        }
      });

      const chunks = [];
      docPdf.on('data', chunk => chunks.push(chunk));
      docPdf.on('end', () => resolve(Buffer.concat(chunks)));
      docPdf.on('error', err => reject(err));

      const fontReg = path.join(__dirname, 'fonts', 'regular.ttf');
      const fontBold = path.join(__dirname, 'fonts', 'bold.ttf');
      if (fs.existsSync(fontReg) && fs.existsSync(fontBold)) {
        docPdf.registerFont('CustomReg', fontReg);
        docPdf.registerFont('CustomBold', fontBold);
        docPdf.font('CustomReg');
      }

      const modeTitle = withValue ? 'DELIVERY CHALLAN (WITH VALUE)' : 'DELIVERY CHALLAN (WITHOUT VALUE / GATE PASS)';
      const subHeader = withValue
        ? 'Issued under CGST Rule 55 — For Transportation / Check-Post / E-Way Bill'
        : 'Issued under CGST Rule 55 — For Site Store / Gate Entry / Verification (No Commercial Value)';

      // Header Banner
      docPdf.fontSize(16).fillColor('#1e3a8a');
      docPdf.text(settings.company || 'CRESCENT TECHNOBUILD PVT LTD', { align: 'center' });
      docPdf.fontSize(8).fillColor('#64748b');
      docPdf.text(settings.address1 ? `${settings.address1}, ${settings.city || ''} ${settings.state || ''} ${settings.pincode || ''}` : '', { align: 'center' });
      if (settings.gstin) docPdf.text(`GSTIN: ${settings.gstin}`, { align: 'center' });

      docPdf.moveDown(0.5);
      docPdf.fontSize(12).fillColor('#0f172a');
      docPdf.text(modeTitle, { align: 'center', underline: true });
      docPdf.fontSize(7.5).fillColor('#475569');
      docPdf.text(subHeader, { align: 'center' });
      docPdf.moveDown(0.5);

      // Meta Table
      const yMeta = docPdf.y;
      docPdf.rect(36, yMeta, 523, 76).strokeColor('#cbd5e1').stroke();

      // Left Column: Consignee
      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text('CONSIGNEE (Delivered To):', 44, yMeta + 6);
      docPdf.fontSize(9).fillColor('#1e293b');
      docPdf.text(doc.cust && doc.cust.name ? doc.cust.name : 'Site Store / Client', 44, yMeta + 18);
      docPdf.fontSize(8).fillColor('#475569');
      if (doc.cust && doc.cust.address) docPdf.text(doc.cust.address, 44, yMeta + 30, { width: 230 });
      if (doc.cust && doc.cust.gstin) docPdf.text(`GSTIN: ${doc.cust.gstin}`, 44, yMeta + 44);
      if (doc.site) docPdf.text(`Delivery Site: ${doc.site}`, 44, yMeta + 56, { width: 230 });

      // Right Column: Challan Details
      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text(`Challan No:`, 300, yMeta + 6);
      docPdf.fontSize(9).fillColor('#1e3a8a');
      docPdf.text(doc.no || '-', 360, yMeta + 6);

      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text(`Date:`, 300, yMeta + 18);
      docPdf.text(doc.date || '-', 360, yMeta + 18);

      const meta = doc.metadata || {};
      const purpose = CHALLAN_PURPOSES[meta.challanPurpose] || meta.challanPurpose || 'Supply of Goods';
      docPdf.text(`Purpose:`, 300, yMeta + 30);
      docPdf.fillColor('#0284c7').text(purpose, 360, yMeta + 30);

      docPdf.fillColor('#0f172a');
      docPdf.text(`Vehicle No:`, 300, yMeta + 42);
      docPdf.text(meta.vehicleNo || 'Self Transport', 360, yMeta + 42);

      docPdf.text(`Transporter:`, 300, yMeta + 54);
      docPdf.text(meta.transporterName || '-', 360, yMeta + 54);

      if (meta.lrNo) {
        docPdf.text(`LR / GR No:`, 300, yMeta + 66);
        docPdf.text(meta.lrNo, 360, yMeta + 66);
      }

      docPdf.moveDown(5);

      // Lines Table Header
      let yOffset = 86;
      if (doc.subject) {
        docPdf.fontSize(8.5).fillColor('#0f172a');
        docPdf.text(`Subject: ${doc.subject}`, 44, yMeta + 84, { width: 507 });
        yOffset = 104;
      }
      const yTable = yMeta + yOffset;
      docPdf.rect(36, yTable, 523, 20).fillColor('#f1f5f9').fill();
      docPdf.rect(36, yTable, 523, 20).strokeColor('#cbd5e1').stroke();

      docPdf.fontSize(8).fillColor('#1e293b');
      docPdf.text('#', 42, yTable + 6);
      docPdf.text('Item Description & Specification', 65, yTable + 6);
      docPdf.text('HSN', 280, yTable + 6);
      docPdf.text('Qty', 330, yTable + 6, { width: 45, align: 'right' });
      docPdf.text('UOM', 385, yTable + 6);

      if (withValue) {
        docPdf.text('Rate (₹)', 425, yTable + 6, { width: 45, align: 'right' });
        docPdf.text('Amount (₹)', 480, yTable + 6, { width: 70, align: 'right' });
      } else {
        docPdf.text('Verification Check', 440, yTable + 6, { width: 110, align: 'center' });
      }

      let curY = yTable + 20;
      const lines = doc.lines || [];

      lines.forEach((l, idx) => {
        const rowH = 22;
        docPdf.rect(36, curY, 523, rowH).strokeColor('#e2e8f0').stroke();

        docPdf.fontSize(8).fillColor('#334155');
        docPdf.text(String(idx + 1), 42, curY + 6);
        docPdf.fontSize(8).fillColor('#0f172a');
        docPdf.text(l.name || l.desc || 'Material', 65, curY + 6, { width: 205, ellipsis: true });
        docPdf.fontSize(8).fillColor('#64748b');
        docPdf.text(l.hsn || '7610', 280, curY + 6);
        docPdf.fontSize(8).fillColor('#0f172a');
        docPdf.text(String(l.qty || 1), 330, curY + 6, { width: 45, align: 'right' });
        docPdf.text(l.unit || 'nos', 385, curY + 6);

        if (withValue) {
          docPdf.text(Number(l.rate || 0).toLocaleString('en-IN'), 425, curY + 6, { width: 45, align: 'right' });
          docPdf.text(Number(l.total || l.taxable || 0).toLocaleString('en-IN'), 480, curY + 6, { width: 70, align: 'right' });
        } else {
          docPdf.fontSize(7.5).fillColor('#94a3b8');
          docPdf.text('[   ] Verified OK', 440, curY + 6, { width: 110, align: 'center' });
        }

        curY += rowH;
      });

      // Totals Box (only if withValue)
      if (withValue) {
        const t = doc.totals || {};
        docPdf.rect(36, curY, 523, 24).fillColor('#f8fafc').fill();
        docPdf.rect(36, curY, 523, 24).strokeColor('#cbd5e1').stroke();
        docPdf.fontSize(9).fillColor('#0f172a');
        docPdf.text('TOTAL CONSIGNMENT VALUE (incl. GST):', 240, curY + 7);
        docPdf.fontSize(10).fillColor('#1e3a8a');
        docPdf.text(`₹ ${Number(t.grandTotal || 0).toLocaleString('en-IN')}`, 460, curY + 7, { width: 90, align: 'right' });
        curY += 28;
      } else {
        const totalItemsCount = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
        docPdf.rect(36, curY, 523, 20).fillColor('#f8fafc').fill();
        docPdf.rect(36, curY, 523, 20).strokeColor('#cbd5e1').stroke();
        docPdf.fontSize(8.5).fillColor('#0f172a');
        docPdf.text(`Total Items Dispatched: ${lines.length} Line Items | Total Qty: ${totalItemsCount}`, 44, curY + 6);
        curY += 24;
      }

      // Terms & Signatures
      curY = Math.max(curY + 20, 680);

      docPdf.rect(36, curY, 523, 70).strokeColor('#cbd5e1').stroke();
      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text('Receiver / Site In-charge Sign:', 44, curY + 8);
      docPdf.fontSize(7).fillColor('#64748b');
      docPdf.text('Materials received in sound physical condition.', 44, curY + 54);

      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text('Transporter / Driver Sign:', 220, curY + 8);
      docPdf.fontSize(7).fillColor('#64748b');
      docPdf.text('Vehicle / LR checked.', 220, curY + 54);

      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text(`For ${settings.company || 'Authorised Sender'}:`, 390, curY + 8);
      docPdf.fontSize(7).fillColor('#64748b');
      docPdf.text('Authorised Signatory', 390, curY + 54);

      // Audit Stamp footer
      docPdf.fontSize(6.5).fillColor('#94a3b8');
      docPdf.text(
        `Generated via MR_Quoter Universal Engine | Audit Ref: ${doc.id} | Mode: ${withValue ? 'WITH_VALUE' : 'WITHOUT_VALUE'} | Printed: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        36,
        780,
        { align: 'center', width: 523 }
      );

      docPdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  CHALLAN_PURPOSES,
  getPendingDeliveryQuantities,
  generateDeliveryChallanPdf,
  logChallanAccess
};
