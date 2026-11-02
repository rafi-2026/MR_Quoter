import { describe, it, expect } from 'vitest';
const {
  roundFeetFromMm,
  evalExpr,
  calculateItem,
  quoteTotals,
  getDefaultCostingSettings,
  getDefaultGlassTypes,
  getDefaultMeshTypes,
  getDefaultHandleTypes,
  getSeedTemplates
} = require('../../costing-engine');

describe('Costing Engine - Section 9 Acceptance Tests', () => {
  const settings = getDefaultCostingSettings();
  const rates = {
    glass: getDefaultGlassTypes(),
    mesh: getDefaultMeshTypes(),
    handle: getDefaultHandleTypes()
  };
  const templates = getSeedTemplates();

  it('Test 1: 2.5T 2P Sliding Window 10x6 with 6mm Toughened and SS Mesh', () => {
    const tpl = templates.find(t => t.id === 'tpl_sliding_window');
    const glass = rates.glass.find(g => g.name === '6mm Toughened');
    const res = calculateItem(tpl, tpl.lines, 10, 6, { glass_id: glass.id, mesh: 'SS Mesh' }, settings, rates);

    expect(res.priceExTax).toBe(35803);
    expect(res.ratePerSqft).toBe(597);

    // Verify intermediate values from spec
    const lineMap = {};
    res.lines.forEach(l => { lineMap[l.description] = l.amount; });

    expect(lineMap['Outer Frame Top']).toBeCloseTo(1950.72, 1);
    expect(lineMap['Outer Frame Bottom']).toBeCloseTo(1950.72, 1);
    expect(lineMap['Outer Frame Verticals']).toBeCloseTo(2340.86, 1);
    expect(lineMap['Sliding Sash Both Side']).toBeCloseTo(2377.44, 1);
    expect(lineMap['Sliding Sash One Side']).toBeCloseTo(2852.93, 1);
    expect(lineMap['Interlock']).toBeCloseTo(640.08, 1);
    expect(lineMap['Mesh Sash']).toBeCloseTo(4114.80, 1);
    expect(lineMap['Glazing Gasket for Shutter']).toBeCloseTo(270.66, 1);
    expect(lineMap['Brush Seal Shutter Frame']).toBeCloseTo(156.06, 1);
    expect(lineMap['Rollers']).toBe(180);
    expect(lineMap['Touch Lock']).toBe(90);
    expect(lineMap['Labour']).toBeCloseTo(2787.09, 1);
    expect(lineMap['Glass']).toBeCloseTo(4738.06, 1);
    expect(lineMap['SS Mesh']).toBeCloseTo(808.26, 1);

    expect(res.subtotal).toBeCloseTo(25257.67, 1);
    expect(res.wastage).toBeCloseTo(1262.88, 1);
    expect(res.totalCost).toBeCloseTo(26520.56, 1);
    expect(res.margin).toBe(9282);
  });

  it('Test 2: 2.5T 2P Sliding Window 9x6 with 6mm Toughened and SS Mesh', () => {
    const tpl = templates.find(t => t.id === 'tpl_sliding_window');
    const glass = rates.glass.find(g => g.name === '6mm Toughened');
    const res = calculateItem(tpl, tpl.lines, 9, 6, { glass_id: glass.id, mesh: 'SS Mesh' }, settings, rates);

    expect(res.ratePerSqft).toBe(613);
    expect(Math.abs(res.priceExTax - 33110)).toBeLessThanOrEqual(2);
  });

  it('Test 3: 2.5T 2P Sliding Door 8x8 with 8mm Toughened Clear and SS Mesh', () => {
    const tpl = templates.find(t => t.id === 'tpl_sliding_door');
    const glass = rates.glass.find(g => g.name === '8mm Toughened Clear');
    const res = calculateItem(tpl, tpl.lines, 8, 8, { glass_id: glass.id, mesh: 'SS Mesh' }, settings, rates);

    expect(res.priceExTax).toBe(39898);
    expect(res.ratePerSqft).toBe(623);
  });

  it('Test 4: Fixed Window 10x8 with 6mm Toughened and NA Mesh', () => {
    const tpl = templates.find(t => t.id === 'tpl_fixed_window');
    const glass = rates.glass.find(g => g.name === '6mm Toughened');
    const res = calculateItem(tpl, tpl.lines, 10, 8, { glass_id: glass.id, mesh: 'NA' }, settings, rates);

    expect(res.priceExTax).toBe(26406);
    expect(res.ratePerSqft).toBe(330);
  });

  it('Test 5: Ventilator 3.5x2 with 4mm Frosted and NA Mesh', () => {
    const tpl = templates.find(t => t.id === 'tpl_ventilator');
    const glass = rates.glass.find(g => g.name === '4mm Frosted');
    const res = calculateItem(tpl, tpl.lines, 3.5, 2, { glass_id: glass.id, mesh: 'NA' }, settings, rates);

    expect(res.ratePerSqft).toBe(547);
    expect(Math.abs(res.priceExTax - 3826)).toBeLessThanOrEqual(10);
  });

  it('MM to Feet Rounding Test (Spec Section 1.3 & 9)', () => {
    const mmCases = [
      [3000, 10],
      [1850, 6],
      [1200, 4],
      [2450, 8],
      [2150, 7],
      [4500, 15],
      [2100, 7],
      [2350, 8]
    ];
    mmCases.forEach(([mm, expectedFeet]) => {
      expect(roundFeetFromMm(mm)).toBe(expectedFeet);
    });
  });

  it('Quote Totals Test (CTPL-252 Verification)', () => {
    const items = [
      { qty: 18, area_sqft: 472, total_price: 1311794 }
    ];
    const totals = quoteTotals(items, 16000, 18);

    expect(totals.totalQty).toBe(18);
    expect(totals.totalArea).toBe(472);
    expect(totals.totalPrice).toBe(1311794);
    expect(totals.avgRate).toBe(2779); // 1311794 / 472 = 2779.22
    expect(totals.totalExGst).toBe(1327794);
    expect(totals.totalInclGst).toBeCloseTo(1327794 * 1.18, 0);
  });
});
