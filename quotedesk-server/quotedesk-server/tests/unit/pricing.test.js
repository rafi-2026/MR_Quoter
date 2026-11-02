import { describe, it, expect } from 'vitest';
const {
  lineCalc,
  calcTotals,
  validateQuote,
  amountWords,
  UNIT_FT
} = require('../../pricing-engine');

describe('Pricing Engine - Window & Interior Measurement Calculation', () => {
  it('calculates size-based window item in mm correctly', () => {
    // Window: 1200mm W x 1500mm H, rate ₹450 / sqft, Qty 2
    // Area in sq ft = (1200 / 304.8) * (1500 / 304.8) = 3.937 * 4.921 = 19.375 sq ft
    const line = {
      type: 'size',
      w: 1200,
      h: 1500,
      qty: 2,
      rate: 450,
      hw: 250, // hardware add-on per unit
      glassAdd: 50, // glass add-on per sqft
      finishAdd: 20, // finish add-on per sqft
      cost: 320,
      disc: 5
    };
    const quote = { dimUnit: 'mm' };

    const res = lineCalc(line, quote);

    expect(res.area).toBeCloseTo(19.38, 1);
    expect(res.rate).toBe(520); // 450 + 50 + 20
    // Unit price = 19.38 * 520 + 250 = 10077.6 + 250 = 10327.6
    expect(res.unit).toBeCloseTo(10325, -2);
    expect(res.gross).toBeCloseTo(res.unit * 2, 1);
    expect(res.disc).toBeCloseTo(res.gross * 0.05, 1);
    expect(res.amt).toBeCloseTo(res.gross - res.disc, 1);
    expect(res.totalArea).toBeCloseTo(res.billed * 2, 1);
  });

  it('respects minimum area constraint (minArea)', () => {
    // Window: 300mm W x 300mm H (small vent = 0.96 sqft), minArea = 5 sqft
    const line = {
      type: 'size',
      w: 300,
      h: 300,
      minArea: 5,
      qty: 1,
      rate: 400,
      hw: 0,
      glassAdd: 0,
      finishAdd: 0,
      disc: 0
    };
    const res = lineCalc(line, { dimUnit: 'mm' });
    expect(res.area).toBeLessThan(2);
    expect(res.billed).toBe(5); // billed at minArea
    expect(res.amt).toBe(2000); // 5 * 400
  });

  it('calculates size-based window item in inches', () => {
    // Window: 48 in W x 60 in H = 4 ft x 5 ft = 20 sq ft, Rate ₹500, Qty 1
    const line = {
      type: 'size',
      w: 48,
      h: 60,
      qty: 1,
      rate: 500,
      hw: 0,
      glassAdd: 0,
      finishAdd: 0,
      disc: 0
    };
    const res = lineCalc(line, { dimUnit: 'in' });
    expect(res.area).toBe(20);
    expect(res.billed).toBe(20);
    expect(res.amt).toBe(10000);
  });

  it('calculates standard lump-sum items correctly', () => {
    const line = {
      type: 'item',
      qty: 3,
      rate: 1500,
      cost: 1100,
      disc: 10
    };
    const res = lineCalc(line, {});
    expect(res.gross).toBe(4500);
    expect(res.disc).toBe(450);
    expect(res.amt).toBe(4050);
    expect(res.cost).toBe(3300);
  });
});

describe('Pricing Engine - Totals, Taxes & Discounts', () => {
  it('calculates intrastate CGST + SGST (9% + 9%) accurately with extra charges', () => {
    const quote = {
      dimUnit: 'in',
      lines: [
        { type: 'item', qty: 2, rate: 5000, disc: 0 } // Subtotal ₹10,000
      ],
      discType: 'pct',
      discVal: 10, // 10% discount => ₹1,000 off => ₹9,000
      extras: [
        { desc: 'Installation', amount: 1000 },
        { desc: 'Transport', amount: 500 }
      ], // Extras => ₹1,500 => Taxable = ₹10,500
      gst: true,
      gstRate: 18,
      gstType: 'cgst_sgst',
      pos: 'Tamil Nadu'
    };
    const settings = { state: 'Tamil Nadu' };

    const totals = calcTotals(quote, settings);

    expect(totals.sub).toBe(10000);
    expect(totals.dAmt).toBe(1000);
    expect(totals.extras).toBe(1500);
    expect(totals.taxable).toBe(10500);
    expect(totals.inter).toBe(false);
    expect(totals.cg).toBe(945); // 10500 * 9% = 945
    expect(totals.sg).toBe(945);
    expect(totals.ig).toBe(0);
    expect(totals.gstAmt).toBe(1890);
    expect(totals.grand).toBe(12390); // 10500 + 1890
  });

  it('calculates interstate IGST (18%) when place of supply differs', () => {
    const quote = {
      lines: [{ type: 'item', qty: 1, rate: 20000, disc: 0 }],
      discType: 'fixed',
      discVal: 2000, // Taxable = 18000
      extras: [],
      gst: true,
      gstRate: 18,
      gstType: 'auto',
      pos: 'Karnataka'
    };
    const settings = { state: 'Tamil Nadu' };

    const totals = calcTotals(quote, settings);

    expect(totals.inter).toBe(true);
    expect(totals.cg).toBe(0);
    expect(totals.sg).toBe(0);
    expect(totals.ig).toBe(3240); // 18000 * 18% = 3240
    expect(totals.grand).toBe(21240);
  });
});

describe('Pricing Engine - Number to Words Conversion', () => {
  it('converts amounts to Indian English words', () => {
    expect(amountWords(0)).toBe('Zero');
    expect(amountWords(450)).toBe('Four Hundred Fifty');
    expect(amountWords(12390)).toBe('Twelve Thousand Three Hundred Ninety');
    expect(amountWords(1500000)).toBe('Fifteen Lakh');
    expect(amountWords(10250750)).toBe('One Crore Two Lakh Fifty Thousand Seven Hundred Fifty');
  });
});

describe('Pricing Engine - Quotation Validation', () => {
  it('fails validation when customer name is missing', () => {
    const quote = {
      cust: { name: '' },
      lines: [{ type: 'item', name: 'Aluminium Window', qty: 1, rate: 500 }]
    };
    const errors = validateQuote(quote);
    expect(errors).toContain('Enter customer name.');
  });

  it('fails validation when line items are empty', () => {
    const quote = {
      cust: { name: 'Acme Interiors' },
      lines: []
    };
    const errors = validateQuote(quote);
    expect(errors).toContain('Add at least one item.');
  });

  it('fails validation when size item has non-positive dimensions or zero rate', () => {
    const quote = {
      cust: { name: 'Acme Interiors' },
      lines: [
        { type: 'size', name: 'Sliding Window', w: 0, h: 1000, qty: 1, rate: 0 }
      ]
    };
    const errors = validateQuote(quote);
    expect(errors.some(e => e.includes('valid width and height'))).toBe(true);
    expect(errors.some(e => e.includes('Total amount is zero'))).toBe(true);
  });

  it('fails validation when payment schedule does not total 100%', () => {
    const quote = {
      cust: { name: 'Acme Interiors' },
      lines: [{ type: 'item', name: 'Work', qty: 1, rate: 5000 }],
      pay: [
        { milestone: 'Advance', pct: 50 },
        { milestone: 'Delivery', pct: 30 } // Total 80% != 100%
      ]
    };
    const errors = validateQuote(quote);
    expect(errors.some(e => e.includes('adds up to 80%, not 100%'))).toBe(true);
  });

  it('passes validation for a fully valid quotation', () => {
    const quote = {
      cust: { name: 'Dr. Ramesh' },
      lines: [
        { type: 'size', name: 'Casement Window', w: 900, h: 1200, qty: 2, rate: 450 }
      ],
      pay: [
        { milestone: 'Advance', pct: 50 },
        { milestone: 'Installation', pct: 40 },
        { milestone: 'Completion', pct: 10 }
      ]
    };
    const errors = validateQuote(quote);
    expect(errors.length).toBe(0);
  });
});
