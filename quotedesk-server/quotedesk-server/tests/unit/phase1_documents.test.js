'use strict';
import { describe, it, expect } from 'vitest';
import { createDocument, createRevision, getRevisionHistory, compareRevisions, setDocumentStatus, calcDocTotals } from '../../documents.js';
import { formatNumber, validateDocNumber, DOC_TYPES } from '../../numbering.js';

describe('Phase 1: Universal Document Engine & Numbering Series', () => {

  it('formats statutory numbers <= 16 characters for GST compliance', () => {
    const invNo = formatNumber('CTB', 'inv', '26-27', 1);
    expect(invNo.length).toBeLessThanOrEqual(16);
    expect(invNo).toMatch(/^[A-Za-z0-9/\-]+$/);

    const dcNo = formatNumber('MRI', 'dc', '26-27', 42);
    expect(dcNo.length).toBeLessThanOrEqual(16);
    expect(dcNo).toMatch(/^[A-Za-z0-9/\-]+$/);

    expect(() => validateDocNumber('LONGCOMPANYPREFIX/INV/2026-2027/000001', 'inv')).toThrow(/max 16/);
  });

  it('correctly calculates document lines, discount, and GST totals', () => {
    const lines = [
      { name: 'Aluminium Window', qty: 2, rate: 5000, disc: 10, discType: 'pct', gstRate: 18 },
      { name: 'Glass Partition', qty: 1, rate: 10000, disc: 0, discType: 'pct', gstRate: 18 }
    ];
    const { totals } = calcDocTotals(lines, 18, false);
    // Line 1: gross 10000, disc 1000, taxable 9000, tax 1620
    // Line 2: gross 10000, disc 0, taxable 10000, tax 1800
    // Total taxable: 19000, totalTax: 3420, grandTotal: 22420
    expect(totals.subtotal).toBe(20000);
    expect(totals.discount).toBe(1000);
    expect(totals.taxable).toBe(19000);
    expect(totals.totalTax).toBe(3420);
    expect(totals.grandTotal).toBe(22420);
  });

  it('creates document with baseNo and revision 0', async () => {
    const doc = await createDocument({
      companyId: 'co_test_suite',
      companyCode: 'CTB',
      docType: 'pi',
      date: '2026-11-18',
      cust: { name: 'Test Corp' },
      lines: [{ name: 'Item A', qty: 5, rate: 1000, gstRate: 18 }]
    }, { id: 'usr_test', name: 'Tester', role: 'admin' });

    expect(doc.id).toBeDefined();
    expect(doc.rev).toBe(0);
    expect(doc.superseded).toBe(false);
    expect(doc.no).toContain('PI');
    expect(doc.totals.grandTotal).toBe(5900);
  });

  it('enforces mandatory reason when creating a revision and supersedes prior version', async () => {
    const doc = await createDocument({
      companyId: 'co_test_suite',
      companyCode: 'CTB',
      docType: 'cpo',
      cust: { name: 'Customer PO Test' },
      lines: [{ name: 'Item 1', qty: 10, rate: 200, gstRate: 18 }]
    }, { id: 'usr_test', name: 'Tester', role: 'admin' });

    // Empty reason should fail
    await expect(createRevision(doc.id, '   ', { name: 'Tester' })).rejects.toThrow(/mandatory/i);

    // Valid revision
    const rev1 = await createRevision(doc.id, 'Client revised quantity to 15', { id: 'usr_test', name: 'Tester' });
    expect(rev1.rev).toBe(1);
    expect(rev1.no).toBe(doc.baseNo + '/R1');
    expect(rev1.superseded).toBe(false);
    expect(rev1.revReason).toBe('Client revised quantity to 15');

    // Prior version should be marked superseded
    const history = await getRevisionHistory(doc.rootId);
    expect(history.length).toBe(2);
    const rev0 = history.find(h => h.rev === 0);
    expect(rev0.superseded).toBe(true);
  });

  it('prohibits revisions on issued/finalised Tax Invoices', async () => {
    const inv = await createDocument({
      companyId: 'co_test_suite',
      companyCode: 'CTB',
      docType: 'inv',
      cust: { name: 'Invoice Client' },
      lines: [{ name: 'Tax Item', qty: 1, rate: 5000 }]
    }, { id: 'usr_test', name: 'Tester' });

    await setDocumentStatus(inv.id, 'issued', 'Tax invoice officially delivered', { name: 'Tester' });
    await expect(createRevision(inv.id, 'Trying to revise', { name: 'Tester' })).rejects.toThrow(/GST regulations/);
  });

  it('accurately computes side-by-side difference between revisions', async () => {
    const docA = await createDocument({
      companyId: 'co_test_suite',
      companyCode: 'CTB',
      docType: 'pi',
      lines: [
        { name: 'Item 1', qty: 10, rate: 100, gstRate: 18 },
        { name: 'Item 2', qty: 5, rate: 200, gstRate: 18 }
      ]
    }, { id: 'usr_test', name: 'Tester' });

    const docB = await createRevision(docA.id, 'Increased Item 1 and dropped Item 2', { id: 'usr_test', name: 'Tester' });
    // Update docB lines
    const { updateDocument } = await import('../../documents.js');
    await updateDocument(docB.id, {
      lines: [
        { name: 'Item 1', qty: 14, rate: 100, gstRate: 18 },
        { name: 'Item 3 (New)', qty: 2, rate: 500, gstRate: 18 }
      ]
    }, { id: 'usr_test', name: 'Tester' });

    const diff = await compareRevisions(docA.id, docB.id);
    expect(diff.linesDiff).toBeDefined();
    expect(diff.linesDiff.length).toBeGreaterThanOrEqual(2);

    const item1Diff = diff.linesDiff.find(l => l.name === 'Item 1');
    expect(item1Diff.status).toBe('MODIFIED');
    expect(item1Diff.qtyDiff).toBe(4);

    const item2Diff = diff.linesDiff.find(l => l.name === 'Item 2');
    expect(item2Diff.status).toBe('REMOVED');
  });

  it('correctly persists and updates statutory billing, separate shipping, project code, and transport logistics', async () => {
    const doc = await createDocument({
      companyId: 'co_test_suite',
      companyCode: 'CTB',
      docType: 'inv',
      cust: {
        name: 'Head Office Corp',
        address: '100 Business Parkway',
        city: 'Chennai',
        state: 'Tamil Nadu',
        stateCode: '33',
        gstin: '33AABCT1234A1Z5',
        pan: 'AABCT1234A'
      },
      shipping: {
        name: 'Project Site Warehouse',
        address: 'Plot 45 Industrial Zone',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        stateCode: '33',
        gstin: '33AABCT1234A1Z5'
      },
      project: 'Prestige Tech Tower',
      projectCode: 'PRJ-2026-004',
      site: 'Tower B Facade Zone',
      poNo: 'PO-7842/2026',
      poDate: '2026-11-15',
      vehicleNo: 'TN-38-BZ-4512',
      ewayBillNo: '341098765432',
      ewayBillDate: '2026-11-20',
      transporter: 'VRL Logistics',
      transporterId: '29AABCV1234A1Z1',
      lrNo: 'LR-8876',
      lines: [{ name: 'Structural Glazing Panel', qty: 10, rate: 2500, gstRate: 18 }]
    }, { id: 'usr_test', name: 'Tester' });

    expect(doc.cust.name).toBe('Head Office Corp');
    expect(doc.cust.gstin).toBe('33AABCT1234A1Z5');
    expect(doc.shipping.name).toBe('Project Site Warehouse');
    expect(doc.shipping.address).toBe('Plot 45 Industrial Zone');
    expect(doc.projectCode).toBe('PRJ-2026-004');
    expect(doc.poNo).toBe('PO-7842/2026');
    expect(doc.vehicleNo).toBe('TN-38-BZ-4512');
    expect(doc.ewayBillNo).toBe('341098765432');
    expect(doc.transporter).toBe('VRL Logistics');
    expect(doc.lrNo).toBe('LR-8876');

    // Update logistics and consignee
    const { updateDocument } = await import('../../documents.js');
    const updated = await updateDocument(doc.id, {
      vehicleNo: 'TN-38-BZ-9999',
      ewayBillNo: '341098769999',
      shipping: {
        name: 'Updated Site Depot',
        address: 'Gate 2 Delivery Bay'
      }
    }, { id: 'usr_test', name: 'Tester' });

    expect(updated.vehicleNo).toBe('TN-38-BZ-9999');
    expect(updated.ewayBillNo).toBe('341098769999');
    expect(updated.shipping.name).toBe('Updated Site Depot');
    expect(updated.shipping.address).toBe('Gate 2 Delivery Bay');
    expect(updated.shipping.gstin).toBe('33AABCT1234A1Z5'); // preserved from previous
  });

});
