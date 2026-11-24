import { describe, it, expect, beforeEach } from 'vitest';
import * as payroll from '../../payroll.js';
import * as budgets from '../../budgets.js';
import * as accounts from '../../accounts.js';
import * as vouchers from '../../vouchers.js';

describe('M7: Payroll, Budgets & Variance Analysis Suite', () => {
  const companyId = 'test_m7_company_' + Math.random().toString(36).slice(2, 7);

  beforeEach(async () => {
    await accounts.initCompanyAccounts(companyId);
  });

  describe('Payroll & Salary Structure with PF/ESI Deductions', () => {
    it('creates employee record and computes salary slip with PF and PT deductions', async () => {
      const emp = await payroll.saveEmployee(companyId, {
        empCode: 'EMP101',
        name: 'Karthik Ramanathan',
        designation: 'Senior Project Engineer',
        basicSalary: 30000,
        hra: 15000,
        allowances: 5000,
        pfApplicable: true,
        esiApplicable: false
      });

      expect(emp.id).toBeDefined();
      expect(emp.empCode).toBe('EMP101');

      const slip = payroll.calculateSalarySlip(emp);
      expect(slip.earnings.grossSalary).toBe(50000); // 30k + 15k + 5k
      expect(slip.deductions.pf).toBe(1800); // 12% of 15,000 ceiling
      expect(slip.deductions.pt).toBe(200);
      expect(slip.netSalary).toBe(48000); // 50,000 - 2,000
    });

    it('processes monthly payroll run and automatically creates balancing voucher', async () => {
      // Save 2 employees
      await payroll.saveEmployee(companyId, {
        empCode: 'EMP102',
        name: 'Arun Kumar',
        basicSalary: 20000,
        hra: 10000,
        allowances: 0
      });

      const run = await payroll.processMonthlyPayroll(companyId, {
        month: 'September',
        year: '2026',
        user: { name: 'HR Admin' }
      });

      expect(run.id).toBeDefined();
      expect(run.voucherId).toBeDefined();
      expect(run.voucherNo).toContain('PMT');
      expect(run.totalGross).toBeGreaterThan(0);
      expect(run.totalNet).toBeGreaterThan(0);
      expect(run.totalPf).toBeGreaterThan(0);
    });
  });

  describe('Budgeting & Variance Analysis (Budget vs Actual)', () => {
    it('creates budget allocations and calculates over/under variance', async () => {
      const budgetCompanyId = 'test_budget_' + Math.random().toString(36).slice(2, 7);
      await accounts.initCompanyAccounts(budgetCompanyId);

      const budget = await budgets.saveBudget(budgetCompanyId, {
        name: 'Site Operational Budget Q3',
        financialYear: '26-27',
        allocations: [
          { ledgerId: 'led_purchases_raw', ledgerName: 'Raw Materials', budgetAmount: 100000 },
          { ledgerId: 'led_contractor_charges', ledgerName: 'Labour Expenses', budgetAmount: 50000 }
        ]
      });

      expect(budget.id).toBeDefined();

      // Post actual spend of Rs 40,000 on raw materials (under budget)
      await vouchers.createVoucher({
        companyId: budgetCompanyId,
        voucherType: 'payment',
        date: '2026-10-05',
        entries: [
          { ledgerId: 'led_purchases_raw', debit: 40000, credit: 0 },
          { ledgerId: 'led_bank_default', debit: 0, credit: 40000 }
        ]
      });

      const variance = await budgets.getBudgetVariance(budgetCompanyId, budget.id);
      expect(variance.totalBudget).toBe(150000);
      expect(variance.totalActual).toBe(40000);
      expect(variance.netVariance).toBe(110000); // Favorable

      const rawLine = variance.lines.find(l => l.ledgerId === 'led_purchases_raw');
      expect(rawLine.actualAmount).toBe(40000);
      expect(rawLine.variance).toBe(60000);
      expect(rawLine.isOverBudget).toBe(false);
    });
  });
});
