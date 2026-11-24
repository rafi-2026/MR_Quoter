import { describe, it, expect, beforeEach } from 'vitest';
import * as reports from '../../reports.js';
import * as vouchers from '../../vouchers.js';
import * as accounts from '../../accounts.js';

describe('M3: Core Financial Reports Suite', () => {
  const companyId = 'test_m3_company_' + Math.random().toString(36).slice(2, 7);

  beforeEach(async () => {
    await accounts.initCompanyAccounts(companyId);
  });

  describe('Cash Book & Bank Book', () => {
    it('generates Cash Book with receipts, payments, and net balance', async () => {
      // 1. Post Cash Receipt of Rs 15,000
      await vouchers.createVoucher({
        companyId,
        voucherType: 'receipt',
        date: '2026-05-10',
        entries: [
          { ledgerId: 'led_cash', debit: 15000, credit: 0 },
          { ledgerId: 'led_sales_goods', debit: 0, credit: 15000 }
        ]
      });

      // 2. Post Cash Payment of Rs 3,000
      await vouchers.createVoucher({
        companyId,
        voucherType: 'payment',
        date: '2026-05-12',
        entries: [
          { ledgerId: 'led_round_off', debit: 3000, credit: 0 },
          { ledgerId: 'led_cash', debit: 0, credit: 3000 }
        ]
      });

      const cb = await reports.getCashBook(companyId, '2026-05-01', '2026-05-31');
      expect(cb.totalReceipts).toBe(15000);
      expect(cb.totalPayments).toBe(3000);
      expect(cb.netBalance).toBe(12000);
      expect(cb.entries.length).toBe(2);
    });

    it('generates Bank Book with deposits, withdrawals, and net balance', async () => {
      // Bank Deposit Rs 50,000
      await vouchers.createVoucher({
        companyId,
        voucherType: 'receipt',
        date: '2026-06-01',
        entries: [
          { ledgerId: 'led_bank_default', debit: 50000, credit: 0 },
          { ledgerId: 'led_sales_services', debit: 0, credit: 50000 }
        ]
      });

      const bb = await reports.getBankBook(companyId, '2026-06-01', '2026-06-30');
      expect(bb.totalDeposits).toBe(50000);
      expect(bb.netBalance).toBe(50000);
    });
  });

  describe('Sales & Purchase Registers', () => {
    it('aggregates Sales and Purchase register transactions', async () => {
      // Sales Voucher
      await vouchers.createVoucher({
        companyId,
        voucherType: 'sales',
        date: '2026-07-01',
        partyName: 'Infra Works Ltd',
        entries: [
          { ledgerId: 'led_debtors_general', debit: 75000, credit: 0 },
          { ledgerId: 'led_sales_goods', debit: 0, credit: 75000 }
        ]
      });

      // Purchase Voucher
      await vouchers.createVoucher({
        companyId,
        voucherType: 'purchase',
        date: '2026-07-05',
        partyName: 'Alu Metal Suppliers',
        entries: [
          { ledgerId: 'led_purchases_raw', debit: 45000, credit: 0 },
          { ledgerId: 'led_creditors_general', debit: 0, credit: 45000 }
        ]
      });

      const salesReg = await reports.getSalesRegister(companyId, '2026-07-01', '2026-07-31');
      expect(salesReg.count).toBeGreaterThanOrEqual(1);
      expect(salesReg.totalGrossSales).toBe(75000);

      const purchReg = await reports.getPurchaseRegister(companyId, '2026-07-01', '2026-07-31');
      expect(purchReg.count).toBeGreaterThanOrEqual(1);
      expect(purchReg.totalGrossPurchases).toBe(45000);
    });
  });

  describe('Ratio Analysis, Cash Flow & Ageing', () => {
    it('computes financial ratios (Current Ratio, Profit Margins)', async () => {
      const ratios = await reports.getRatioAnalysis(companyId, '2026-12-31');
      expect(ratios).toBeDefined();
      expect(typeof ratios.currentRatio).toBe('number');
      expect(typeof ratios.gpMargin).toBe('number');
      expect(typeof ratios.npMargin).toBe('number');
    });

    it('calculates Direct Cash Flow Statement and Ageing Analysis buckets', async () => {
      const cf = await reports.getCashFlowStatement(companyId, '2026-01-01', '2026-12-31');
      expect(cf.period).toBeDefined();
      expect(cf.operating).toBeDefined();
      expect(typeof cf.netCashFlow).toBe('number');

      const ff = await reports.getFundFlowStatement(companyId, '2026-01-01', '2026-12-31');
      expect(ff.sources).toBeDefined();
      expect(typeof ff.totalSources).toBe('number');

      const ageing = await reports.getBillAgeingAnalysis(companyId, '2026-12-31');
      expect(ageing.buckets).toBeDefined();
      expect(ageing.buckets.b0_30).toBeDefined();
      expect(ageing.buckets.b31_60).toBeDefined();
      expect(ageing.buckets.b61_90).toBeDefined();
      expect(ageing.buckets.b90_plus).toBeDefined();
    });
  });
});
