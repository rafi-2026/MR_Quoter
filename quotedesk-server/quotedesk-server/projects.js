'use strict';
/**
 * projects.js — Project-Wise Costing & Budget Analytics Engine
 *
 * Capabilities:
 *   - Project Master: site location, client, budget, timeline, status
 *   - Multi-document linkage: Quotation -> PO -> Invoices -> Expenses -> Petty Cash
 *   - Real-time Project Financials & P&L:
 *       - Quoted Value
 *       - Approved PO Value
 *       - Total Billed to Date (Tax Invoices + RA Bills)
 *       - Expenses Breakdown (Raw Materials + Subcontractor/Labour + Petty Cash + Overheads)
 *       - Gross Profit & Profit Margin %
 *       - Budget Utilization & Early Warning Alerts (>= 90% amber, > 100% red)
 */

const { getCollection } = require('./db.js');

async function getProjects(companyId) {
  const col = await getCollection('projects');
  return (await col.find({ companyId })).sort((a, b) => b.createdAt - a.createdAt);
}

async function createProject(companyId, data, user = {}) {
  const {
    name,
    code = '',
    customerId = null,
    customerName = '',
    site = '',
    startDate = new Date().toISOString().slice(0, 10),
    targetDate = '',
    budget = 0,
    status = 'active',
    notes = ''
  } = data;

  if (!name || !name.trim()) throw new Error('Project name is required');

  const col = await getCollection('projects');
  const project = {
    id: 'proj_' + Math.random().toString(36).slice(2, 10),
    name: name.trim(),
    code: code.trim().toUpperCase() || name.trim().slice(0, 4).toUpperCase(),
    companyId,
    customerId,
    customerName,
    site,
    startDate,
    targetDate,
    budget: Number(budget) || 0,
    status, // 'active', 'on_hold', 'completed', 'cancelled'
    notes,
    createdAt: Date.now(),
    createdBy: user.name || 'User'
  };

  await col.insertOne(project);
  return project;
}

async function getProjectFinancials(companyId, projectId) {
  const projCol = await getCollection('projects');
  const project = await projCol.findOne({ id: projectId, companyId });
  if (!project) throw new Error('Project not found');

  // Gather linked documents & expenses
  const docCol = await getCollection('documents');
  const docs = await docCol.find({ companyId, project: project.name, superseded: false });

  let quotedValue = 0;
  let poValue = 0;
  let billedValue = 0;

  docs.forEach(d => {
    const total = (d.totals && d.totals.grandTotal) || 0;
    if (d.docType === 'pi') quotedValue += total;
    else if (d.docType === 'cpo') poValue += total;
    else if (d.docType === 'inv' || d.docType === 'ra') billedValue += total;
  });

  // Gather project expenses from ledger entries
  const ledgerCol = await getCollection('ledger_entries');
  const allEntries = await ledgerCol.find({ companyId, cancelled: false });

  let materialExpenses = 0;
  let labourExpenses = 0;
  let otherExpenses = 0;

  allEntries.forEach(e => {
    const matchesProject = (e.narration && e.narration.toLowerCase().includes(project.name.toLowerCase())) ||
                           (e.docRef && docs.some(d => d.no === e.docRef));
    if (!matchesProject) return;

    if (e.ledgerId.startsWith('led_purchases')) {
      materialExpenses += e.debit;
    } else if (e.ledgerId.startsWith('led_contractor')) {
      labourExpenses += e.debit;
    } else if (e.ledgerId.startsWith('led_exp') || e.ledgerId.startsWith('led_petty')) {
      otherExpenses += e.debit;
    }
  });

  const totalExpenses = Math.round((materialExpenses + labourExpenses + otherExpenses) * 100) / 100;
  const netProfit = Math.round((billedValue - totalExpenses) * 100) / 100;
  const marginPct = billedValue > 0 ? Math.round((netProfit / billedValue) * 1000) / 10 : 0;

  const budget = Number(project.budget) || 0;
  const budgetUtilizationPct = budget > 0 ? Math.round((totalExpenses / budget) * 1000) / 10 : 0;

  let budgetStatus = 'ok';
  if (budget > 0) {
    if (totalExpenses > budget) budgetStatus = 'exceeded';
    else if (budgetUtilizationPct >= 90) budgetStatus = 'warning';
  }

  return {
    project,
    metrics: {
      budget,
      quotedValue: Math.round(quotedValue * 100) / 100,
      poValue: Math.round(poValue * 100) / 100,
      billedValue: Math.round(billedValue * 100) / 100,
      expenses: {
        materials: Math.round(materialExpenses * 100) / 100,
        labour: Math.round(labourExpenses * 100) / 100,
        other: Math.round(otherExpenses * 100) / 100,
        total: totalExpenses
      },
      netProfit,
      marginPct,
      budgetUtilizationPct,
      budgetStatus // 'ok' | 'warning' (>=90%) | 'exceeded' (>100%)
    }
  };
}

module.exports = {
  getProjects,
  createProject,
  getProjectFinancials
};
