import { describe, it, expect } from 'vitest';
import { generateTallyXml, generateZohoCsv } from '../../exports.js';
import { createVoucher } from '../../vouchers.js';
import { createDocument } from '../../documents.js';

describe('Phase 7: Tally Prime XML & Zoho Books CSV Export Suite', () => {
  it('generates valid Tally Prime import XML with ledger and voucher envelopes', async () => {
    const coId = 'co_tally_test_' + Math.random().toString(36).slice(2, 7);

    // Create a sample voucher
    await createVoucher({
      companyId: coId,
      voucherType: 'receipt',
      date: '2026-11-18',
      narration: 'Receipt from customer',
      entries: [
        { ledgerId: 'led_bank_default', ledgerName: 'Bank Account', debit: 25000, credit: 0 },
        { ledgerId: 'led_cust_1', ledgerName: 'Customer X', debit: 0, credit: 25000 }
      ]
    });

    const xml = await generateTallyXml(coId);
    expect(typeof xml).toBe('string');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<ENVELOPE>');
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<VOUCHER VCHTYPE="Receipt"');
    expect(xml).toContain('<DATE>20261118</DATE>');
    expect(xml).toContain('<ALLLEDGERENTRIES.LIST>');
    expect(xml).toContain('<LEDGERNAME>Bank Account</LEDGERNAME>');
    expect(xml).toContain('<AMOUNT>-25000.00</AMOUNT>');
    expect(xml).toContain('</ENVELOPE>');
  });

  it('generates compliant Zoho Books CSV for invoices and customers', async () => {
    const coId = 'co_zoho_test_' + Math.random().toString(36).slice(2, 7);

    // Create an invoice
    await createDocument({
      companyId: coId,
      docType: 'inv',
      lines: [{ name: 'Modular Workstations', qty: 10, rate: 5000 }]
    });

    const invCsv = await generateZohoCsv(coId, 'invoices');
    expect(invCsv).toContain('"Invoice Number","Customer Name","Invoice Date"');
    expect(invCsv).toContain('Modular Workstations');

    const coaCsv = await generateZohoCsv(coId, 'chart_of_accounts');
    expect(coaCsv).toContain('"Account Name","Account Code"');
    expect(coaCsv).toContain('Cash in Hand');
  });
});

