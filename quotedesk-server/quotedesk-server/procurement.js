'use strict';
/**
 * procurement.js — Procurement Chain & 3-Way Match Engine
 *
 * Workflow:
 *   Materials Requisition List (MRL) -> Vendor PO (VPO) -> Goods Received Note (GRN) -> Vendor Bill
 *
 * 3-Way Match Verification:
 *   Validates:
 *     1. Purchase Order (Agreed Scope & Rate)
 *     2. Goods Received Note / GRN (Physical Site Delivery Verification)
 *     3. Vendor Tax Invoice (Billed Quantity & Billed Rate)
 *
 *   Enforces hard control:
 *     - Billed quantity cannot exceed physically accepted GRN quantity.
 *     - Billed rate cannot exceed approved Vendor PO rate without variance authorization.
 */

const { getCollection } = require('./db.js');

/**
 * Perform 3-Way Match Audit between Vendor PO, GRN, and Vendor Invoice
 */
function performThreeWayMatch(poLines = [], grnLines = [], invoiceLines = [], options = {}) {
  const { rateTolerancePct = 0, qtyTolerancePct = 0 } = options;

  const poMap = new Map(poLines.map(l => [l.id || l.name, l]));
  const grnMap = new Map(grnLines.map(l => [l.id || l.name, l]));

  let allMatched = true;
  const lineAudits = [];

  invoiceLines.forEach(invLine => {
    const key = invLine.id || invLine.name;
    const poLine = poMap.get(key) || poMap.get(invLine.name) || { qty: 0, rate: 0 };
    const grnLine = grnMap.get(key) || grnMap.get(invLine.name) || { qty: 0 };

    const invQty = Number(invLine.qty) || 0;
    const invRate = Number(invLine.rate) || 0;
    const poRate = Number(poLine.rate) || 0;
    const grnQty = Number(grnLine.qty) || 0;

    // 1. Qty Match: Invoiced Qty vs GRN Received Qty
    const maxAllowedQty = grnQty * (1 + qtyTolerancePct / 100);
    const qtyMatched = invQty <= maxAllowedQty;
    const qtyDiff = Math.max(0, invQty - grnQty);

    // 2. Rate Match: Invoiced Rate vs Approved PO Rate
    const maxAllowedRate = poRate * (1 + rateTolerancePct / 100);
    const rateMatched = invRate <= maxAllowedRate;
    const rateDiff = Math.max(0, invRate - poRate);

    const isMatch = qtyMatched && rateMatched;
    if (!isMatch) allMatched = false;

    lineAudits.push({
      item: invLine.name || key,
      poRate,
      invRate,
      rateDiff,
      rateMatched,
      poQty: poLine.qty,
      grnReceivedQty: grnQty,
      invBilledQty: invQty,
      qtyDiff,
      qtyMatched,
      isMatch,
      status: isMatch ? 'PASSED' : (qtyMatched ? 'RATE_MISMATCH' : (rateMatched ? 'QTY_MISMATCH' : 'BOTH_MISMATCH'))
    });
  });

  return {
    passed: allMatched,
    lineAudits,
    summary: allMatched
      ? '3-Way Match PASSED: All billed quantities match GRN deliveries and rates match approved PO.'
      : '3-Way Match FAILED: Variance detected between Billed Invoice, GRN Delivery, or Purchase Order. Payment authorization blocked.'
  };
}

module.exports = {
  performThreeWayMatch
};
