import { describe, it, expect, beforeEach } from 'vitest';
import {
  initCompanyAccounts,
  getCompanyLedgers,
  createLedger,
  STANDARD_GROUPS
} from '../../accounts.js';
import {
  validateDoubleEntry,
  createVoucher,
  cancelVoucher,
  postSalesInvoiceVoucher
} from '../../vouchers.js';
import {
  getDayBook,
  getLedgerStatement,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getGstSummary
} from '../../reports.js';

describe('Phase 4: Accounting Core (Chart of Accounts & Groups)', () => {
  it('contains standard Tally-compatible primary and sub-groups', () => {
    const groupIds = STANDARD_GROUPS.map(g => g.id);
    expect(groupIds).toContain('grp_capital');
    expect(groupIds).toContain('grp_debtors');
    expect(groupIds).toContain('grp_creditors');
    expect(groupIds).toContain('grp_taxes');
    expect(groupIds).toContain('grp_bank');
    expect(groupIds).toContain('grp_cash');
    expect(groupIds).toContain('grp_sales');
    expect(groupIds).toContain('grp_purchases');
    expect(groupIds).toContain('grp_suspense');
  });

  it('initializes default system ledgers for a new company', async () => {
    const coId = 'co_test_phase4_' + Math.random().toString(36).slice(2, 7);
    const ledgers = await initCompanyAccounts(coId);
    expect(ledgers.length).toBeGreaterThanOrEqual(15);

    const codes = ledgers.map(l => l.code);
    expect(codes).toContain('CASH');
    expect(codes).toContain('BANK');
    expect(codes).toContain('CGST_OUT');
    expect(codes).toContain('SGST_OUT');
    expect(codes).toContain('IGST_OUT');
    expect(codes).toContain('SUSPENSE');
  });

  it('dynamically maps existing customers and vendors without duplicating records', async () => {
    const coId = 'co_test_parties';
    const mockCustomers = [
      { id: 'cust_abc', name: 'ABC Builders Ltd', gstin: '33AABCA1234A1Z5', openingBalance: 50000 }
    ];
    const mockVendors = [
      { id: 'vend_xyz', name: 'XYZ Glass Suppliers', gstin: '33AABXY9876B1Z2', openingBalance: 20000 }
    ];

    const all = await getCompanyLedgers(coId, mockCustomers, mockVendors);
    const custLedger = all.find(l => l.id === 'led_cust_cust_abc');
    expect(custLedger).toBeDefined();
    expect(custLedger.name).toBe('ABC Builders Ltd');
    expect(custLedger.groupName).toBe('Sundry Debtors');
    expect(custLedger.nature).toBe('assets');
    expect(custLedger.openingBalance).toBe(50000);

    const vendLedger = all.find(l => l.id === 'led_vend_vend_xyz');
    expect(vendLedger).toBeDefined();
    expect(vendLedger.name).toBe('XYZ Glass Suppliers');
    expect(vendLedger.groupName).toBe('Sundry Creditors');
    expect(vendLedger.nature).toBe('liabilities');
    expect(vendLedger.openingBalance).toBe(20000);
  });
});

describe('Phase 4: Double-Entry Voucher Engine & Atomic Posting', () => {
  it('validates debit equals credit and rejects unbalanced vouchers', () => {
    // Unbalanced entries (Dr 1000, Cr 900)
    expect(() => {
      validateDoubleEntry([
        { ledgerId: 'led_1', debit: 1000, credit: 0 },
        { ledgerId: 'led_2', debit: 0, credit: 900 }
      ]);
    }).toThrow(/Double-entry imbalance/);

    // Balanced entries (Dr 1000, Cr 1000)
    const valid = validateDoubleEntry([
      { ledgerId: 'led_1', debit: 1000, credit: 0 },
      { ledgerId: 'led_2', debit: 0, credit: 1000 }
    ]);
    expect(valid.totalDebit).toBe(1000);
    expect(valid.totalCredit).toBe(1000);
  });

  it('creates a balanced voucher and posts atomic ledger entries', async () => {
    const coId = 'co_vch_test_' + Math.random().toString(36).slice(2, 7);
    const vch = await createVoucher({
      companyId: coId,
      voucherType: 'receipt',
      date: '2026-11-18',
      narration: 'Advance payment received from client',
      entries: [
        { ledgerId: 'led_bank_default', ledgerName: 'Bank Account', debit: 50000, credit: 0 },
        { ledgerId: 'led_cust_1', ledgerName: 'Client Customer', debit: 0, credit: 50000 }
      ]
    }, { name: 'Accountant' });

    expect(vch.id).toBeDefined();
    expect(vch.voucherNo).toMatch(/^RCP\/\d{2}-\d{2}\/\d{4}$/);
    expect(vch.totalAmount).toBe(50000);
    expect(vch.status).toBe('posted');
    expect(vch.cancelled).toBe(false);
  });

  it('cancels voucher with mandatory statutory reason without hard deleting', async () => {
    const coId = 'co_vch_cancel_test';
    const vch = await createVoucher({
      companyId: coId,
      voucherType: 'payment',
      date: '2026-11-18',
      narration: 'Petty cash payment',
      entries: [
        { ledgerId: 'led_contractor_charges', ledgerName: 'Labour Expense', debit: 1500, credit: 0 },
        { ledgerId: 'led_cash', ledgerName: 'Cash in Hand', debit: 0, credit: 1500 }
      ]
    });

    // Attempting cancel without reason must fail
    await expect(cancelVoucher(vch.id, '', { name: 'Auditor' })).rejects.toThrow(/reason is strictly required/);

    // Cancel with statutory reason
    const cancelled = await cancelVoucher(vch.id, 'Entry posted to wrong ledger by mistake', { name: 'Auditor' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.cancelledReason).toBe('Entry posted to wrong ledger by mistake');
  });

  it('auto-posts a balanced Sales Voucher from a Tax Invoice', async () => {
    const invoiceDoc = {
      id: 'doc_inv_test_99',
      no: 'CTBI/26-27/0099',
      companyId: 'co_inv_autopost',
      date: '2026-11-18',
      project: 'DLF IT Park Project',
      projectCode: 'PRJ-DLF-01',
      site: 'Tower 4 Facade',
      poNo: 'PO-DLF-9988',
      poDate: '2026-11-10',
      vehicleNo: 'TN-09-CD-5678',
      ewayBillNo: '998877665544',
      transporter: 'SafeX Logistics',
      cust: { id: 'cust_dlf', name: 'DLF Cybercity Ltd', gstin: '33AABCD1234E1Z1', address: 'DLF Cybercity Chennai' },
      shipping: { name: 'DLF Site Store', gstin: '33AABCD1234E1Z1', address: 'Plot 7 DLF IT Park' },
      totals: {
        subTotal: 100000,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        roundOff: 0,
        grandTotal: 118000
      }
    };

    const vch = await postSalesInvoiceVoucher(invoiceDoc, { name: 'Billing Clerk' });
    expect(vch.voucherType).toBe('sales');
    expect(vch.docRef).toBe('CTBI/26-27/0099');
    expect(vch.totalAmount).toBe(118000);
    expect(vch.billing.name).toBe('DLF Cybercity Ltd');
    expect(vch.billing.gstin).toBe('33AABCD1234E1Z1');
    expect(vch.shipping.name).toBe('DLF Site Store');
    expect(vch.project).toBe('DLF IT Park Project');
    expect(vch.projectCode).toBe('PRJ-DLF-01');
    expect(vch.poNo).toBe('PO-DLF-9988');
    expect(vch.vehicleNo).toBe('TN-09-CD-5678');
    expect(vch.ewayBillNo).toBe('998877665544');
    expect(vch.transporter).toBe('SafeX Logistics');

    const drDebtor = vch.entries.find(e => e.ledgerId === 'led_cust_cust_dlf');
    expect(drDebtor.debit).toBe(118000);

    const crSales = vch.entries.find(e => e.ledgerId === 'led_sales_services');
    expect(crSales.credit).toBe(100000);

    const crCgst = vch.entries.find(e => e.ledgerId === 'led_cgst_out');
    expect(crCgst.credit).toBe(9000);

    const crSgst = vch.entries.find(e => e.ledgerId === 'led_sgst_out');
    expect(crSgst.credit).toBe(9000);
  });
});

describe('Phase 4: Financial Reports (Day Book, Trial Balance, P&L, Balance Sheet)', () => {
  it('generates a verified Trial Balance where Total Debits equal Total Credits', async () => {
    const coId = 'co_tb_test_' + Math.random().toString(36).slice(2, 7);

    // Voucher 1: Capital introduced: Dr Bank 5,00,000, Cr Capital 5,00,000
    await createVoucher({
      companyId: coId,
      voucherType: 'receipt',
      date: '2026-11-01',
      entries: [
        { ledgerId: 'led_bank_default', ledgerName: 'Bank', debit: 500000, credit: 0 },
        { ledgerId: 'led_capital_main', ledgerName: 'Capital Account', debit: 0, credit: 500000 }
      ]
    });

    // Voucher 2: Material Purchased: Dr Raw Material 1,00,000, Dr Input CGST 9,000, Dr Input SGST 9,000, Cr Vendor 1,18,000
    await createVoucher({
      companyId: coId,
      voucherType: 'purchase',
      date: '2026-11-05',
      entries: [
        { ledgerId: 'led_purchases_raw', ledgerName: 'Purchases', debit: 100000, credit: 0 },
        { ledgerId: 'led_cgst_in', ledgerName: 'Input CGST', debit: 9000, credit: 0 },
        { ledgerId: 'led_sgst_in', ledgerName: 'Input SGST', debit: 9000, credit: 0 },
        { ledgerId: 'led_vend_1', ledgerName: 'Vendor Steel Corp', debit: 0, credit: 118000 }
      ]
    });

    // Voucher 3: Sales to Customer: Dr Customer 2,36,000, Cr Sales 2,00,000, Cr Output CGST 18,000, Cr Output SGST 18,000
    await createVoucher({
      companyId: coId,
      voucherType: 'sales',
      date: '2026-11-10',
      entries: [
        { ledgerId: 'led_cust_1', ledgerName: 'Customer Alpha', debit: 236000, credit: 0 },
        { ledgerId: 'led_sales_goods', ledgerName: 'Sales Goods', debit: 0, credit: 200000 },
        { ledgerId: 'led_cgst_out', ledgerName: 'Output CGST', debit: 0, credit: 18000 },
        { ledgerId: 'led_sgst_out', ledgerName: 'Output SGST', debit: 0, credit: 18000 }
      ]
    });

    const tb = await getTrialBalance(coId, '2026-11-30');
    expect(tb.isTallied).toBe(true);
    expect(tb.difference).toBe(0);
    expect(tb.totalDebit).toBe(tb.totalCredit);

    // P&L: Income (2,00,000) - Expense (1,00,000) = Net Profit (1,00,000)
    const pnl = await getProfitAndLoss(coId, null, '2026-11-30');
    expect(pnl.totalIncome).toBe(200000);
    expect(pnl.totalExpense).toBe(100000);
    expect(pnl.netProfit).toBe(100000);

    // Balance Sheet: Assets === Liabilities
    const bs = await getBalanceSheet(coId, '2026-11-30');
    expect(bs.isBalanced).toBe(true);
    expect(bs.difference).toBe(0);
    expect(bs.totalAssets).toBe(bs.totalLiabilities);

    // GST Summary: Outward tax (36,000) - Eligible ITC (18,000) = Net Payable (18,000)
    const gst = await getGstSummary(coId, '2026-11-01', '2026-11-30');
    expect(gst.gstr1.taxableSupplies).toBe(200000);
    expect(gst.gstr1.totalTax).toBe(36000);
    expect(gst.gstr3b.eligibleItc).toBe(18000);
    expect(gst.gstr3b.netTaxPayableCash).toBe(18000);
  });

  it('computes ledger statement with accurate chronological running balance', async () => {
    const coId = 'co_stmt_test_' + Math.random().toString(36).slice(2, 7);

    // Day 1: Deposit 10,000
    await createVoucher({
      companyId: coId,
      voucherType: 'receipt',
      date: '2026-11-01',
      entries: [
        { ledgerId: 'led_bank_default', ledgerName: 'Bank', debit: 10000, credit: 0 },
        { ledgerId: 'led_capital_main', ledgerName: 'Capital', debit: 0, credit: 10000 }
      ]
    });

    // Day 2: Withdrawal 3,000
    await createVoucher({
      companyId: coId,
      voucherType: 'payment',
      date: '2026-11-02',
      entries: [
        { ledgerId: 'led_contractor_charges', ledgerName: 'Labour', debit: 3000, credit: 0 },
        { ledgerId: 'led_bank_default', ledgerName: 'Bank', debit: 0, credit: 3000 }
      ]
    });

    const stmt = await getLedgerStatement(coId, 'led_bank_default');
    expect(stmt.rows.length).toBe(2);
    expect(stmt.rows[0].runningBalance).toBe(10000);
    expect(stmt.rows[0].balanceType).toBe('Dr');
    expect(stmt.rows[1].runningBalance).toBe(7000);
    expect(stmt.rows[1].balanceType).toBe('Dr');
    expect(stmt.closingBalance).toBe(7000);
    expect(stmt.closingBalanceType).toBe('Dr');
  });
});

