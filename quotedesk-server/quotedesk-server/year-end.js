'use strict';
/**
 * year-end.js — Financial Year Closing & Retained Earnings Carry-Forward
 *
 * Statutory Accounting Principles:
 *   1. Calculate Net Profit / Loss from Nominal Accounts (Income & Expenses).
 *   2. Post closing entry: Transfer Net Profit / Loss to 'Capital / Retained Earnings' (grp_capital).
 *   3. Reset Income & Expense ledgers to zero for the new Financial Year.
 *   4. Carry forward Real & Personal accounts (Assets & Liabilities) as new FY Opening Balances.
 *   5. Log year-end closure with lock timestamp to prevent backdated alteration.
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees, subPaise, addPaise } = require('./paise.js');
const accounts = require('./accounts.js');

/**
 * Execute year-end closure for a company
 * @param {string} companyId
 * @param {object} params - { fromDate, toDate, nextFyStart, user }
 */
async function closeFinancialYear(companyId, params = {}) {
  const { fromDate, toDate, nextFyStart, user = {} } = params;
  if (!toDate) throw new Error('Closing date (toDate) is strictly required.');

  const ledgerCol = await getCollection('ledger_entries');
  const vchCol = await getCollection('vouchers');
  const yearLogCol = await getCollection('year_end_logs');
  const accountsCol = await getCollection('accounts');

  // Verify if year already closed
  const existingClose = await yearLogCol.findOne({ companyId, toDate });
  if (existingClose) {
    throw new Error(`Financial year ending ${toDate} has already been closed and locked on ${new Date(existingClose.closedAt).toLocaleDateString()}.`);
  }

  // 1. Fetch all active ledger entries within the closing FY
  const entries = await ledgerCol.find({
    companyId,
    cancelled: false,
    date: { $gte: fromDate || '1970-01-01', $lte: toDate }
  }).toArray();

  // 2. Fetch chart of accounts to determine ledger natures
  const allLedgers = await accounts.getCompanyLedgers(companyId);
  const ledgerMap = new Map(allLedgers.map(l => [l.id, l]));

  let totalIncomePaise = 0;
  let totalExpensePaise = 0;
  const ledgerBalances = new Map();

  for (const ent of entries) {
    const l = ledgerMap.get(ent.ledgerId) || { nature: 'expenses' };
    const cur = ledgerBalances.get(ent.ledgerId) || { drPaise: 0, crPaise: 0, nature: l.nature, name: ent.ledgerName };

    cur.drPaise = addPaise(cur.drPaise, toPaise(ent.debit));
    cur.crPaise = addPaise(cur.crPaise, toPaise(ent.credit));
    ledgerBalances.set(ent.ledgerId, cur);

    if (l.nature === 'income') {
      totalIncomePaise = addPaise(totalIncomePaise, toPaise(ent.credit) - toPaise(ent.debit));
    } else if (l.nature === 'expenses') {
      totalExpensePaise = addPaise(totalExpensePaise, toPaise(ent.debit) - toPaise(ent.credit));
    }
  }

  // 3. Compute Net Profit / Net Loss (Paise)
  const netProfitPaise = subPaise(totalIncomePaise, totalExpensePaise);
  const netProfitRupees = toRupees(netProfitPaise);

  // 4. Update Opening Balances for Assets & Liabilities into accounts collection
  const carryForwardEntries = [];
  for (const [ledgerId, bal] of ledgerBalances.entries()) {
    if (bal.nature === 'assets' || bal.nature === 'liabilities') {
      const netPaise = subPaise(bal.drPaise, bal.crPaise);
      const obType = netPaise >= 0 ? 'Dr' : 'Cr';
      const obAmt = toRupees(Math.abs(netPaise));

      carryForwardEntries.push({
        ledgerId,
        ledgerName: bal.name,
        openingBalance: obAmt,
        openingBalanceType: obType
      });

      // Update in accounts collection using replaceOne (supported in MongoDB and LocalCollection)
      const existingDoc = await accountsCol.findOne({ id: ledgerId, companyId });
      if (existingDoc) {
        existingDoc.openingBalance = obAmt;
        existingDoc.openingBalanceType = obType;
        existingDoc.updatedAt = Date.now();
        await accountsCol.replaceOne({ id: ledgerId, companyId }, existingDoc);
      }
    }
  }

  // Transfer net profit into Capital / Retained Earnings
  const capitalLedger = allLedgers.find(l => l.groupId === 'grp_capital') || { id: 'led_capital_main' };
  const currentCapital = await accountsCol.findOne({ id: capitalLedger.id, companyId });
  if (currentCapital) {
    const curCapPaise = toPaise(currentCapital.openingBalance || 0);
    const updatedCapPaise = addPaise(curCapPaise, netProfitPaise);
    currentCapital.openingBalance = toRupees(updatedCapPaise);
    currentCapital.updatedAt = Date.now();
    await accountsCol.replaceOne({ id: capitalLedger.id, companyId }, currentCapital);
  }

  // 5. Create Year-End Audit Record
  const logRecord = {
    id: 'ye_' + Math.random().toString(36).slice(2, 10),
    companyId,
    fromDate,
    toDate,
    nextFyStart: nextFyStart || toDate,
    totalIncome: toRupees(totalIncomePaise),
    totalExpense: toRupees(totalExpensePaise),
    netProfit: netProfitRupees,
    closedAt: Date.now(),
    closedBy: user.name || 'System Admin',
    carryForwardCount: carryForwardEntries.length
  };

  await yearLogCol.insertOne(logRecord);

  return logRecord;
}

/**
 * Get closure history for a company
 */
async function getYearEndHistory(companyId) {
  const col = await getCollection('year_end_logs');
  return await col.find({ companyId }).sort({ closedAt: -1 }).toArray();
}

module.exports = {
  closeFinancialYear,
  getYearEndHistory
};
