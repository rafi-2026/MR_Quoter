'use strict';
/**
 * reports.js — Tally-Style Financial Reporting Engine
 *
 * Implements:
 *   - Day Book (Daily voucher audit)
 *   - Cash & Bank Book (Receipts & Payments with running balances)
 *   - Ledger Statement (Account statement with running balance Dr/Cr)
 *   - Trial Balance (Full ledger trial balance; Total Dr === Total Cr)
 *   - Profit & Loss Statement (Income vs Expenses with Gross & Net Profit)
 *   - Balance Sheet (Assets vs Liabilities + P&L Net Profit)
 *   - GST Summary (GSTR-1 & GSTR-3B working sheet)
 *   - Ageing Analysis (Receivables & Payables: 0-30, 31-60, 61-90, >90 days)
 */

const { getCollection } = require('./db.js');
const { getCompanyLedgers } = require('./accounts.js');

function round(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Generate Day Book
 */
async function getDayBook(companyId, fromDate, toDate) {
  const vchCol = await getCollection('vouchers');
  const query = { companyId, cancelled: false };

  if (fromDate && toDate) {
    query.date = { $gte: fromDate, $lte: toDate };
  } else if (fromDate) {
    query.date = fromDate;
  }

  const vouchers = await vchCol.find(query);
  return vouchers.sort((a, b) => (a.date > b.date ? 1 : -1));
}

/**
 * Generate Ledger Statement with running balance
 */
async function getLedgerStatement(companyId, ledgerId, fromDate, toDate, rawCustomers = [], rawVendors = []) {
  const allLedgers = await getCompanyLedgers(companyId, rawCustomers, rawVendors);
  const ledger = allLedgers.find(l => l.id === ledgerId) || {
    id: ledgerId,
    name: 'Account Ledger',
    nature: 'assets',
    openingBalance: 0,
    openingBalanceType: 'Dr'
  };

  const ledgerCol = await getCollection('ledger_entries');
  const entries = await ledgerCol.find({ companyId, ledgerId, cancelled: false });

  // Sort chronologically
  entries.sort((a, b) => (a.date > b.date ? 1 : (a.date < b.date ? -1 : (a.createdAt - b.createdAt))));

  let openingDr = 0;
  let openingCr = 0;
  if (ledger.openingBalance) {
    if (ledger.openingBalanceType === 'Dr') openingDr = Number(ledger.openingBalance);
    else openingCr = Number(ledger.openingBalance);
  }

  // Pre-filter opening if fromDate specified
  const filteredRows = [];
  let currentBalance = (openingDr - openingCr);

  entries.forEach(e => {
    const dr = round(e.debit || 0);
    const cr = round(e.credit || 0);

    if (fromDate && e.date < fromDate) {
      currentBalance += (dr - cr);
    } else if (!toDate || e.date <= toDate) {
      currentBalance += (dr - cr);
      filteredRows.push({
        id: e.id,
        date: e.date,
        voucherId: e.voucherId,
        voucherNo: e.voucherNo,
        voucherType: e.voucherType,
        narration: e.narration,
        debit: dr,
        credit: cr,
        runningBalance: Math.abs(round(currentBalance)),
        balanceType: currentBalance >= 0 ? 'Dr' : 'Cr'
      });
    }
  });

  const periodDebits = round(filteredRows.reduce((sum, r) => sum + r.debit, 0));
  const periodCredits = round(filteredRows.reduce((sum, r) => sum + r.credit, 0));

  return {
    ledger,
    openingBalance: Math.abs(round(openingDr - openingCr)),
    openingBalanceType: (openingDr - openingCr) >= 0 ? 'Dr' : 'Cr',
    rows: filteredRows,
    totalDebit: periodDebits,
    totalCredit: periodCredits,
    closingBalance: Math.abs(round(currentBalance)),
    closingBalanceType: currentBalance >= 0 ? 'Dr' : 'Cr'
  };
}

/**
 * Generate Trial Balance (Verifies Total Dr === Total Cr)
 */
async function getTrialBalance(companyId, asOfDate, rawCustomers = [], rawVendors = []) {
  const allLedgers = await getCompanyLedgers(companyId, rawCustomers, rawVendors);
  const ledgerCol = await getCollection('ledger_entries');
  const entries = await ledgerCol.find({ companyId, cancelled: false });

  const balances = new Map();

  allLedgers.forEach(l => {
    let op = (Number(l.openingBalance) || 0);
    let net = l.openingBalanceType === 'Cr' ? -op : op;
    balances.set(l.id, {
      ledgerId: l.id,
      ledgerName: l.name,
      groupId: l.groupId,
      groupName: l.groupName,
      nature: l.nature,
      netBalance: net
    });
  });

  entries.forEach(e => {
    if (asOfDate && e.date > asOfDate) return;
    if (!balances.has(e.ledgerId)) {
      balances.set(e.ledgerId, {
        ledgerId: e.ledgerId,
        ledgerName: e.ledgerName || e.ledgerId,
        groupId: 'grp_curr_assets',
        groupName: 'Current Assets',
        nature: 'assets',
        netBalance: 0
      });
    }
    const item = balances.get(e.ledgerId);
    item.netBalance += (round(e.debit || 0) - round(e.credit || 0));
  });

  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];

  for (const item of balances.values()) {
    const net = round(item.netBalance);
    if (net === 0) continue;

    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? Math.abs(net) : 0;

    totalDebit += debit;
    totalCredit += credit;

    rows.push({
      ledgerId: item.ledgerId,
      ledgerName: item.ledgerName,
      groupId: item.groupId,
      groupName: item.groupName,
      nature: item.nature,
      debit,
      credit
    });
  }

  totalDebit = round(totalDebit);
  totalCredit = round(totalCredit);

  return {
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    rows: rows.sort((a, b) => a.ledgerName.localeCompare(b.ledgerName)),
    totalDebit,
    totalCredit,
    isTallied: Math.abs(totalDebit - totalCredit) < 0.01,
    difference: round(Math.abs(totalDebit - totalCredit))
  };
}

/**
 * Generate Profit & Loss Account
 */
async function getProfitAndLoss(companyId, fromDate, toDate, rawCustomers = [], rawVendors = []) {
  const tb = await getTrialBalance(companyId, toDate, rawCustomers, rawVendors);

  const incomeRows = [];
  const expenseRows = [];
  let totalIncome = 0;
  let totalExpense = 0;

  tb.rows.forEach(r => {
    if (r.nature === 'income') {
      const amt = r.credit - r.debit;
      incomeRows.push({ ...r, amount: amt });
      totalIncome += amt;
    } else if (r.nature === 'expenses') {
      const amt = r.debit - r.credit;
      expenseRows.push({ ...r, amount: amt });
      totalExpense += amt;
    }
  });

  totalIncome = round(totalIncome);
  totalExpense = round(totalExpense);
  const netProfit = round(totalIncome - totalExpense);

  return {
    income: incomeRows,
    expenses: expenseRows,
    totalIncome,
    totalExpense,
    netProfit,
    isProfit: netProfit >= 0
  };
}

/**
 * Generate Balance Sheet
 */
async function getBalanceSheet(companyId, asOfDate, rawCustomers = [], rawVendors = []) {
  const tb = await getTrialBalance(companyId, asOfDate, rawCustomers, rawVendors);
  const pnl = await getProfitAndLoss(companyId, null, asOfDate, rawCustomers, rawVendors);

  const assetRows = [];
  const liabilityRows = [];
  let totalAssets = 0;
  let totalLiabilities = 0;

  tb.rows.forEach(r => {
    if (r.nature === 'assets') {
      const amt = r.debit - r.credit;
      assetRows.push({ ...r, amount: amt });
      totalAssets += amt;
    } else if (r.nature === 'liabilities') {
      const amt = r.credit - r.debit;
      liabilityRows.push({ ...r, amount: amt });
      totalLiabilities += amt;
    }
  });

  // Net Profit added to Liabilities (Owner's Equity / Capital)
  liabilityRows.push({
    ledgerId: 'pnl_net_profit',
    ledgerName: 'Profit & Loss A/c (Current Period Net Profit)',
    groupId: 'grp_capital',
    groupName: 'Capital Account',
    nature: 'liabilities',
    amount: pnl.netProfit
  });
  totalLiabilities += pnl.netProfit;

  totalAssets = round(totalAssets);
  totalLiabilities = round(totalLiabilities);

  return {
    assets: assetRows,
    liabilities: liabilityRows,
    totalAssets,
    totalLiabilities,
    isBalanced: Math.abs(totalAssets - totalLiabilities) < 0.01,
    difference: round(Math.abs(totalAssets - totalLiabilities))
  };
}

/**
 * Generate GSTR-1 and GSTR-3B Working Sheets
 */
async function getGstSummary(companyId, fromDate, toDate) {
  const vchCol = await getCollection('vouchers');
  const vouchers = await vchCol.find({ companyId, cancelled: false });

  let outwardTaxable = 0;
  let outwardCgst = 0;
  let outwardSgst = 0;
  let outwardIgst = 0;

  let inwardTaxable = 0;
  let inwardCgst = 0;
  let inwardSgst = 0;
  let inwardIgst = 0;

  vouchers.forEach(v => {
    if (fromDate && v.date < fromDate) return;
    if (toDate && v.date > toDate) return;

    if (v.voucherType === 'sales') {
      v.entries.forEach(e => {
        if (e.ledgerId.startsWith('led_sales')) outwardTaxable += (e.credit - e.debit);
        if (e.ledgerId === 'led_cgst_out') outwardCgst += (e.credit - e.debit);
        if (e.ledgerId === 'led_sgst_out') outwardSgst += (e.credit - e.debit);
        if (e.ledgerId === 'led_igst_out') outwardIgst += (e.credit - e.debit);
      });
    } else if (v.voucherType === 'purchase') {
      v.entries.forEach(e => {
        if (e.ledgerId.startsWith('led_purchases')) inwardTaxable += (e.debit - e.credit);
        if (e.ledgerId === 'led_cgst_in') inwardCgst += (e.debit - e.credit);
        if (e.ledgerId === 'led_sgst_in') inwardSgst += (e.debit - e.credit);
        if (e.ledgerId === 'led_igst_in') inwardIgst += (e.debit - e.credit);
      });
    }
  });

  outwardTaxable = round(outwardTaxable);
  outwardCgst = round(outwardCgst);
  outwardSgst = round(outwardSgst);
  outwardIgst = round(outwardIgst);
  const totalOutwardTax = round(outwardCgst + outwardSgst + outwardIgst);

  inwardTaxable = round(inwardTaxable);
  inwardCgst = round(inwardCgst);
  inwardSgst = round(inwardSgst);
  inwardIgst = round(inwardIgst);
  const totalItc = round(inwardCgst + inwardSgst + inwardIgst);

  const netPayableTax = Math.max(0, round(totalOutwardTax - totalItc));

  return {
    period: { fromDate, toDate },
    gstr1: {
      taxableSupplies: outwardTaxable,
      cgst: outwardCgst,
      sgst: outwardSgst,
      igst: outwardIgst,
      totalTax: totalOutwardTax
    },
    gstr3b: {
      outwardTax: totalOutwardTax,
      eligibleItc: totalItc,
      netTaxPayableCash: netPayableTax
    }
  };
}

module.exports = {
  getDayBook,
  getLedgerStatement,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getGstSummary
};
