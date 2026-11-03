import { describe, it, expect } from 'vitest';
const { lineCalc, calcTotals } = require('../../pricing-engine');
const costingEngine = require('../../costing-engine');

describe('Phase 2 - Quote Screen Auto-Pricing & Excel Fidelity', () => {
  const templates = costingEngine.getSeedTemplates();
  const settings = costingEngine.getDefaultCostingSettings();
  const rates = {
    glass: costingEngine.getDefaultGlassTypes(),
    mesh: costingEngine.getDefaultMeshTypes(),
    handle: costingEngine.getDefaultHandleTypes()
  };

  it('1. Auto-costs window line matching Acceptance Test 1 (10x6 Sliding Window)', () => {
    const line = {
      type: 'size',
      template_id: 'tpl_sliding_window',
      w: 10,
      h: 6,
      qty: 1,
      glass_id: '6mm Toughened',
      mesh: 'SS Mesh'
    };
    const quote = { dimUnit: 'ft', _templates: templates, _costingSettings: settings, _rates: rates };
    const res = lineCalc(line, quote);

    expect(res.area).toBe(60);
    expect(res.rate).toBe(597); // Excel benchmark rate per sqft
    expect(res.amt).toBe(35820); // 60 sqft * 597
    expect(res.cost_breakdown).toBeDefined();
    expect(res.cost_breakdown.priceExTax).toBe(35803);
    expect(res.cost_breakdown.margin).toBe(9282);
    expect(res.isOverride).toBe(false);
  });

  it('2. Manual rate override per row with reason', () => {
    const line = {
      type: 'size',
      template_id: 'tpl_sliding_window',
      w: 10,
      h: 6,
      qty: 1,
      glass_id: '6mm Toughened',
      mesh: 'SS Mesh',
      rate_override: 575,
      rate_override_reason: 'Competitive quote match'
    };
    const quote = { dimUnit: 'ft', _templates: templates, _costingSettings: settings, _rates: rates };
    const res = lineCalc(line, quote);

    expect(res.calcRate).toBe(597);
    expect(res.rate).toBe(575);
    expect(res.isOverride).toBe(true);
    expect(res.rate_override_reason).toBe('Competitive quote match');
    expect(res.amt).toBe(60 * 575);
  });

  it('3. Same-size same-rate reproducibility across quote lines', () => {
    const lineA = { type: 'size', template_id: 'tpl_sliding_door', w: 8, h: 8, qty: 1, glass_id: '8mm Toughened Clear', mesh: 'SS Mesh' };
    const lineB = { type: 'size', template_id: 'tpl_sliding_door', w: 8, h: 8, qty: 2, glass_id: '8mm Toughened Clear', mesh: 'SS Mesh' };
    const quote = { dimUnit: 'ft', _templates: templates, _costingSettings: settings, _rates: rates };

    const resA = lineCalc(lineA, quote);
    const resB = lineCalc(lineB, quote);

    expect(resA.rate).toBe(623);
    expect(resB.rate).toBe(623);
    expect(resB.totalArea).toBe(128); // 64 * 2
    expect(resB.amt).toBe(128 * 623);
  });

  it('4. Site measurement mm to feet rounding formula verification (Section 1.3)', () => {
    const cases = [
      { mm: 3000, expectedFt: 10 },
      { mm: 1850, expectedFt: 6 },
      { mm: 2150, expectedFt: 7 },
      { mm: 2350, expectedFt: 8 },
      { mm: 1200, expectedFt: 4 },
      { mm: 2450, expectedFt: 8 },
      { mm: 4500, expectedFt: 15 },
      { mm: 2100, expectedFt: 7 }
    ];
    cases.forEach(({ mm, expectedFt }) => {
      expect(costingEngine.roundFeetFromMm(mm)).toBe(expectedFt);
    });
  });

  it('5. Quote totals & CTPL-252 benchmark test', () => {
    // CTPL-252 benchmark:
    // Total Qty 18, Total Area 472 sqft, Items total ₹3,11,794, Average rate ₹661, Transport ₹6,000, Ex-GST ₹3,17,794, 18% GST ₹3,74,996.92
    const quote = {
      lines: [
        { type: 'item', qty: 18, rate: 311794 / 18, disc: 0, cost: 200000, _totalArea: 472 }
      ],
      transport_charges: 6000,
      gst: true,
      gstRate: 18,
      gstType: 'cgst_sgst',
      pos: 'Tamil Nadu'
    };
    // Override lineCalc for the benchmark items test directly
    const items = [{ qty: 18, area_sqft: 472, total_price: 311794 }];
    const totals = costingEngine.quoteTotals(items, 6000, 18);

    expect(totals.totalQty).toBe(18);
    expect(totals.totalArea).toBe(472);
    expect(totals.totalPrice).toBe(311794);
    expect(totals.avgRate).toBe(661); // 311794 / 472 = 660.58 => 661
    expect(totals.transport).toBe(6000);
    expect(totals.totalExGst).toBe(317794);
    expect(totals.gstAmount).toBeCloseTo(57202.92, 2);
    expect(totals.totalInclGst).toBeCloseTo(374996.92, 2);
  });

  it('6. Section grouping does not corrupt quote item counts or totals', () => {
    const quote = {
      lines: [
        { type: 'section', title: 'GROUND FLOOR' },
        { type: 'size', template_id: 'tpl_fixed_window', w: 10, h: 8, qty: 1, glass_id: '6mm Toughened', mesh: 'NA' },
        { type: 'section', title: 'FIRST FLOOR' },
        { type: 'size', template_id: 'tpl_fixed_window', w: 10, h: 8, qty: 2, glass_id: '6mm Toughened', mesh: 'NA' }
      ],
      transport_charges: 2000,
      dimUnit: 'ft',
      _templates: templates,
      _costingSettings: settings,
      _rates: rates
    };
    const totals = calcTotals(quote);

    expect(totals.totalQty).toBe(3); // 1 + 2
    expect(totals.sizeArea).toBe(240); // (80 * 1) + (80 * 2) = 240
    expect(totals.transport).toBe(2000);
  });
});

