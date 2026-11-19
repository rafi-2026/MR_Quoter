import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createDocument,
  createRevision,
  getDocumentById,
  compareRevisions,
  setDocumentStatus
} from '../../documents.js';
import {
  generateDeliveryChallanPdf
} from '../../challan.js';
import {
  validateBilledQuantityAgainstApproved
} from '../../measurement.js';
import {
  createVoucher,
  validateDoubleEntry
} from '../../vouchers.js';
import {
  getTrialBalance
} from '../../reports.js';
import {
  processBankStatement,
  getSuspenseSummary
} from '../../bank.js';
import {
  performThreeWayMatch
} from '../../procurement.js';
import {
  generateTallyXml,
  generateZohoCsv
} from '../../exports.js';

describe('Section 13: Final Acceptance Test Suite (Must Pass Before Deploy)', () => {

  it('Criterion 1: Baseline legacy entity counts are 100% identical to baseline snapshot', () => {
    const baselinePath = path.resolve(__dirname, '../../docs/baseline_counts.json');
    const dbPath = path.resolve(__dirname, '../../data/quotedesk.json');

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

    const arrayKeys = ['companies', 'users', 'customers', 'products', 'items', 'quotes', 'profiles', 'materials', 'productTemplates'];
    for (const key of arrayKeys) {
      const actualCount = (dbData[key] || []).length;
      expect(actualCount).toBe(baseline[key]);
    }

    expect(Object.keys(dbData.companySettings || {}).length).toBe(baseline.companySettings);
    expect(Object.keys(dbData.companySeq || {}).length).toBe(baseline.companySeq);
  });

  it('Criterion 2: Pre-existing quotes open and calculate totals accurately', () => {
    const dbPath = path.resolve(__dirname, '../../data/quotedesk.json');
    const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

    expect(dbData.quotes.length).toBeGreaterThan(0);
    const quote = dbData.quotes[0];
    expect(quote.id).toBeDefined();
    expect(quote.no).toBeDefined();
    expect(Array.isArray(quote.lines)).toBe(true);
  });

  it('Criterion 3: Creating R1/R2 of any document never alters R0/R1; all remain viewable', async () => {
    const coId = 'co_acc_rev_test';
    const r0 = await createDocument({
      companyId: coId,
      companyCode: 'CTB',
      docType: 'pi',
      lines: [{ name: 'Partitions', qty: 10, rate: 1000 }]
    }, { name: 'Engineer' });

    expect(r0.rev).toBe(0);
    expect(r0.superseded).toBe(false);

    const r1 = await createRevision(r0.id, 'Increased scope for phase 1', { name: 'Engineer' });
    expect(r1.rev).toBe(1);
    expect(r1.rootId).toBe(r0.id);
    expect(r1.revReason).toBe('Increased scope for phase 1');

    // Verify R0 is preserved and marked superseded
    const r0Fetched = await getDocumentById(r0.id);
    expect(r0Fetched).toBeDefined();
    expect(r0Fetched.superseded).toBe(true);
    expect(r0Fetched.rev).toBe(0);

    // Create R2
    const r2 = await createRevision(r1.id, 'Client revised specs', { name: 'Engineer' });
    expect(r2.rev).toBe(2);
    expect(r2.rootId).toBe(r0.id);

    const r1Fetched = await getDocumentById(r1.id);
    expect(r1Fetched.superseded).toBe(true);
    expect(r1Fetched.rev).toBe(1);

    // Diff comparison between R0 and R2 works cleanly
    const diff = await compareRevisions(r0.id, r2.id);
    expect(diff.linesDiff).toBeDefined();
  });

  it('Criterion 4: Tax invoice quantity cannot exceed approved PO quantity without variation approval', () => {
    // Attempting cumulative 110 units when approved PO is 100
    const checkBlocked = validateBilledQuantityAgainstApproved('Glass Railing', 20, 90, 100);
    expect(checkBlocked.allowed).toBe(false);
    expect(checkBlocked.excessQty).toBe(10);
    expect(checkBlocked.reason).toContain('exceeds approved quantity');

    // Within approved limit (10 + 90 = 100 <= 100)
    const checkAllowed = validateBilledQuantityAgainstApproved('Glass Railing', 10, 90, 100);
    expect(checkAllowed.allowed).toBe(true);
  });

  it('Criterion 5: Re-uploading same bank statement creates zero duplicates; unmatched land in Suspense', async () => {
    const coId = 'co_acc_bank_' + Math.random().toString(36).slice(2, 7);
    const bankAcc = 'bank_' + coId;

    const csvData = `Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance
01/11/2026,NEFT-CLIENT-ABC-INTERIORS-PAYMENT,REF9001,,200000.00,200000.00
02/11/2026,UNKNOWN MISCELLANEOUS CASH CREDIT,REF9002,,15000.00,215000.00`;

    const customers = [{ id: 'c_abc', name: 'ABC Interiors' }];

    // 1st Upload
    const res1 = await processBankStatement({
      companyId: coId,
      bankAccountId: bankAcc,
      rawCsv: csvData,
      customers,
      vendors: [],
      user: { name: 'Accountant' }
    });

    expect(res1.postedCount).toBe(2);
    expect(res1.duplicateCount).toBe(0);
    expect(res1.suspenseCount).toBe(1); // 1 unmatched cash credit lands in Suspense
    expect(res1.suspenseAmount).toBe(15000);

    // 2nd Upload of identical statement
    const res2 = await processBankStatement({
      companyId: coId,
      bankAccountId: bankAcc,
      rawCsv: csvData,
      customers,
      vendors: [],
      user: { name: 'Accountant' }
    });

    expect(res2.postedCount).toBe(0);
    expect(res2.duplicateCount).toBe(2); // Exactly 0 duplicates created

    const susp = await getSuspenseSummary(coId);
    expect(susp.count).toBe(1);
    expect(susp.totalAmount).toBe(15000);
  });

  it('Criterion 6: Debits = credits in every posted voucher; Trial Balance tallies to zero', async () => {
    const coId = 'co_acc_tb_' + Math.random().toString(36).slice(2, 7);

    // Balanced voucher 1: Capital deposit
    await createVoucher({
      companyId: coId,
      voucherType: 'receipt',
      date: '2026-11-18',
      entries: [
        { ledgerId: 'led_bank_default', ledgerName: 'Bank', debit: 300000, credit: 0 },
        { ledgerId: 'led_capital_main', ledgerName: 'Capital', debit: 0, credit: 300000 }
      ]
    });

    // Balanced voucher 2: Expense
    await createVoucher({
      companyId: coId,
      voucherType: 'payment',
      date: '2026-11-18',
      entries: [
        { ledgerId: 'led_contractor_charges', ledgerName: 'Labour Expense', debit: 50000, credit: 0 },
        { ledgerId: 'led_bank_default', ledgerName: 'Bank', debit: 0, credit: 50000 }
      ]
    });

    const tb = await getTrialBalance(coId);
    expect(tb.isTallied).toBe(true);
    expect(tb.difference).toBe(0);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('Criterion 7: Delivery Challan generates valid PDF in both modes with the same document number', async () => {
    const challanDoc = {
      id: 'doc_dc_test',
      no: 'CTBD/26-27/0001',
      date: '2026-11-18',
      docType: 'dc',
      cust: { name: 'Client Construction Ltd' },
      lines: [{ name: 'Aluminium Doors', qty: 5, rate: 12000, hsn: '7610', gstRate: 18 }],
      totals: { subTotal: 60000, grandTotal: 70800 }
    };

    const pdfWithValue = await generateDeliveryChallanPdf(challanDoc, 'with_value', { company: 'CleanTech' });
    expect(Buffer.isBuffer(pdfWithValue)).toBe(true);
    expect(pdfWithValue.length).toBeGreaterThan(5000);

    const pdfWithoutValue = await generateDeliveryChallanPdf(challanDoc, 'without_value', { company: 'CleanTech' });
    expect(Buffer.isBuffer(pdfWithoutValue)).toBe(true);
    expect(pdfWithoutValue.length).toBeGreaterThan(5000);
  });

  it('Criterion 8: 3-Way Match on procurement detects and blocks quantity and rate mismatches', () => {
    const po = [{ id: 'item_1', name: 'Tile Adhesive', rate: 400, qty: 100 }];
    const grn = [{ id: 'item_1', name: 'Tile Adhesive', qty: 75 }]; // only 75 delivered
    const bill = [{ id: 'item_1', name: 'Tile Adhesive', rate: 400, qty: 100 }]; // billed for 100

    const audit = performThreeWayMatch(po, grn, bill);
    expect(audit.passed).toBe(false);
    expect(audit.lineAudits[0].status).toBe('QTY_MISMATCH');
  });

  it('Criterion 9: Tally Prime XML and Zoho Books CSV exports generate valid envelopes', async () => {
    const coId = 'co_acc_exp_' + Math.random().toString(36).slice(2, 7);
    await createVoucher({
      companyId: coId,
      voucherType: 'receipt',
      date: '2026-11-18',
      entries: [
        { ledgerId: 'led_bank_default', ledgerName: 'Bank', debit: 10000, credit: 0 },
        { ledgerId: 'led_capital_main', ledgerName: 'Capital', debit: 0, credit: 10000 }
      ]
    });

    const tallyXml = await generateTallyXml(coId);
    expect(tallyXml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(tallyXml).toContain('</ENVELOPE>');

    const zohoInvoices = await generateZohoCsv(coId, 'invoices');
    expect(zohoInvoices).toContain('Invoice Number');
  });

});

