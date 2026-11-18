'use strict';
/**
 * measurement.js — Site Measurement Sheet (M-Sheet) & Variation Statement Engine
 *
 * Core Contractor Workflow:
 *   Quotation -> Customer PO -> Proforma -> Measurement Sheet (Actuals) -> Tax Invoice / RA Bill
 *
 * Capabilities:
 *   - L x B x H formula calculation with deductions for openings
 *   - Abstract of quantities per line item
 *   - Sign-offs: Prepared by / Checked by / Client representative
 *   - Variation Statement: Quoted vs PO vs Previously Billed vs Actual Measured (Qty, %, ₹)
 *   - Hard Control: blocks billing excess without an approved Variation Order / Quotation Revision (R+1)
 *   - Measurement Annexure PDF generator for attachment to Quotation / Invoice
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Calculate quantity for a single measurement entry
 */
function calculateMeasurementRowQty(row) {
  const nos = Number(row.nos) || 1;
  const l = Number(row.length) || 0;
  const b = Number(row.breadth) || (row.height ? 1 : 0);
  const h = Number(row.height) || 1;
  const deduction = Number(row.deduction) || 0;

  let raw = 0;
  if (l > 0 && b > 0) {
    // 2D Area or 3D Volume
    raw = (nos * l * b * (row.height ? h : 1));
  } else if (l > 0) {
    // Running length (rft / rm)
    raw = nos * l;
  } else {
    // Count (nos)
    raw = nos;
  }

  const finalQty = Math.max(0, raw - deduction);
  return {
    rawQty: +raw.toFixed(3),
    finalQty: +finalQty.toFixed(3)
  };
}

/**
 * Compile Abstract of Quantities from detailed measurement rows
 */
function compileMeasurementAbstract(rows = []) {
  const abstractMap = new Map();

  rows.forEach(r => {
    const key = r.itemId || (r.itemDesc || 'Item') + '::' + (r.uom || 'sqft');
    const computed = calculateMeasurementRowQty(r);

    if (!abstractMap.has(key)) {
      abstractMap.set(key, {
        itemId: r.itemId || '',
        itemDesc: r.itemDesc || 'General Work',
        uom: r.uom || 'sqft',
        totalQty: 0,
        rowCount: 0,
        subItems: []
      });
    }

    const item = abstractMap.get(key);
    item.totalQty = +(item.totalQty + computed.finalQty).toFixed(3);
    item.rowCount += 1;
    item.subItems.push({
      location: r.location || 'Site',
      nos: r.nos || 1,
      l: r.length || 0,
      b: r.breadth || 0,
      h: r.height || 0,
      deduction: r.deduction || 0,
      qty: computed.finalQty,
      remarks: r.remarks || ''
    });
  });

  return Array.from(abstractMap.values());
}

/**
 * Generate Line-by-Line Variation Statement
 * Compares: Quoted Qty | Approved PO Qty | Previously Billed | Actual Measured | Variance
 */
function generateVariationStatement(quotedLines = [], measuredAbstract = [], previouslyBilledMap = {}, rateMap = {}) {
  const statement = [];

  // Match by itemId or itemDesc
  const measuredMap = new Map(measuredAbstract.map(m => [m.itemId || m.itemDesc, m]));

  quotedLines.forEach((ql, idx) => {
    const key = ql.id || ql.name;
    const measured = measuredMap.get(key) || measuredMap.get(ql.name) || { totalQty: 0 };
    const quotedQty = Number(ql.qty) || 0;
    const poQty = Number(ql.poQty != null ? ql.poQty : quotedQty);
    const prevBilled = Number(previouslyBilledMap[key] || 0);
    const measuredQty = Number(measured.totalQty) || 0;
    const rate = Number(rateMap[key] || ql.rate || 0);

    const varianceQty = +(measuredQty - poQty).toFixed(3);
    const variancePct = poQty > 0 ? +((varianceQty / poQty) * 100).toFixed(2) : 0;
    const varianceAmount = Math.round(varianceQty * rate);

    statement.push({
      itemIndex: idx + 1,
      itemId: key,
      description: ql.name || ql.desc,
      uom: ql.unit || 'sqft',
      rate,
      quotedQty,
      poQty,
      previouslyBilledQty: prevBilled,
      actualMeasuredQty: measuredQty,
      varianceQty,
      variancePct,
      varianceAmount,
      isExcess: varianceQty > 0,
      isShort: varianceQty < 0,
      needsVariationOrder: varianceQty > 0
    });
  });

  return statement;
}

/**
 * Hard Control Check: Enforces that billed quantity does not exceed approved quantity
 * Returns { allowed: boolean, reason?: string, excessQty?: number }
 */
function validateBilledQuantityAgainstApproved(itemDesc, currentBillQty, previouslyBilledQty, approvedQty, tolerancePct = 0) {
  const totalAttempted = Number(previouslyBilledQty || 0) + Number(currentBillQty || 0);
  const maxAllowed = Number(approvedQty || 0) * (1 + (Number(tolerancePct) || 0) / 100);

  if (totalAttempted > maxAllowed) {
    const excess = +(totalAttempted - Number(approvedQty || 0)).toFixed(3);
    return {
      allowed: false,
      excessQty: excess,
      reason: `Billing blocked for "${itemDesc}": Attempted cumulative quantity (${totalAttempted}) exceeds approved quantity (${approvedQty}) by ${excess}. An approved Variation Order or Quotation Revision (R+1) is required before billing excess work.`
    };
  }

  return { allowed: true };
}

/**
 * Generate Printable Measurement Sheet Annexure PDF
 */
function generateMeasurementSheetPdf(mSheet, docMeta = {}, settings = {}) {
  return new Promise((resolve, reject) => {
    try {
      const docPdf = new PDFDocument({
        size: 'A4',
        margin: 36,
        info: {
          Title: `Measurement Sheet ${mSheet.sheetNo || docMeta.no}`,
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

      // Title
      docPdf.fontSize(14).fillColor('#1e3a8a').text(settings.company || 'CONTRACTOR SITE MEASUREMENT', { align: 'center' });
      docPdf.fontSize(11).fillColor('#0f172a').text('SITE MEASUREMENT & QUANTITY ANNEXURE SHEET', { align: 'center', underline: true });
      docPdf.fontSize(8).fillColor('#64748b').text(`Annexure to Document Ref: ${docMeta.no || mSheet.docNo || '-'} | Date: ${mSheet.date || new Date().toISOString().slice(0, 10)}`, { align: 'center' });
      docPdf.moveDown(0.5);

      // Meta Box
      const yMeta = docPdf.y;
      docPdf.rect(36, yMeta, 523, 44).strokeColor('#cbd5e1').stroke();
      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text(`Client / Project:`, 44, yMeta + 6);
      docPdf.text(docMeta.customerName || (docMeta.cust && docMeta.cust.name) || 'Client', 120, yMeta + 6);

      docPdf.text(`Site Location:`, 44, yMeta + 18);
      docPdf.text(docMeta.site || docMeta.project || 'Site', 120, yMeta + 18);

      docPdf.text(`Sheet Status:`, 340, yMeta + 6);
      docPdf.fillColor('#0284c7').text((mSheet.status || 'Verified').toUpperCase(), 410, yMeta + 6);

      docPdf.fillColor('#0f172a');
      docPdf.text(`Checked By:`, 340, yMeta + 18);
      docPdf.text(mSheet.checkedBy || 'Site Engineer', 410, yMeta + 18);

      // Table Header
      let curY = yMeta + 52;
      docPdf.rect(36, curY, 523, 20).fillColor('#f1f5f9').fill();
      docPdf.rect(36, curY, 523, 20).strokeColor('#cbd5e1').stroke();

      docPdf.fontSize(7.5).fillColor('#1e293b');
      docPdf.text('#', 40, curY + 6);
      docPdf.text('Location / Description', 60, curY + 6);
      docPdf.text('Nos', 260, curY + 6, { width: 30, align: 'right' });
      docPdf.text('L', 300, curY + 6, { width: 35, align: 'right' });
      docPdf.text('B', 345, curY + 6, { width: 35, align: 'right' });
      docPdf.text('H', 390, curY + 6, { width: 35, align: 'right' });
      docPdf.text('Ded.', 435, curY + 6, { width: 35, align: 'right' });
      docPdf.text('Total Qty', 475, curY + 6, { width: 45, align: 'right' });
      docPdf.text('UOM', 525, curY + 6);

      curY += 20;

      const rows = mSheet.rows || [];
      let totalQtySum = 0;

      rows.forEach((r, idx) => {
        const computed = calculateMeasurementRowQty(r);
        totalQtySum += computed.finalQty;

        docPdf.rect(36, curY, 523, 18).strokeColor('#e2e8f0').stroke();
        docPdf.fontSize(7.5).fillColor('#475569').text(String(idx + 1), 40, curY + 5);
        docPdf.fillColor('#0f172a').text(r.itemDesc || r.location || 'Item', 60, curY + 5, { width: 195, ellipsis: true });
        docPdf.text(String(r.nos || 1), 260, curY + 5, { width: 30, align: 'right' });
        docPdf.text(String(r.length || '-'), 300, curY + 5, { width: 35, align: 'right' });
        docPdf.text(String(r.breadth || '-'), 345, curY + 5, { width: 35, align: 'right' });
        docPdf.text(String(r.height || '-'), 390, curY + 5, { width: 35, align: 'right' });
        docPdf.fillColor(r.deduction ? '#dc2626' : '#64748b').text(String(r.deduction || '-'), 435, curY + 5, { width: 35, align: 'right' });
        docPdf.fillColor('#0f172a').text(Number(computed.finalQty).toFixed(2), 475, curY + 5, { width: 45, align: 'right' });
        docPdf.text(r.uom || 'sqft', 525, curY + 5);

        curY += 18;
      });

      // Total Row
      docPdf.rect(36, curY, 523, 20).fillColor('#f8fafc').fill();
      docPdf.rect(36, curY, 523, 20).strokeColor('#cbd5e1').stroke();
      docPdf.fontSize(8.5).fillColor('#0f172a').text('TOTAL ABSTRACT QUANTITY:', 300, curY + 6);
      docPdf.fontSize(9).fillColor('#1e3a8a').text(Number(totalQtySum).toFixed(2), 475, curY + 6, { width: 45, align: 'right' });

      // Sign-off Block
      curY = Math.max(curY + 30, 690);
      docPdf.rect(36, curY, 523, 60).strokeColor('#cbd5e1').stroke();

      docPdf.fontSize(8).fillColor('#0f172a');
      docPdf.text('Prepared by (Site Engineer):', 44, curY + 8);
      docPdf.text(mSheet.preparedBy || 'Site Eng.', 44, curY + 44);

      docPdf.text('Checked by (Project Manager):', 220, curY + 8);
      docPdf.text(mSheet.checkedBy || 'Project Mgr.', 220, curY + 44);

      docPdf.text('Client Representative (Approved):', 390, curY + 8);
      docPdf.text(mSheet.clientRep || 'Client Rep Sign', 390, curY + 44);

      docPdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  calculateMeasurementRowQty,
  compileMeasurementAbstract,
  generateVariationStatement,
  validateBilledQuantityAgainstApproved,
  generateMeasurementSheetPdf
};
