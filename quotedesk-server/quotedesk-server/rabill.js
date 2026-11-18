'use strict';
/**
 * rabill.js — Contractor Running Account (RA) Bill Engine
 *
 * Core Contractor Progress Billing:
 *   - 3-Column Work Done Format:
 *       1. Up To Previous Bill (Qty & Value)
 *       2. Since Previous Bill / This Bill (Qty & Value)
 *       3. Cumulative Up To Date (Qty & Value)
 *   - Contractor Deductions & Adjustments:
 *       - Mobilisation Advance Recovery (% of gross this bill)
 *       - Security Deposit / Retention Money (% held till DLP)
 *       - TDS u/s 194C (Contractor: 1% ind/HUF, 2% company) or 194J (10%)
 *       - Labour Welfare Cess (1% BOCW Act)
 *       - Other Deductions / Penalties / Material Recovery
 *   - Net Payable Amount Calculation:
 *       Net Payable = (Gross Value of Work Done This Bill)
 *                   - Mobilisation Advance Adjustment
 *                   - Retention Money
 *                   - TDS (Tax Deducted at Source)
 *                   - Labour Welfare Cess
 *                   - Other Deductions
 *                   + GST as applicable
 *   - Retention Tracker:
 *       Tracks accumulated retention, release due dates, and release records
 */

/**
 * Calculate line item values across Previous, This Bill, and Cumulative
 */
function calculateRaBillLine(line, prevQty = 0, currentQty = 0) {
  const rate = Number(line.rate) || 0;
  const pQty = Number(prevQty) || 0;
  const cQty = Number(currentQty) || 0;
  const totalQty = +(pQty + cQty).toFixed(3);

  const prevAmount = Math.round(pQty * rate);
  const thisAmount = Math.round(cQty * rate);
  const cumulativeAmount = Math.round(totalQty * rate);

  return {
    itemId: line.id || line.name,
    description: line.name || line.desc,
    uom: line.unit || 'sqft',
    rate,
    previous: { qty: pQty, amount: prevAmount },
    thisBill: { qty: cQty, amount: thisAmount },
    cumulative: { qty: totalQty, amount: cumulativeAmount }
  };
}

/**
 * Calculate full RA Bill summary with statutory deductions
 */
function calculateRaBillSummary({
  lines = [],
  advanceRecoveryPct = 10,
  retentionPct = 5,
  tdsSection = '194C_CO', // '194C_IND' (1%), '194C_CO' (2%), '194J' (10%), 'none'
  labourCessPct = 1,
  otherDeductions = 0,
  gstRate = 18,
  isInterState = false
}) {
  let prevGross = 0;
  let thisGross = 0;
  let cumulativeGross = 0;

  const calculatedLines = lines.map(l => {
    const res = calculateRaBillLine(l, l.prevQty, l.currentQty);
    prevGross += res.previous.amount;
    thisGross += res.thisBill.amount;
    cumulativeGross += res.cumulative.amount;
    return res;
  });

  // 1. Advance Recovery
  const advanceAdjustment = Math.round(thisGross * (Number(advanceRecoveryPct) || 0) / 100);

  // 2. Retention Money (Security Deposit)
  const retentionAmount = Math.round(thisGross * (Number(retentionPct) || 0) / 100);

  // 3. TDS Calculation
  let tdsPct = 0;
  if (tdsSection === '194C_IND') tdsPct = 1;
  else if (tdsSection === '194C_CO') tdsPct = 2;
  else if (tdsSection === '194J') tdsPct = 10;
  const tdsAmount = Math.round(thisGross * tdsPct / 100);

  // 4. Labour Welfare Cess (1% BOCW Act)
  const labourCess = Math.round(thisGross * (Number(labourCessPct) || 0) / 100);

  // Total Deductions
  const otherDeds = Number(otherDeductions) || 0;
  const totalDeductions = advanceAdjustment + retentionAmount + tdsAmount + labourCess + otherDeds;

  // Taxable Work Amount
  const taxableWork = Math.max(0, thisGross);
  const gstAmount = Math.round(taxableWork * (Number(gstRate) || 0) / 100);

  const cgst = isInterState ? 0 : Math.round(gstAmount / 2);
  const sgst = isInterState ? 0 : Math.round(gstAmount / 2);
  const igst = isInterState ? gstAmount : 0;

  // Net Payable to Contractor
  const netPayable = Math.max(0, thisGross + gstAmount - totalDeductions);

  return {
    lines: calculatedLines,
    gross: {
      previousBillAmount: prevGross,
      thisBillAmount: thisGross,
      cumulativeAmount: cumulativeGross
    },
    deductions: {
      advanceRecoveryPct: Number(advanceRecoveryPct) || 0,
      advanceAdjustment,
      retentionPct: Number(retentionPct) || 0,
      retentionAmount,
      tdsSection,
      tdsPct,
      tdsAmount,
      labourCessPct: Number(labourCessPct) || 0,
      labourCess,
      otherDeductions: otherDeds,
      totalDeductions
    },
    taxes: {
      gstRate: Number(gstRate) || 0,
      isInterState,
      cgst,
      sgst,
      igst,
      totalTax: gstAmount
    },
    netPayable
  };
}

module.exports = {
  calculateRaBillLine,
  calculateRaBillSummary
};
