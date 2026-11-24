import { describe, it, expect, beforeEach } from 'vitest';
import * as gstReturns from '../../gst-returns.js';
import * as vouchers from '../../vouchers.js';
import * as accounts from '../../accounts.js';

describe('M5: India GST & Tax Statutory Compliance Suite', () => {
  const companyId = 'test_m5_company_' + Math.random().toString(36).slice(2, 7);

  beforeEach(async () => {
    await accounts.initCompanyAccounts(companyId);
  });

  describe('GSTR-1 JSON Return Generator', () => {
    it('generates GSTR-1 JSON with B2B, B2C, and HSN summary tables', async () => {
      // 1. Post B2B Sales Voucher with GSTIN
      await vouchers.createVoucher({
        companyId,
        voucherType: 'sales',
        date: '2026-08-10',
        billing: {
          name: 'Metro Infrastructure Ltd',
          gstin: '33AAAAA0000A1Z5'
        },
        entries: [
          { ledgerId: 'led_debtors_general', debit: 118000, credit: 0 },
          { ledgerId: 'led_sales_goods', debit: 0, credit: 100000 },
          { ledgerId: 'led_cgst_out', debit: 0, credit: 9000 },
          { ledgerId: 'led_sgst_out', debit: 0, credit: 9000 }
        ]
      });

      // 2. Post B2C Sales Voucher without GSTIN
      await vouchers.createVoucher({
        companyId,
        voucherType: 'sales',
        date: '2026-08-12',
        billing: { name: 'Direct Retail Customer' },
        entries: [
          { ledgerId: 'led_debtors_general', debit: 23600, credit: 0 },
          { ledgerId: 'led_sales_goods', debit: 0, credit: 20000 },
          { ledgerId: 'led_cgst_out', debit: 0, credit: 1800 },
          { ledgerId: 'led_sgst_out', debit: 0, credit: 1800 }
        ]
      });

      const gstr1 = await gstReturns.generateGstr1Json(companyId, '082026', '2026-08-01', '2026-08-31');
      expect(gstr1.fp).toBe('082026');
      expect(gstr1.b2b.length).toBe(1);
      expect(gstr1.b2b[0].ctin).toBe('33AAAAA0000A1Z5');
      expect(gstr1.b2b[0].inv[0].val).toBe(118000);
      expect(gstr1.b2cs.length).toBe(1);
      expect(gstr1.hsn.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GSTR-3B Table Generation & Reconciliation', () => {
    it('generates GSTR-3B tables (3.1 Outward & Table 4 ITC)', async () => {
      const gstr3b = await gstReturns.generateGstr3bData(companyId, '2026-08-01', '2026-08-31');
      expect(gstr3b.table3_1_outward).toBeDefined();
      expect(gstr3b.table4_itc).toBeDefined();
      expect(gstr3b.table6_1_payment).toBeDefined();
      expect(gstr3b.table3_1_outward.taxableValue).toBeGreaterThanOrEqual(120000);
    });

    it('performs 2-way reconciliation against uploaded GSTR-2B JSON', async () => {
      // Inward Purchase Bill in QuoteDesk books
      await vouchers.createVoucher({
        companyId,
        voucherType: 'purchase',
        date: '2026-08-05',
        docRef: 'VEND/INV/8899',
        partyName: 'Standard Glass Ltd',
        entries: [
          { ledgerId: 'led_purchases_raw', debit: 50000, credit: 0 },
          { ledgerId: 'led_cgst_in', debit: 4500, credit: 0 },
          { ledgerId: 'led_sgst_in', debit: 4500, credit: 0 },
          { ledgerId: 'led_creditors_general', debit: 0, credit: 59000 }
        ]
      });

      // Sample GSTR-2B upload
      const gstr2bInvoices = [
        { ctin: '33BBBBB1111B1Z9', inum: 'VEND/INV/8899', val: 59000 }, // Exact Match
        { ctin: '33CCCCC2222C1Z8', inum: 'UNRECORDED/INV/01', val: 12000 } // Missing in books
      ];

      const recon = await gstReturns.reconcileGstr2b(companyId, gstr2bInvoices);
      expect(recon.matchedCount).toBe(1);
      expect(recon.matched[0].status).toBe('Exact Match');
      expect(recon.missingInBooksCount).toBe(1);
    });
  });

  describe('TDS / TCS Statutory Deductions', () => {
    it('records and audits TDS u/s 194C / 194J deductions', async () => {
      const tdsDoc = await gstReturns.recordTdsEntry(companyId, {
        voucherId: 'vch_subcontract_01',
        section: '194C',
        partyName: 'Apex Labour Contractors',
        baseAmount: 100000,
        tdsRate: 1 // 1% for 194C
      });

      expect(tdsDoc.id).toBeDefined();
      expect(tdsDoc.tdsAmount).toBe(1000); // 1% of 1,00,000

      const reg = await gstReturns.getTdsRegister(companyId);
      expect(reg.length).toBeGreaterThanOrEqual(1);
      expect(reg.some(r => r.partyName === 'Apex Labour Contractors')).toBe(true);
    });
  });
});
