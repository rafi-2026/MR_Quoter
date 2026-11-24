import { describe, it, expect, beforeEach } from 'vitest';
import * as bankingPlus from '../../banking-plus.js';
import * as vouchers from '../../vouchers.js';
import * as accounts from '../../accounts.js';

describe('M6: Banking Enhancements Suite (Cheque Printing, PDC, Advice)', () => {
  const companyId = 'test_m6_company_' + Math.random().toString(36).slice(2, 7);

  beforeEach(async () => {
    await accounts.initCompanyAccounts(companyId);
  });

  describe('Cheque Printing & Number-to-Words Engine', () => {
    it('converts amounts to Indian currency words format accurately', () => {
      expect(bankingPlus.numberToWordsINR(1500)).toBe('One Thousand Five Hundred Rupees Only');
      expect(bankingPlus.numberToWordsINR(105432)).toBe('One Lakh Five Thousand Four Hundred and Thirty Two Rupees Only');
      expect(bankingPlus.numberToWordsINR(2500000)).toBe('Twenty Five Lakh Rupees Only');
      expect(bankingPlus.numberToWordsINR(0)).toBe('Zero Rupees Only');
    });

    it('calculates CTS-2010 cheque coordinates and crossing lines for banks', () => {
      const layout = bankingPlus.getChequePrintCoordinates('hdfc', {
        payeeName: 'Global Aluminium Corp',
        amount: 85000,
        date: '2026-09-15',
        acPayee: true
      });

      expect(layout.template).toBe('HDFC Bank');
      expect(layout.crossing).toContain('A/C PAYEE ONLY');
      expect(layout.payeeName).toContain('Global Aluminium Corp');
      expect(layout.amountWords).toContain('Eighty Five Thousand Rupees Only');
      expect(layout.amountNumber).toContain('85,000.00');
      expect(layout.datePos.xMm).toBeGreaterThan(140);
    });
  });

  describe('Post-Dated Cheques (PDC) Operations', () => {
    it('records and updates status of customer & vendor PDC cheques', async () => {
      // Customer Receipt PDC
      const pdc = await bankingPlus.recordPdcCheque(companyId, {
        type: 'receipt',
        chequeNo: '882341',
        chequeDate: '2026-11-30',
        bankName: 'ICICI Bank',
        partyName: 'Highrise Promoters',
        amount: 150000
      });

      expect(pdc.id).toBeDefined();
      expect(pdc.status).toBe('pending');
      expect(pdc.amountPaise).toBe(15000000);

      const list = await bankingPlus.listPdcCheques(companyId);
      expect(list.length).toBeGreaterThanOrEqual(1);

      // Clear the cheque upon bank deposit
      const updated = await bankingPlus.updatePdcStatus(companyId, pdc.id, 'cleared', 'Cleared via CTS batch 42');
      expect(updated.status).toBe('cleared');
      expect(updated.statusNotes).toContain('CTS batch 42');
    });
  });

  describe('Payment Advice Generator', () => {
    it('generates Payment Advice with settlement details', async () => {
      const pmtVoucher = await vouchers.createVoucher({
        companyId,
        voucherType: 'payment',
        date: '2026-09-20',
        partyName: 'Southern Glass Fab',
        docRef: 'UTR98234710',
        entries: [
          { ledgerId: 'led_creditors_general', debit: 45000, credit: 0 },
          { ledgerId: 'led_bank_default', debit: 0, credit: 45000 }
        ]
      });

      const advice = await bankingPlus.generatePaymentAdvice(companyId, pmtVoucher.id);
      expect(advice.voucherNo).toBe(pmtVoucher.voucherNo);
      expect(advice.totalPaid).toBe(45000);
      expect(advice.amountInWords).toContain('Forty Five Thousand Rupees Only');
      expect(advice.bankRefNo).toBe('UTR98234710');
    });
  });
});
