'use strict';
/**
 * vouchers.js — Double-Entry Voucher Engine & Atomic Ledger Posting
 *
 * Enforces fundamental accounting rule:
 *   Total Debits === Total Credits on EVERY voucher.
 *
 * Voucher Types:
 *   - sales: Tax Invoice posting (Dr Debtor, Cr Sales, Cr Output GST)
 *   - purchase: Vendor Bill (Dr Purchase, Dr Input GST, Cr Creditor)
 *   - receipt: Bank/Cash In (Dr Bank/Cash, Cr Debtor / Income)
 *   - payment: Bank/Cash Out (Dr Creditor / Expense, Cr Bank/Cash)
 *   - journal: General adjustment (Dr Any, Cr Any)
 *   - contra: Cash <-> Bank transfer
 *   - debit_note: Debit Note (Dr Creditor, Cr Purchase / GST)
 *   - credit_note: Credit Note (Dr Sales / GST, Cr Debtor)
 */

const { getCollection } = require('./db.js');
const { getCompanyLedgers } = require('./accounts.js');

const VOUCHER_TYPES = {
  sales: { name: 'Sales Invoice', prefix: 'SLS' },
  purchase: { name: 'Purchase Bill', prefix: 'PUR' },
  receipt: { name: 'Receipt Voucher', prefix: 'RCP' },
  payment: { name: 'Payment Voucher', prefix: 'PMT' },
  journal: { name: 'Journal Voucher', prefix: 'JRN' },
  contra: { name: 'Contra Voucher', prefix: 'CTR' },
  debit_note: { name: 'Debit Note', prefix: 'DBN' },
  credit_note: { name: 'Credit Note', prefix: 'CRN' }
};

function round(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Validate that total debits equals total credits
 */
function validateDoubleEntry(entries = []) {
  if (!entries || entries.length < 2) {
    throw new Error('A double-entry voucher must contain at least two ledger line entries.');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  entries.forEach((e, i) => {
    const dr = round(e.debit || 0);
    const cr = round(e.credit || 0);
    if (dr < 0 || cr < 0) {
      throw new Error(`Line ${i + 1}: Negative amounts are not allowed in double-entry bookkeeping.`);
    }
    if (dr > 0 && cr > 0) {
      throw new Error(`Line ${i + 1}: An entry cannot have both debit and credit amounts.`);
    }
    if (dr === 0 && cr === 0) {
      throw new Error(`Line ${i + 1}: Entry must have either a debit or credit amount.`);
    }
    totalDebit += dr;
    totalCredit += cr;
  });

  totalDebit = round(totalDebit);
  totalCredit = round(totalCredit);

  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    throw new Error(
      `Double-entry imbalance: Total Debits (₹${totalDebit.toFixed(2)}) does not match Total Credits (₹${totalCredit.toFixed(2)}). Difference: ₹${diff.toFixed(2)}`
    );
  }

  return { totalDebit, totalCredit };
}

/**
 * Create and post a balanced voucher
 */
async function createVoucher(data, user = {}) {
  const {
    companyId = 'default',
    voucherType = 'journal',
    date = new Date().toISOString().slice(0, 10),
    narration = '',
    partyId = null,
    partyName = '',
    docRef = '',
    entries = []
  } = data;

  if (!VOUCHER_TYPES[voucherType]) {
    throw new Error(`Invalid voucher type: ${voucherType}`);
  }

  const { totalDebit } = validateDoubleEntry(entries);

  // Allocate sequential voucher number
  const vchCol = await getCollection('vouchers');
  const count = (await vchCol.find({ companyId, voucherType })).length + 1;
  const seqStr = String(count).padStart(4, '0');
  const fyYear = new Date(date).getFullYear().toString().slice(-2);
  const nextFy = (parseInt(fyYear, 10) + 1).toString().padStart(2, '0');
  const voucherNo = `${VOUCHER_TYPES[voucherType].prefix}/${fyYear}-${nextFy}/${seqStr}`;

  const voucherId = 'vch_' + Math.random().toString(36).slice(2, 11);

  const sanitizedEntries = entries.map((e, idx) => ({
    entryId: `${voucherId}_${idx + 1}`,
    ledgerId: e.ledgerId,
    ledgerName: e.ledgerName || 'Ledger',
    debit: round(e.debit || 0),
    credit: round(e.credit || 0),
    narration: e.narration || narration
  }));

  const voucher = {
    id: voucherId,
    voucherNo,
    voucherType,
    date,
    companyId,
    narration,
    partyId,
    partyName,
    docRef,
    entries: sanitizedEntries,
    totalAmount: totalDebit,
    status: 'posted',
    cancelled: false,
    createdAt: Date.now(),
    createdBy: user.name || 'System'
  };

  await vchCol.insertOne(voucher);

  // Post individual ledger postings to ledger_entries collection
  const ledgerCol = await getCollection('ledger_entries');
  for (const entry of sanitizedEntries) {
    await ledgerCol.insertOne({
      id: entry.entryId,
      voucherId: voucher.id,
      voucherNo: voucher.voucherNo,
      voucherType: voucher.voucherType,
      date: voucher.date,
      companyId: voucher.companyId,
      ledgerId: entry.ledgerId,
      ledgerName: entry.ledgerName,
      debit: entry.debit,
      credit: entry.credit,
      narration: entry.narration,
      partyId,
      partyName,
      docRef,
      cancelled: false,
      createdAt: voucher.createdAt
    });
  }

  return voucher;
}

/**
 * Cancel a voucher (Statutory control: no hard delete)
 */
async function cancelVoucher(voucherId, reason, user = {}) {
  if (!reason || !reason.trim()) {
    throw new Error('A cancellation reason is strictly required by statutory audit regulations.');
  }

  const vchCol = await getCollection('vouchers');
  const voucher = await vchCol.findOne({ id: voucherId });
  if (!voucher) throw new Error('Voucher not found');
  if (voucher.cancelled) throw new Error('Voucher is already cancelled');

  voucher.cancelled = true;
  voucher.status = 'cancelled';
  voucher.cancelledReason = reason.trim();
  voucher.cancelledAt = Date.now();
  voucher.cancelledBy = user.name || 'User';

  await vchCol.replaceOne({ id: voucherId }, voucher);

  // Mark all corresponding ledger entries as cancelled
  const ledgerCol = await getCollection('ledger_entries');
  const entries = await ledgerCol.find({ voucherId });
  for (const ent of entries) {
    ent.cancelled = true;
    await ledgerCol.replaceOne({ id: ent.id }, ent);
  }

  return voucher;
}

/**
 * Auto-Post Sales Voucher from a Tax Invoice (or RA Bill)
 */
async function postSalesInvoiceVoucher(invDoc, user = {}) {
  const totals = invDoc.totals || {};
  const grandTotal = round(totals.grandTotal || 0);
  const taxable = round(totals.subTotal || 0);
  const cgst = round(totals.cgst || 0);
  const sgst = round(totals.sgst || 0);
  const igst = round(totals.igst || 0);
  const roundOff = round(totals.roundOff || 0);

  const customerName = (invDoc.cust && invDoc.cust.name) || 'Client Customer';
  const customerLedgerId = invDoc.cust && invDoc.cust.id ? `led_cust_${invDoc.cust.id}` : 'led_debtors_general';

  const entries = [];

  // 1. Dr Debtor (Customer) for full invoice value
  entries.push({
    ledgerId: customerLedgerId,
    ledgerName: customerName,
    debit: grandTotal,
    credit: 0
  });

  // 2. Cr Sales Account for taxable work done
  entries.push({
    ledgerId: 'led_sales_services',
    ledgerName: 'Works Contract / Fabrication Services',
    debit: 0,
    credit: taxable
  });

  // 3. Cr GST Output Tax
  if (cgst > 0) {
    entries.push({
      ledgerId: 'led_cgst_out',
      ledgerName: 'Output CGST',
      debit: 0,
      credit: cgst
    });
  }
  if (sgst > 0) {
    entries.push({
      ledgerId: 'led_sgst_out',
      ledgerName: 'Output SGST',
      debit: 0,
      credit: sgst
    });
  }
  if (igst > 0) {
    entries.push({
      ledgerId: 'led_igst_out',
      ledgerName: 'Output IGST',
      debit: 0,
      credit: igst
    });
  }

  // 4. Round-off adjustment if any
  if (roundOff !== 0) {
    if (roundOff > 0) {
      entries.push({
        ledgerId: 'led_round_off',
        ledgerName: 'Round Off Adjustment',
        debit: 0,
        credit: roundOff
      });
    } else {
      entries.push({
        ledgerId: 'led_round_off',
        ledgerName: 'Round Off Adjustment',
        debit: Math.abs(roundOff),
        credit: 0
      });
    }
  }

  return await createVoucher({
    companyId: invDoc.companyId,
    voucherType: 'sales',
    date: invDoc.date,
    narration: `Tax Invoice ${invDoc.no} issued to ${customerName} for ${invDoc.project || 'Project'}`,
    partyId: invDoc.cust && invDoc.cust.id,
    partyName: customerName,
    docRef: invDoc.no,
    entries
  }, user);
}

module.exports = {
  VOUCHER_TYPES,
  validateDoubleEntry,
  createVoucher,
  cancelVoucher,
  postSalesInvoiceVoucher
};

