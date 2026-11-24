'use strict';
/**
 * budgets.js — Budget Master, Allocation & Variance Analysis (Budget vs Actual)
 *
 * Implements:
 *   - Financial Year Budgets for Expense & Revenue Ledgers
 *   - Real-time Variance Analysis (Budgeted vs Actual Spends)
 *   - Over-budget warnings on voucher posting
 */

const { getCollection } = require('./db.js');
const { getCompanyLedgers } = require('./accounts.js');

function round(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Create or Update Budget
 */
async function saveBudget(companyId, data) {
  const col = await getCollection('budgets');
  const id = data.id || ('bg_' + Math.random().toString(36).slice(2, 10));

  const doc = {
    id,
    companyId,
    name: String(data.name || '').trim(),
    financialYear: data.financialYear || '26-27',
    fromDate: data.fromDate,
    toDate: data.toDate,
    allocations: (data.allocations || []).map(a => ({
      ledgerId: a.ledgerId,
      ledgerName: a.ledgerName || 'Ledger',
      budgetAmount: Number(a.budgetAmount) || 0
    })),
    createdAt: Date.now()
  };

  if (!doc.name) throw new Error('Budget name is required');
  await col.replaceOne({ id, companyId }, doc, { upsert: true });
  return doc;
}

async function listBudgets(companyId) {
  const col = await getCollection('budgets');
  return await col.find({ companyId }).toArray();
}

/**
 * Budget vs Actual Variance Analysis
 */
async function getBudgetVariance(companyId, budgetId) {
  const col = await getCollection('budgets');
  const budget = await col.findOne({ id: budgetId, companyId });
  if (!budget) throw new Error('Budget not found');

  const ledgerCol = await getCollection('ledger_entries');
  const query = { companyId, cancelled: false };
  if (budget.fromDate && budget.toDate) {
    query.date = { $gte: budget.fromDate, $lte: budget.toDate };
  }

  const entries = await ledgerCol.find(query).toArray();

  const actualSpends = new Map();
  for (const e of entries) {
    const net = (Number(e.debit) || 0) - (Number(e.credit) || 0);
    actualSpends.set(e.ledgerId, (actualSpends.get(e.ledgerId) || 0) + net);
  }

  let totalBudget = 0;
  let totalActual = 0;

  const comparison = budget.allocations.map(a => {
    const actual = round(Math.max(0, actualSpends.get(a.ledgerId) || 0));
    const variance = round(a.budgetAmount - actual);
    const pctUsed = a.budgetAmount > 0 ? round((actual / a.budgetAmount) * 100) : 0;
    totalBudget += a.budgetAmount;
    totalActual += actual;

    return {
      ledgerId: a.ledgerId,
      ledgerName: a.ledgerName,
      budgetAmount: a.budgetAmount,
      actualAmount: actual,
      variance, // positive = favorable (under budget), negative = over budget
      pctUsed,
      isOverBudget: actual > a.budgetAmount
    };
  });

  return {
    budgetName: budget.name,
    financialYear: budget.financialYear,
    totalBudget: round(totalBudget),
    totalActual: round(totalActual),
    netVariance: round(totalBudget - totalActual),
    lines: comparison
  };
}

module.exports = {
  saveBudget,
  listBudgets,
  getBudgetVariance
};
