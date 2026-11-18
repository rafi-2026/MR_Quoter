import { describe, it, expect } from 'vitest';
import {
  createProject,
  getProjects,
  getProjectFinancials
} from '../../projects.js';
import {
  getPettyCashBalance,
  recordPettyCashTopup,
  recordPettyCashExpense,
  reconcilePhysicalCash
} from '../../pettycash.js';
import {
  performThreeWayMatch
} from '../../procurement.js';
import { createDocument } from '../../documents.js';
import { createVoucher } from '../../vouchers.js';

describe('Phase 6: Project-Wise Costing & Budget Analytics', () => {
  it('creates project master and retrieves project list', async () => {
    const coId = 'co_proj_test_' + Math.random().toString(36).slice(2, 7);
    const p = await createProject(coId, {
      name: 'Olympia Tech Park Interiors',
      customerName: 'Olympia Group',
      budget: 500000,
      site: 'Guindy, Chennai'
    }, { name: 'PM' });

    expect(p.id).toBeDefined();
    expect(p.code).toBe('OLYM');
    expect(p.budget).toBe(500000);

    const list = await getProjects(coId);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Olympia Tech Park Interiors');
  });

  it('computes project P&L, expenses, profit margin and flags budget warning', async () => {
    const coId = 'co_fin_test_' + Math.random().toString(36).slice(2, 7);
    const projName = 'Prestige Cyber Towers';

    const p = await createProject(coId, {
      name: projName,
      budget: 100000
    });

    // 1. Create a Tax Invoice for the project of ₹1,50,000
    await createDocument({
      companyId: coId,
      docType: 'inv',
      project: projName,
      lines: [{ name: 'Acoustic Ceilings', qty: 1000, rate: 150 }] // 1,50,000 + GST
    });

    // 2. Post an expense entry of ₹95,000 for materials (reaching 95% of ₹1,00,000 budget)
    await createVoucher({
      companyId: coId,
      voucherType: 'purchase',
      date: '2026-11-18',
      narration: `Material purchase for ${projName}`,
      entries: [
        { ledgerId: 'led_purchases_raw', ledgerName: 'Materials', debit: 95000, credit: 0 },
        { ledgerId: 'led_vend_1', ledgerName: 'Vendor', debit: 0, credit: 95000 }
      ]
    });

    const fin = await getProjectFinancials(coId, p.id);
    expect(fin.metrics.billedValue).toBeGreaterThanOrEqual(150000);
    expect(fin.metrics.expenses.materials).toBe(95000);
    expect(fin.metrics.expenses.total).toBe(95000);
    expect(fin.metrics.budgetUtilizationPct).toBe(95);
    expect(fin.metrics.budgetStatus).toBe('warning'); // >= 90%
    expect(fin.metrics.netProfit).toBeGreaterThan(0);
    expect(fin.metrics.marginPct).toBeGreaterThan(0);
  });
});

describe('Phase 6: Petty Cash Imprest Register & Physical Count Audit', () => {
  it('manages imprest fund: top-up, expense validation, and balance protection', async () => {
    const coId = 'co_petty_' + Math.random().toString(36).slice(2, 7);
    const site = 'Site Chennai South';

    // 1. Initial balance is 0
    const bal0 = await getPettyCashBalance(coId, site);
    expect(bal0).toBe(0);

    // 2. Top-up ₹10,000
    const topup = await recordPettyCashTopup(coId, {
      site,
      amount: 10000,
      notes: 'Initial imprest float'
    }, { name: 'Finance' });
    expect(topup.newBalance).toBe(10000);

    // 3. Record expense ₹2,500
    const exp = await recordPettyCashExpense(coId, {
      site,
      amount: 2500,
      expenseHeadName: 'Site Minor Hardware',
      paidTo: 'Local Hardware Store'
    }, { name: 'Site Eng.' });
    expect(exp.remainingBalance).toBe(7500);

    // 4. Over-spending check: attempting ₹8,000 when balance is ₹7,500 must fail
    await expect(recordPettyCashExpense(coId, {
      site,
      amount: 8000
    })).rejects.toThrow(/Insufficient petty cash balance/);
  });

  it('reconciles physical cash count and records surplus / shortage', async () => {
    const coId = 'co_audit_pc_' + Math.random().toString(36).slice(2, 7);
    const site = 'Site Coimbatore';

    await recordPettyCashTopup(coId, { site, amount: 5000 });
    await recordPettyCashExpense(coId, { site, amount: 1200 }); // Book balance = 3800

    // Auditor counts physical cash: ₹3,750 (Shortage of ₹50)
    const audit = await reconcilePhysicalCash(coId, site, 3750, { name: 'Internal Auditor' });
    expect(audit.bookBalance).toBe(3800);
    expect(audit.physicalCount).toBe(3750);
    expect(audit.discrepancy).toBe(-50);
    expect(audit.status).toBe('shortage');

    // New balance is updated to physical count
    const updatedBal = await getPettyCashBalance(coId, site);
    expect(updatedBal).toBe(3750);
  });
});

describe('Phase 6: Procurement Chain (3-Way Match Verification)', () => {
  it('passes 3-way match when invoice matches GRN delivery and approved PO rate', () => {
    const poLines = [
      { id: 'mat_glass', name: '12mm Toughened Glass', rate: 120, qty: 500 }
    ];
    const grnLines = [
      { id: 'mat_glass', name: '12mm Toughened Glass', qty: 500 }
    ];
    const invoiceLines = [
      { id: 'mat_glass', name: '12mm Toughened Glass', rate: 120, qty: 500 }
    ];

    const match = performThreeWayMatch(poLines, grnLines, invoiceLines);
    expect(match.passed).toBe(true);
    expect(match.summary).toContain('3-Way Match PASSED');
    expect(match.lineAudits[0].status).toBe('PASSED');
  });

  it('fails and blocks payment authorization when invoice quantity exceeds GRN received quantity', () => {
    const poLines = [
      { id: 'mat_alu', name: 'Aluminium Extrusions', rate: 250, qty: 1000 }
    ];
    const grnLines = [
      { id: 'mat_alu', name: 'Aluminium Extrusions', qty: 800 } // only 800 delivered
    ];
    const invoiceLines = [
      { id: 'mat_alu', name: 'Aluminium Extrusions', rate: 250, qty: 1000 } // attempting to bill 1000!
    ];

    const match = performThreeWayMatch(poLines, grnLines, invoiceLines);
    expect(match.passed).toBe(false);
    expect(match.summary).toContain('3-Way Match FAILED');
    expect(match.lineAudits[0].qtyMatched).toBe(false);
    expect(match.lineAudits[0].qtyDiff).toBe(200);
    expect(match.lineAudits[0].status).toBe('QTY_MISMATCH');
  });

  it('fails when vendor inflates rate above approved PO rate', () => {
    const poLines = [
      { id: 'mat_silicone', name: 'Dow Corning Structural Silicone', rate: 450, qty: 100 }
    ];
    const grnLines = [
      { id: 'mat_silicone', name: 'Dow Corning Structural Silicone', qty: 100 }
    ];
    const invoiceLines = [
      { id: 'mat_silicone', name: 'Dow Corning Structural Silicone', rate: 520, qty: 100 } // billed at 520!
    ];

    const match = performThreeWayMatch(poLines, grnLines, invoiceLines);
    expect(match.passed).toBe(false);
    expect(match.lineAudits[0].rateMatched).toBe(false);
    expect(match.lineAudits[0].rateDiff).toBe(70);
    expect(match.lineAudits[0].status).toBe('RATE_MISMATCH');
  });
});

