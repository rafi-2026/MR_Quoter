import { describe, it, expect } from 'vitest';
import {
  computeTxnHash,
  parseBankStatement,
  matchTransactionToParty,
  processBankStatement,
  resolveSuspenseTransaction,
  getSuspenseSummary
} from '../../bank.js';

describe('Phase 5: Bank Statement Parser & Duplicate Protection', () => {
  it('correctly parses standard Indian bank CSV format', () => {
    const csv = `
Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance
01/11/2026,NEFT-CMS12345678-TECH MAHINDRA LTD-PAYMENT,CMS12345678,,150000.00,450000.00
02/11/2026,UPI-GLASSCORP-MATERIALS-TXN9988,UPI9988,25000.00,,425000.00
03/11/2026,BANK CHARGES FOR SMS ALERTS,CHG001,59.00,,424941.00
`;
    const rows = parseBankStatement(csv);
    expect(rows.length).toBe(3);

    // Row 1: Credit 1,50,000
    expect(rows[0].date).toBe('2026-11-01');
    expect(rows[0].credit).toBe(150000);
    expect(rows[0].debit).toBe(0);
    expect(rows[0].type).toBe('credit');
    expect(rows[0].ref).toBe('CMS12345678');

    // Row 2: Debit 25,000
    expect(rows[1].date).toBe('2026-11-02');
    expect(rows[1].debit).toBe(25000);
    expect(rows[1].credit).toBe(0);
    expect(rows[1].type).toBe('debit');

    // Row 3: Debit 59
    expect(rows[2].debit).toBe(59);
  });

  it('generates consistent deterministic hashes for duplicate detection', () => {
    const h1 = computeTxnHash('bank_1', '2026-11-01', 150000, 'credit', 'CMS1234', 'TECH MAHINDRA');
    const h2 = computeTxnHash('bank_1', '2026-11-01', 150000, 'credit', 'CMS1234', 'TECH MAHINDRA');
    const h3 = computeTxnHash('bank_1', '2026-11-02', 150000, 'credit', 'CMS1234', 'TECH MAHINDRA');

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('Phase 5: Fuzzy Party Matching & Suspense Account Engine', () => {
  const mockCustomers = [
    { id: 'c_tm', name: 'Tech Mahindra Ltd', aliases: ['Tech M', 'TechMahindra'] },
    { id: 'c_dlf', name: 'DLF Cybercity Developers' }
  ];

  const mockVendors = [
    { id: 'v_saint', name: 'Saint Gobain Glass India Pvt Ltd', aliases: ['Saint Gobain', 'SG Glass'] }
  ];

  it('matches customer name and aliases with high confidence', () => {
    // Exact alias match
    const res1 = matchTransactionToParty({
      narration: 'NEFT CR FROM TECH MAHINDRA LTD INV 401',
      ref: 'UTR9988',
      type: 'credit'
    }, mockCustomers, mockVendors);

    expect(res1.matched).toBe(true);
    expect(res1.partyId).toBe('c_tm');
    expect(res1.ledgerId).toBe('led_cust_c_tm');
    expect(res1.confidence).toBeGreaterThanOrEqual(90);

    // Vendor alias match
    const res2 = matchTransactionToParty({
      narration: 'RTGS PAYMENT TO SAINT GOBAIN GLASS',
      ref: 'UTR7711',
      type: 'debit'
    }, mockCustomers, mockVendors);

    expect(res2.matched).toBe(true);
    expect(res2.partyId).toBe('v_saint');
    expect(res2.ledgerId).toBe('led_vend_v_saint');
  });

  it('routes unmatched transactions to Suspense Account with mandatory reason', () => {
    const res = matchTransactionToParty({
      narration: 'UPI-9876543210@OKAXIS-UNKNOWN DEPOSIT',
      ref: 'UPI8899',
      type: 'credit'
    }, mockCustomers, mockVendors);

    expect(res.matched).toBe(false);
    expect(res.ledgerId).toBe('led_suspense');
    expect(res.confidence).toBe(0);
    expect(res.suspenseReason).toContain('Customer could not be identified');
  });

  it('processes statement, skips duplicates on re-upload, and tracks suspense items', async () => {
    const coId = 'co_bank_test_' + Math.random().toString(36).slice(2, 7);

    const csvData = `
Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance
01/11/2026,NEFT-TECH MAHINDRA LTD-PAYMENT,REF001,,100000.00,100000.00
02/11/2026,UNKNOWN CASH DEPOSIT AT BRANCH,CASH01,,50000.00,150000.00
`;

    // 1st Upload
    const result1 = await processBankStatement({
      companyId: coId,
      bankAccountId: 'bank_' + coId,
      rawCsv: csvData,
      customers: mockCustomers,
      vendors: mockVendors,
      user: { name: 'Bank Clerk' }
    });

    expect(result1.postedCount).toBe(2);
    expect(result1.duplicateCount).toBe(0);
    expect(result1.suspenseCount).toBe(1); // 1 unmatched cash deposit lands in Suspense
    expect(result1.suspenseAmount).toBe(50000);

    // 2nd Upload of identical statement: duplicate protection MUST skip both
    const result2 = await processBankStatement({
      companyId: coId,
      bankAccountId: 'bank_' + coId,
      rawCsv: csvData,
      customers: mockCustomers,
      vendors: mockVendors,
      user: { name: 'Bank Clerk' }
    });

    expect(result2.postedCount).toBe(0);
    expect(result2.duplicateCount).toBe(2);

    // Verify Suspense summary metrics
    const summary = await getSuspenseSummary(coId);
    expect(summary.count).toBe(1);
    expect(summary.totalAmount).toBe(50000);
    expect(summary.items[0].narration).toContain('UNKNOWN CASH DEPOSIT');
  });

  it('resolves suspense transaction via reclassification voucher and learns keyword rule', async () => {
    const coId = 'co_resolve_test_' + Math.random().toString(36).slice(2, 7);

    const csvData = `Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance
05/11/2026,NEFT-AMEX-DLF-RENTAL-PAYMENT,REF99,,75000.00,75000.00`;

    await processBankStatement({
      companyId: coId,
      bankAccountId: 'bank_' + coId,
      rawCsv: csvData,
      customers: [], // no customers passed, so it lands in suspense
      vendors: [],
      user: { name: 'Accountant' }
    });

    const summaryBefore = await getSuspenseSummary(coId);
    expect(summaryBefore.count).toBe(1);
    const txnToResolve = summaryBefore.items[0];

    // Resolve suspense and check "Remember Rule"
    const resolveResult = await resolveSuspenseTransaction(txnToResolve.id, {
      targetLedgerId: 'led_cust_c_dlf',
      targetLedgerName: 'DLF Cybercity Developers',
      targetPartyId: 'c_dlf',
      targetPartyName: 'DLF Cybercity Developers',
      rememberRule: true,
      keyword: 'DLF-RENTAL'
    }, { name: 'Chief Accountant' });

    expect(resolveResult.ok).toBe(true);
    expect(resolveResult.reclassVoucherNo).toBeDefined();

    // Verify suspense count is now 0
    const summaryAfter = await getSuspenseSummary(coId);
    expect(summaryAfter.count).toBe(0);
    expect(summaryAfter.totalAmount).toBe(0);

    // Upload another transaction with the learned keyword: should now match automatically!
    const csvNext = `Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance
10/11/2026,NEFT-NEW-DLF-RENTAL-PAYMENT-2,REF100,,80000.00,80000.00`;

    const resNext = await processBankStatement({
      companyId: coId,
      bankAccountId: 'bank_' + coId,
      rawCsv: csvNext,
      customers: [],
      vendors: [],
      user: { name: 'Accountant' }
    });

    expect(resNext.postedCount).toBe(1);
    expect(resNext.suspenseCount).toBe(0); // Learned rule matched!
  });
});
