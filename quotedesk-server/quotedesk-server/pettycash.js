'use strict';
/**
 * pettycash.js — Site Petty Cash Imprest Register & Reconciliation Engine
 *
 * Capabilities:
 *   - Imprest limit management per site (e.g. ₹20,000)
 *   - Expense heads: Site Refreshments, Local Conveyance, Minor Hardware, Courier, Labour Daily Wages
 *   - Dynamic balance verification (blocks expenses exceeding available imprest balance)
 *   - Automatic double-entry posting to General Ledger
 *   - Physical Cash Count Reconciliation: calculates Shortage/Excess and posts audit entry
 *   - Bank Replenishment (Contra voucher: Bank -> Cash)
 */

const { getCollection } = require('./db.js');
const { createVoucher } = require('./vouchers.js');

const PETTY_EXPENSE_HEADS = [
  { id: 'exp_tea', name: 'Site Tea & Refreshments', code: 'TEA' },
  { id: 'exp_travel', name: 'Local Travel & Auto Conveyance', code: 'TRV' },
  { id: 'exp_hardware', name: 'Site Minor Hardware & Fasteners', code: 'HDW' },
  { id: 'exp_courier', name: 'Postage & Courier Charges', code: 'COR' },
  { id: 'exp_unloading', name: 'Material Unloading / Coolie Charges', code: 'UNL' },
  { id: 'exp_general', name: 'General Site Maintenance', code: 'GEN' }
];

async function getPettyCashBalance(companyId, site = 'Main Site') {
  const col = await getCollection('petty_cash');
  const entries = await col.find({ companyId, site }).toArray();

  let balance = 0;
  entries.forEach(e => {
    if (e.type === 'topup') balance += Number(e.amount);
    else if (e.type === 'expense') balance -= Number(e.amount);
    else if (e.type === 'reconcile') balance = Number(e.newBalance);
  });

  return Math.round(balance * 100) / 100;
}

async function recordPettyCashTopup(companyId, data, user = {}) {
  const {
    site = 'Main Site',
    amount = 0,
    fromLedgerId = 'led_bank_default',
    date = new Date().toISOString().slice(0, 10),
    notes = ''
  } = data;

  const numAmt = Math.round(Number(amount) * 100) / 100;
  if (numAmt <= 0) throw new Error('Top-up amount must be greater than zero');

  // Contra voucher: Dr Cash in Hand, Cr Bank
  const vch = await createVoucher({
    companyId,
    voucherType: 'contra',
    date,
    narration: `Petty Cash Imprest Replenishment for ${site}: ${notes}`,
    docRef: 'PETTY-TOPUP',
    entries: [
      { ledgerId: 'led_cash', ledgerName: 'Cash in Hand (Petty Cash)', debit: numAmt, credit: 0 },
      { ledgerId: fromLedgerId, ledgerName: 'Bank Account', debit: 0, credit: numAmt }
    ]
  }, user);

  const entry = {
    id: 'pc_' + Math.random().toString(36).slice(2, 10),
    companyId,
    site,
    type: 'topup',
    amount: numAmt,
    date,
    notes,
    voucherId: vch.id,
    voucherNo: vch.voucherNo,
    createdAt: Date.now(),
    createdBy: user.name || 'User'
  };

  const col = await getCollection('petty_cash');
  await col.insertOne(entry);

  return { entry, voucher: vch, newBalance: await getPettyCashBalance(companyId, site) };
}

async function recordPettyCashExpense(companyId, data, user = {}) {
  const {
    site = 'Main Site',
    projectId = null,
    projectName = '',
    expenseHeadId = 'exp_tea',
    expenseHeadName = 'Site Tea & Refreshments',
    amount = 0,
    paidTo = '',
    billNo = '',
    date = new Date().toISOString().slice(0, 10),
    notes = ''
  } = data;

  const numAmt = Math.round(Number(amount) * 100) / 100;
  if (numAmt <= 0) throw new Error('Expense amount must be greater than zero');

  const currentBal = await getPettyCashBalance(companyId, site);
  if (numAmt > currentBal) {
    throw new Error(`Insufficient petty cash balance! Available: ₹${currentBal.toFixed(2)}, Requested: ₹${numAmt.toFixed(2)}. Please replenish the imprest fund first.`);
  }

  // Payment voucher: Dr Expense Ledger, Cr Cash
  const vch = await createVoucher({
    companyId,
    voucherType: 'payment',
    date,
    narration: `Petty Cash [${site}]: ${expenseHeadName} paid to ${paidTo || 'Vendor'}. ${notes}`,
    partyName: paidTo,
    docRef: billNo || 'PETTY-VCH',
    entries: [
      { ledgerId: 'led_contractor_charges', ledgerName: expenseHeadName, debit: numAmt, credit: 0 },
      { ledgerId: 'led_cash', ledgerName: 'Cash in Hand (Petty Cash)', debit: 0, credit: numAmt }
    ]
  }, user);

  const entry = {
    id: 'pc_' + Math.random().toString(36).slice(2, 10),
    companyId,
    site,
    projectId,
    projectName,
    type: 'expense',
    expenseHeadId,
    expenseHeadName,
    amount: numAmt,
    paidTo,
    billNo,
    date,
    notes,
    voucherId: vch.id,
    voucherNo: vch.voucherNo,
    createdAt: Date.now(),
    createdBy: user.name || 'User'
  };

  const col = await getCollection('petty_cash');
  await col.insertOne(entry);

  return { entry, voucher: vch, remainingBalance: await getPettyCashBalance(companyId, site) };
}

async function reconcilePhysicalCash(companyId, site, physicalCount, user = {}) {
  const actualCount = Math.round(Number(physicalCount) * 100) / 100;
  const bookBalance = await getPettyCashBalance(companyId, site);
  const diff = Math.round((actualCount - bookBalance) * 100) / 100;

  const entry = {
    id: 'pc_' + Math.random().toString(36).slice(2, 10),
    companyId,
    site,
    type: 'reconcile',
    bookBalance,
    physicalCount: actualCount,
    discrepancy: diff, // >0 surplus, <0 shortage
    status: diff === 0 ? 'tallied' : (diff > 0 ? 'surplus' : 'shortage'),
    newBalance: actualCount,
    date: new Date().toISOString().slice(0, 10),
    createdAt: Date.now(),
    createdBy: user.name || 'Auditor'
  };

  const col = await getCollection('petty_cash');
  await col.insertOne(entry);

  return entry;
}

module.exports = {
  PETTY_EXPENSE_HEADS,
  getPettyCashBalance,
  recordPettyCashTopup,
  recordPettyCashExpense,
  reconcilePhysicalCash
};

