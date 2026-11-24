'use strict';
import { describe, it, expect } from 'vitest';
import { generateDeliveryChallanPdf, getPendingDeliveryQuantities } from '../../challan.js';
import { generateOfficialEwayBillJson, validateEwayBillPrerequisites, calculateValidityDays, estimateDistanceKm } from '../../ewaybill.js';
import { createDocument, updateDocument } from '../../documents.js';

describe('Phase 2: Delivery Challan & E-Way Bill Engine', () => {

  const sampleDoc = {
    id: 'dc_test_001',
    no: 'CTBD/26-27/0001',
    date: '2026-11-18',
    docType: 'dc',
    subject: 'Supply of Domal 27 Sliding Windows & Toughened Glass for Site',
    cust: {
      name: 'Bismillah Project',
      address: '108 Site Avenue, Hosur',
      gstin: '33AAACT9999Q1Z9',
      pincode: '635109'
    },
    site: 'Tower B, Hosur',
    metadata: {
      challanPurpose: 'supply_of_goods',
      vehicleNo: 'TN01AB1234',
      transporterName: 'VRL Logistics',
      lrNo: 'LR-998877'
    },
    lines: [
      { name: 'Aluminium Sliding Window 3-Track', hsn: '7610', qty: 4, unit: 'sqft', rate: 1200, taxable: 4800, total: 5664 },
      { name: '12mm Toughened Glass Door', hsn: '7007', qty: 2, unit: 'nos', rate: 8500, taxable: 17000, total: 20060 }
    ],
    totals: {
      subtotal: 21800,
      taxable: 21800,
      cgst: 1962,
      sgst: 1962,
      igst: 0,
      totalTax: 3924,
      grandTotal: 25724
    }
  };

  const sampleSettings = {
    company: 'CRESCENT TECHNOBUILD PVT LTD',
    gstin: '33AAICC1673Q1Z9',
    address1: 'Bagalur Road',
    city: 'Hosur',
    state: 'Tamil Nadu',
    pincode: '635109'
  };

  it('generates non-empty Delivery Challan PDF in WITH VALUE mode with subject (> 10 KB)', async () => {
    const pdfBuf = await generateDeliveryChallanPdf(sampleDoc, sampleSettings, true);
    expect(pdfBuf).toBeInstanceOf(Buffer);
    expect(pdfBuf.length).toBeGreaterThan(10000);
    expect(pdfBuf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('generates non-empty Delivery Challan PDF in WITHOUT VALUE mode (> 10 KB) with same number', async () => {
    const pdfBuf = await generateDeliveryChallanPdf(sampleDoc, sampleSettings, false);
    expect(pdfBuf).toBeInstanceOf(Buffer);
    expect(pdfBuf.length).toBeGreaterThan(10000);
    expect(pdfBuf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('persists and updates document subject field cleanly', async () => {
    const doc = await createDocument({
      companyId: 'test_subj_co',
      companyCode: 'SUBJ',
      docType: 'dc',
      subject: 'Supply of Curtain Wall Mullions & Transoms',
      cust: { name: 'Prestige Group' },
      lines: [{ name: 'Profile 5045', qty: 10, rate: 800 }]
    });

    expect(doc.subject).toBe('Supply of Curtain Wall Mullions & Transoms');

    const updated = await updateDocument(doc.id, {
      subject: 'Revised Supply of Curtain Wall Mullions Phase 2'
    });
    expect(updated.subject).toBe('Revised Supply of Curtain Wall Mullions Phase 2');
  });

  it('validates and generates official NIC E-Way Bill JSON', () => {
    const transport = {
      vehicleNo: 'TN01AB1234',
      transporterId: '33AAACL1234A1Z1',
      transporterName: 'Express Logistics',
      toPincode: '635109',
      distanceKm: 45
    };

    const ewb = generateOfficialEwayBillJson(sampleDoc, transport, sampleSettings);
    expect(ewb.payload).toBeDefined();
    expect(ewb.payload.version).toBe('1.0.0421');
    expect(ewb.payload.billLists.length).toBe(1);

    const bill = ewb.payload.billLists[0];
    expect(bill.docNo).toBe('CTBD/26-27/0001');
    expect(bill.docNo.length).toBeLessThanOrEqual(16);
    expect(bill.fromGstin).toBe(sampleSettings.gstin);
    expect(bill.toGstin).toBe(sampleDoc.cust.gstin);
    expect(bill.vehicleNo).toBe('TN01AB1234');
    expect(bill.itemList.length).toBe(2);
    expect(bill.itemList[0].hsnCode).toBe(7610);
  });

  it('calculates E-Way Bill validity based on 200 km/day rule', () => {
    expect(calculateValidityDays(50)).toBe(1);
    expect(calculateValidityDays(200)).toBe(1);
    expect(calculateValidityDays(201)).toBe(2);
    expect(calculateValidityDays(450)).toBe(3);
  });

  it('validates e-way bill prerequisites and flags errors for invalid doc numbers', () => {
    const invalidDoc = { ...sampleDoc, no: 'TOO-LONG-INVOICE-NUMBER-EXCEEDING-16-CHARS' };
    const res = validateEwayBillPrerequisites(invalidDoc, {}, sampleSettings);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('exceeds 16'))).toBe(true);
  });

});
