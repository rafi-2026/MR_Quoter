import { describe, it, expect } from 'vitest';
import {
  calculateMeasurementRowQty,
  compileMeasurementAbstract,
  generateVariationStatement,
  validateBilledQuantityAgainstApproved,
  generateMeasurementSheetPdf
} from '../../measurement.js';
import {
  calculateRaBillLine,
  calculateRaBillSummary
} from '../../rabill.js';

describe('Phase 3: Measurement Sheet (M-Sheet) & Variation Statement', () => {
  it('correctly calculates L x B x H and deducts openings', () => {
    // 2D Area calculation with deduction: 2 nos x 10 length x 12 breadth - 24 deduction = 216
    const row2D = calculateMeasurementRowQty({
      nos: 2,
      length: 10,
      breadth: 12,
      height: 0,
      deduction: 24
    });
    expect(row2D.rawQty).toBe(240);
    expect(row2D.finalQty).toBe(216);

    // 3D Volume calculation: 1 no x 10 length x 2 breadth x 3 height = 60
    const row3D = calculateMeasurementRowQty({
      nos: 1,
      length: 10,
      breadth: 2,
      height: 3,
      deduction: 5
    });
    expect(row3D.rawQty).toBe(60);
    expect(row3D.finalQty).toBe(55);

    // Running length (rft): 4 nos x 15 length = 60
    const rowRunning = calculateMeasurementRowQty({
      nos: 4,
      length: 15,
      breadth: 0,
      height: 0,
      deduction: 0
    });
    expect(rowRunning.rawQty).toBe(60);
    expect(rowRunning.finalQty).toBe(60);
  });

  it('compiles abstract of quantities grouped by item', () => {
    const rows = [
      { itemId: 'item_alu_part', itemDesc: 'Aluminium Partition', uom: 'sqft', location: 'Cabin 1', nos: 1, length: 10, breadth: 10, deduction: 0 },
      { itemId: 'item_alu_part', itemDesc: 'Aluminium Partition', uom: 'sqft', location: 'Cabin 2', nos: 1, length: 15, breadth: 10, deduction: 10 },
      { itemId: 'item_glass_door', itemDesc: '12mm Toughened Glass Door', uom: 'sqft', location: 'Main Entrance', nos: 2, length: 7, breadth: 3, deduction: 0 }
    ];

    const abstracts = compileMeasurementAbstract(rows);
    expect(abstracts.length).toBe(2);

    const part = abstracts.find(a => a.itemId === 'item_alu_part');
    expect(part).toBeDefined();
    // 10*10 = 100, + (15*10 - 10) = 140 -> 240
    expect(part.totalQty).toBe(240);
    expect(part.rowCount).toBe(2);

    const door = abstracts.find(a => a.itemId === 'item_glass_door');
    expect(door).toBeDefined();
    // 2 * 7 * 3 = 42
    expect(door.totalQty).toBe(42);
    expect(door.rowCount).toBe(1);
  });

  it('generates line-by-line variation statement and flags excess beyond PO', () => {
    const quotedLines = [
      { id: 'item_1', name: 'False Ceiling', qty: 1000, poQty: 1000, rate: 120, unit: 'sqft' },
      { id: 'item_2', name: 'Modular Workstation', qty: 20, poQty: 20, rate: 8500, unit: 'nos' }
    ];

    const measuredAbstract = [
      { itemId: 'item_1', totalQty: 1150 }, // 150 excess (+15%)
      { itemId: 'item_2', totalQty: 18 }    // 2 short (-10%)
    ];

    const prevBilledMap = { item_1: 500, item_2: 10 };
    const variation = generateVariationStatement(quotedLines, measuredAbstract, prevBilledMap);

    expect(variation.length).toBe(2);

    const ceil = variation.find(v => v.itemId === 'item_1');
    expect(ceil.varianceQty).toBe(150);
    expect(ceil.variancePct).toBe(15);
    expect(ceil.varianceAmount).toBe(150 * 120);
    expect(ceil.isExcess).toBe(true);
    expect(ceil.needsVariationOrder).toBe(true);

    const ws = variation.find(v => v.itemId === 'item_2');
    expect(ws.varianceQty).toBe(-2);
    expect(ws.variancePct).toBe(-10);
    expect(ws.isShort).toBe(true);
    expect(ws.needsVariationOrder).toBe(false);
  });

  it('hard control blocks billing excess without approved variation order', () => {
    // Attempting 150 units when previously billed was 900 and approved PO was 1000 (total = 1050 > 1000)
    const check1 = validateBilledQuantityAgainstApproved('Acoustic Panelling', 150, 900, 1000);
    expect(check1.allowed).toBe(false);
    expect(check1.excessQty).toBe(50);
    expect(check1.reason).toContain('exceeds approved quantity');

    // Attempting 80 units when previously billed was 900 and approved PO was 1000 (total = 980 <= 1000)
    const check2 = validateBilledQuantityAgainstApproved('Acoustic Panelling', 80, 900, 1000);
    expect(check2.allowed).toBe(true);
  });

  it('generates a formatted measurement sheet annexure PDF', async () => {
    const mSheet = {
      sheetNo: 'MS-2026-001',
      date: '2026-11-18',
      status: 'verified',
      preparedBy: 'Er. Rajesh Kumar',
      checkedBy: 'PM Sundararajan',
      clientRep: 'Mr. Arvind (Client)',
      rows: [
        { location: 'Ground Floor Lobby', itemDesc: 'Vitrified Tile Flooring', nos: 1, length: 40, breadth: 25, deduction: 50, uom: 'sqft' },
        { location: '1st Floor Office', itemDesc: 'Gypsum False Ceiling', nos: 2, length: 20, breadth: 15, deduction: 0, uom: 'sqft' }
      ]
    };

    const pdfBuffer = await generateMeasurementSheetPdf(mSheet, {
      no: 'CTBI/26-27/0005',
      customerName: 'Tech Mahindra Ltd',
      site: 'Sholinganallur Tech Park, Chennai'
    }, { company: 'CleanTech Building Solutions' });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(5000);
  });
});

describe('Phase 3: Contractor Running Account (RA) Bill Calculations', () => {
  it('accurately calculates 3-column progress values (Previous, This Bill, Cumulative)', () => {
    const line = { id: 'it_1', name: 'Painting Works', unit: 'sqft', rate: 45 };
    const res = calculateRaBillLine(line, 1000, 500);

    expect(res.previous.qty).toBe(1000);
    expect(res.previous.amount).toBe(45000);

    expect(res.thisBill.qty).toBe(500);
    expect(res.thisBill.amount).toBe(22500);

    expect(res.cumulative.qty).toBe(1500);
    expect(res.cumulative.amount).toBe(67500);
  });

  it('accurately computes gross, contractor deductions, taxes, and net payable', () => {
    const lines = [
      { id: 'it_1', name: 'Civil Works', unit: 'sqft', rate: 200, prevQty: 1000, currentQty: 500 } // prev: 2,00,000 | this: 1,00,000 | cum: 3,00,000
    ];

    const summary = calculateRaBillSummary({
      lines,
      advanceRecoveryPct: 10,   // 10% of 1,00,000 = 10,000
      retentionPct: 5,          // 5% of 1,00,000 = 5,000
      tdsSection: '194C_CO',    // 2% of 1,00,000 = 2,000
      labourCessPct: 1,         // 1% of 1,00,000 = 1,000
      otherDeductions: 500,     // 500
      gstRate: 18,              // 18% of 1,00,000 = 18,000 (9k CGST, 9k SGST)
      isInterState: false
    });

    expect(summary.gross.previousBillAmount).toBe(200000);
    expect(summary.gross.thisBillAmount).toBe(100000);
    expect(summary.gross.cumulativeAmount).toBe(300000);

    expect(summary.deductions.advanceAdjustment).toBe(10000);
    expect(summary.deductions.retentionAmount).toBe(5000);
    expect(summary.deductions.tdsAmount).toBe(2000);
    expect(summary.deductions.labourCess).toBe(1000);
    expect(summary.deductions.totalDeductions).toBe(18500);

    expect(summary.taxes.totalTax).toBe(18000);
    expect(summary.taxes.cgst).toBe(9000);
    expect(summary.taxes.sgst).toBe(9000);

    // Net Payable = Gross (100000) + Tax (18000) - Deductions (18500) = 99500
    expect(summary.netPayable).toBe(99500);
  });
});
