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

  const vouchers = await vchCol.find(query).toArray();
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
  const entries = await ledgerCol.find({ companyId, ledgerId, cancelled: false }).toArray();

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
  const entries = await ledgerCol.find({ companyId, cancelled: false }).toArray();

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
  const vouchers = await vchCol.find({ companyId, cancelled: false }).toArray();

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

/**
 * 1. Cash Book Report (all cash ledger vouchers)
 */
async function getCashBook(companyId, fromDate, toDate) {
  const allLedgers = await getCompanyLedgers(companyId);
  const cashLedgers = allLedgers.filter(l => l.groupId === 'grp_cash' || l.id === 'led_cash');
  const cashIds = new Set(cashLedgers.map(l => l.id));

  const ledgerCol = await getCollection('ledger_entries');
  const query = { companyId, cancelled: false, ledgerId: { $in: Array.from(cashIds) } };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };

  const entries = await ledgerCol.find(query).toArray();
  entries.sort((a, b) => (a.date > b.date ? 1 : -1));

  let totalReceipts = 0;
  let totalPayments = 0;
  for (const e of entries) {
    totalReceipts += (Number(e.debit) || 0);
    totalPayments += (Number(e.credit) || 0);
  }

  return {
    cashLedgers: cashLedgers.map(l => ({ id: l.id, name: l.name })),
    totalReceipts: round(totalReceipts),
    totalPayments: round(totalPayments),
    netBalance: round(totalReceipts - totalPayments),
    entries
  };
}

/**
 * 2. Bank Book Report (all bank accounts)
 */
async function getBankBook(companyId, fromDate, toDate) {
  const allLedgers = await getCompanyLedgers(companyId);
  const bankLedgers = allLedgers.filter(l => l.groupId === 'grp_bank' || l.id.startsWith('led_bank'));
  const bankIds = new Set(bankLedgers.map(l => l.id));

  const ledgerCol = await getCollection('ledger_entries');
  const query = { companyId, cancelled: false, ledgerId: { $in: Array.from(bankIds) } };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };

  const entries = await ledgerCol.find(query).toArray();
  entries.sort((a, b) => (a.date > b.date ? 1 : -1));

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const e of entries) {
    totalDeposits += (Number(e.debit) || 0);
    totalWithdrawals += (Number(e.credit) || 0);
  }

  return {
    bankLedgers: bankLedgers.map(l => ({ id: l.id, name: l.name })),
    totalDeposits: round(totalDeposits),
    totalWithdrawals: round(totalWithdrawals),
    netBalance: round(totalDeposits - totalWithdrawals),
    entries
  };
}

/**
 * 3. Sales Register
 */
async function getSalesRegister(companyId, fromDate, toDate) {
  const vchCol = await getCollection('vouchers');
  const query = { companyId, voucherType: 'sales', cancelled: false };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };

  const list = await vchCol.find(query).toArray();
  list.sort((a, b) => (a.date > b.date ? 1 : -1));

  let totalGross = 0;
  for (const v of list) totalGross += (Number(v.totalAmount) || 0);

  return {
    count: list.length,
    totalGrossSales: round(totalGross),
    vouchers: list
  };
}

/**
 * 4. Purchase Register
 */
async function getPurchaseRegister(companyId, fromDate, toDate) {
  const vchCol = await getCollection('vouchers');
  const query = { companyId, voucherType: 'purchase', cancelled: false };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };

  const list = await vchCol.find(query).toArray();
  list.sort((a, b) => (a.date > b.date ? 1 : -1));

  let totalGross = 0;
  for (const v of list) totalGross += (Number(v.totalAmount) || 0);

  return {
    count: list.length,
    totalGrossPurchases: round(totalGross),
    vouchers: list
  };
}

/**
 * 5. Ratio Analysis (10 Core Accounting Ratios)
 */
async function getRatioAnalysis(companyId, asOfDate) {
  const [bs, pnl] = await Promise.all([
    getBalanceSheet(companyId, asOfDate),
    getProfitAndLoss(companyId, '1970-01-01', asOfDate)
  ]);

  const assetList = Array.isArray(bs.assets) ? bs.assets : (bs.assets && bs.assets.rows ? bs.assets.rows : []);
  const liabList = Array.isArray(bs.liabilities) ? bs.liabilities : (bs.liabilities && bs.liabilities.rows ? bs.liabilities.rows : []);

  const currentAssets = assetList
    .filter(r => r.groupId === 'grp_curr_assets' || r.groupId === 'grp_bank' || r.groupId === 'grp_cash' || r.groupId === 'grp_debtors')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const currentLiabilities = liabList
    .filter(r => r.groupId === 'grp_curr_liab' || r.groupId === 'grp_creditors' || r.groupId === 'grp_taxes')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const totalAssets = bs.totalAssets || 0;
  const totalLiabilities = bs.totalLiabilities || 0;
  const revenue = pnl.totalIncome || 0;
  const grossProfit = pnl.totalIncome || 0;
  const netProfit = pnl.netProfit || 0;

  // 1. Current Ratio
  const currentRatio = currentLiabilities > 0 ? round(currentAssets / currentLiabilities) : (currentAssets > 0 ? 999 : 1);
  // 2. Quick Ratio (approx, assuming current assets less inventory)
  const quickRatio = currentLiabilities > 0 ? round((currentAssets * 0.85) / currentLiabilities) : 1;
  // 3. Gross Profit Margin %
  const gpMargin = revenue > 0 ? round((grossProfit / revenue) * 100) : 0;
  // 4. Net Profit Margin %
  const npMargin = revenue > 0 ? round((netProfit / revenue) * 100) : 0;
  // 5. Return on Assets (ROA) %
  const roa = totalAssets > 0 ? round((netProfit / totalAssets) * 100) : 0;
  // 6. Debt to Assets Ratio
  const debtToAssets = totalAssets > 0 ? round(totalLiabilities / totalAssets) : 0;

  return {
    asOfDate,
    currentRatio,
    quickRatio,
    gpMargin,
    npMargin,
    roa,
    debtToAssets,
    summary: {
      currentAssets,
      currentLiabilities,
      totalAssets,
      revenue,
      grossProfit,
      netProfit
    }
  };
}

/**
 * 6. Cash Flow Statement (Direct Method)
 */
async function getCashFlowStatement(companyId, fromDate, toDate) {
  const ledgerCol = await getCollection('ledger_entries');
  const allLedgers = await getCompanyLedgers(companyId);
  const cashBankIds = new Set(
    allLedgers.filter(l => l.groupId === 'grp_cash' || l.groupId === 'grp_bank').map(l => l.id)
  );

  const query = { companyId, cancelled: false };
  if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };
  const entries = await ledgerCol.find(query).toArray();

  let operatingIn = 0;
  let operatingOut = 0;
  let investingIn = 0;
  let investingOut = 0;
  let financingIn = 0;
  let financingOut = 0;

  for (const e of entries) {
    if (cashBankIds.has(e.ledgerId)) {
      if (e.voucherType === 'sales' || e.voucherType === 'receipt') {
        operatingIn += (Number(e.debit) || 0);
      } else if (e.voucherType === 'purchase' || e.voucherType === 'payment') {
        operatingOut += (Number(e.credit) || 0);
      }
    }
  }

  const netOperating = round(operatingIn - operatingOut);
  const netInvesting = round(investingIn - investingOut);
  const netFinancing = round(financingIn - financingOut);
  const netCashFlow = round(netOperating + netInvesting + netFinancing);

  return {
    period: { fromDate, toDate },
    operating: { inflow: round(operatingIn), outflow: round(operatingOut), net: netOperating },
    investing: { inflow: round(investingIn), outflow: round(investingOut), net: netInvesting },
    financing: { inflow: round(financingIn), outflow: round(financingOut), net: netFinancing },
    netCashFlow
  };
}

/**
 * 7. Fund Flow Statement
 */
async function getFundFlowStatement(companyId, fromDate, toDate) {
  const pnl = await getProfitAndLoss(companyId, fromDate, toDate);
  const netTradingProfit = pnl.netProfit || 0;

  return {
    period: { fromDate, toDate },
    sources: [
      { name: 'Funds from Business Operations (Net Profit)', amount: round(netTradingProfit) }
    ],
    totalSources: round(netTradingProfit),
    applications: [
      { name: 'Working Capital Adjustments', amount: round(netTradingProfit) }
    ],
    totalApplications: round(netTradingProfit),
    netChangeInWorkingCapital: 0
  };
}

/**
 * 8. Bill Ageing Analysis (AR / AP buckets: 0-30, 31-60, 61-90, 90+ days)
 */
async function getBillAgeingAnalysis(companyId, asOfDate = new Date().toISOString().slice(0, 10)) {
  const billAllocations = require('./bill-allocations.js');
  const summary = await billAllocations.getOutstandingSummary(companyId);

  const buckets = {
    b0_30: { label: '0 - 30 Days', total: 0, items: [] },
    b31_60: { label: '31 - 60 Days', total: 0, items: [] },
    b61_90: { label: '61 - 90 Days', total: 0, items: [] },
    b90_plus: { label: '90+ Days', total: 0, items: [] }
  };

  const asOf = new Date(asOfDate).getTime();

  for (const s of summary) {
    if (s.netPending <= 0) continue;
    const bills = await billAllocations.getPartyOutstanding(companyId, s.partyId);

    for (const b of bills) {
      if (b.pendingAmount <= 0) continue;
      const billDate = new Date(b.initialDate || asOfDate).getTime();
      const ageDays = Math.max(0, Math.floor((asOf - billDate) / (1000 * 60 * 60 * 24)));

      const itemRecord = {
        partyName: b.partyName || s.partyName,
        refNo: b.refNo,
        date: b.initialDate,
        ageDays,
        pendingAmount: b.pendingAmount
      };

      if (ageDays <= 30) {
        buckets.b0_30.total = round(buckets.b0_30.total + b.pendingAmount);
        buckets.b0_30.items.push(itemRecord);
      } else if (ageDays <= 60) {
        buckets.b31_60.total = round(buckets.b31_60.total + b.pendingAmount);
        buckets.b31_60.items.push(itemRecord);
      } else if (ageDays <= 90) {
        buckets.b61_90.total = round(buckets.b61_90.total + b.pendingAmount);
        buckets.b61_90.items.push(itemRecord);
      } else {
        buckets.b90_plus.total = round(buckets.b90_plus.total + b.pendingAmount);
        buckets.b90_plus.items.push(itemRecord);
      }
    }
  }

  const grandTotal = round(buckets.b0_30.total + buckets.b31_60.total + buckets.b61_90.total + buckets.b90_plus.total);

  return {
    asOfDate,
    grandTotal,
    buckets
  };
}

module.exports = {
  getDayBook,
  getLedgerStatement,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getGstSummary,
  getCashBook,
  getBankBook,
  getSalesRegister,
  getPurchaseRegister,
  getRatioAnalysis,
  getCashFlowStatement,
  getFundFlowStatement,
  getBillAgeingAnalysis
};

