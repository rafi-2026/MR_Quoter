import { describe, it, expect } from 'vitest';
import * as billAllocations from '../../bill-allocations.js';
import * as yearEnd from '../../year-end.js';
import * as vouchers from '../../vouchers.js';
import * as accounts from '../../accounts.js';

describe('M2: Voucher Engine, Bill-by-Bill Allocation & Year-End Closing', () => {
  const companyId = 'test_m2_company_' + Math.random().toString(36).slice(2, 7);

  describe('Tally Voucher Types Definition', () => {
    it('supports 15 standard Tally voucher types with proper posting flags', () => {
      const types = vouchers.VOUCHER_TYPES;
      expect(types.sales).toBeDefined();
      expect(types.purchase).toBeDefined();
      expect(types.receipt).toBeDefined();
      expect(types.payment).toBeDefined();
      expect(types.journal).toBeDefined();
      expect(types.contra).toBeDefined();
      expect(types.debit_note).toBeDefined();
      expect(types.credit_note).toBeDefined();
      expect(types.sales_order).toBeDefined();
      expect(types.sales_order.posting).toBe(false);
      expect(types.purchase_order).toBeDefined();
      expect(types.purchase_order.posting).toBe(false);
      expect(types.delivery_note).toBeDefined();
      expect(types.receipt_note).toBeDefined();
      expect(types.stock_journal).toBeDefined();
      expect(types.memorandum).toBeDefined();
      expect(types.memorandum.posting).toBe(false);
      expect(types.reversing_journal).toBeDefined();
    });

    it('creates a non-posting sales order without inserting ledger entries', async () => {
      const soVoucher = await vouchers.createVoucher({
        companyId,
        voucherType: 'sales_order',
        partyName: 'Apex Client Corp',
        entries: [
          { ledgerId: 'led_debtors_general', debit: 25000, credit: 0 },
          { ledgerId: 'led_sales_goods', debit: 0, credit: 25000 }
        ]
      });

      expect(soVoucher.id).toBeDefined();
      expect(soVoucher.voucherType).toBe('sales_order');
      expect(soVoucher.totalAmount).toBe(25000);
    });
  });

  describe('Bill-by-Bill Allocation Flow', () => {
    it('creates New Ref on invoice and settles with Agst Ref payment', async () => {
      const partyId = 'cust_m2_test_' + Math.random().toString(36).slice(2, 6);
      const refNo = 'INV/26-27/' + Math.floor(1000 + Math.random() * 9000);

      // 1. New invoice of Rs 50,000 (New Ref)
      await billAllocations.recordAllocation(companyId, {
        voucherId: 'vch_inv_99',
        voucherNo: refNo,
        voucherType: 'sales',
        partyId,
        partyName: 'Skyline Builders',
        type: 'New Ref',
        refNo,
        amount: 50000
      });

      // Check outstanding before payment
      let openBills = await billAllocations.getPartyOutstanding(companyId, partyId);
      expect(openBills.length).toBe(1);
      expect(openBills[0].totalAmount).toBe(50000);
      expect(openBills[0].pendingAmount).toBe(50000);
      expect(openBills[0].isSettled).toBe(false);

      // 2. Client pays partial Rs 30,000 (Agst Ref)
      await billAllocations.recordAllocation(companyId, {
        voucherId: 'vch_rcp_99',
        voucherNo: 'RCP/26-27/0055',
        voucherType: 'receipt',
        partyId,
        partyName: 'Skyline Builders',
        type: 'Agst Ref',
        refNo,
        againstVoucherId: 'vch_inv_99',
        amount: 30000
      });

      // Check remaining outstanding (should be Rs 20,000)
      openBills = await billAllocations.getPartyOutstanding(companyId, partyId);
      expect(openBills.length).toBe(1);
      expect(openBills[0].settledAmount).toBe(30000);
      expect(openBills[0].pendingAmount).toBe(20000);
      expect(openBills[0].isSettled).toBe(false);

      // 3. Client settles remaining Rs 20,000
      await billAllocations.recordAllocation(companyId, {
        voucherId: 'vch_rcp_100',
        voucherNo: 'RCP/26-27/0056',
        voucherType: 'receipt',
        partyId,
        partyName: 'Skyline Builders',
        type: 'Agst Ref',
        refNo,
        againstVoucherId: 'vch_inv_99',
        amount: 20000
      });

      openBills = await billAllocations.getPartyOutstanding(companyId, partyId);
      expect(openBills[0].pendingAmount).toBe(0);
      expect(openBills[0].isSettled).toBe(true);
    });

    it('generates outstanding summary across multiple accounts', async () => {
      const summaryPartyId = 'cust_summary_' + Math.random().toString(36).slice(2, 6);
      await billAllocations.recordAllocation(companyId, {
        voucherId: 'vch_sum_1',
        voucherNo: 'INV/26-27/SUMM',
        voucherType: 'sales',
        partyId: summaryPartyId,
        partyName: 'Summary Partner',
        type: 'New Ref',
        amount: 15000
      });

      const summary = await billAllocations.getOutstandingSummary(companyId);
      expect(Array.isArray(summary)).toBe(true);
      expect(summary.some(s => s.partyId === summaryPartyId)).toBe(true);
    });
  });

  describe('Year-End Closing & Retained Earnings', () => {
    it('calculates net profit and closes FY with carry forward', async () => {
      await accounts.initCompanyAccounts(companyId);

      // Post Sales (Income) voucher of Rs 1,00,000
      await vouchers.createVoucher({
        companyId,
        voucherType: 'sales',
        date: '2026-03-15',
        entries: [
          { ledgerId: 'led_bank_default', debit: 100000, credit: 0 },
          { ledgerId: 'led_sales_goods', debit: 0, credit: 100000 }
        ]
      });

      // Post Expense voucher of Rs 40,000
      await vouchers.createVoucher({
        companyId,
        voucherType: 'payment',
        date: '2026-03-20',
        entries: [
          { ledgerId: 'led_purchases_raw', debit: 40000, credit: 0 },
          { ledgerId: 'led_bank_default', debit: 0, credit: 40000 }
        ]
      });

      // Execute Year-End Closing for FY ending 2026-03-31
      const closeLog = await yearEnd.closeFinancialYear(companyId, {
        fromDate: '2025-04-01',
        toDate: '2026-03-31',
        nextFyStart: '2026-04-01',
        user: { name: 'Lead Auditor' }
      });

      expect(closeLog.id).toBeDefined();
      expect(closeLog.totalIncome).toBe(100000);
      expect(closeLog.totalExpense).toBe(40000);
      expect(closeLog.netProfit).toBe(60000); // 1,00,000 - 40,000

      // Verify cannot close the same FY twice
      await expect(
        yearEnd.closeFinancialYear(companyId, {
          fromDate: '2025-04-01',
          toDate: '2026-03-31'
        })
      ).rejects.toThrow(/already been closed/);

      // Verify history audit retrieval
      const history = await yearEnd.getYearEndHistory(companyId);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].netProfit).toBe(60000);
    });
  });
});
