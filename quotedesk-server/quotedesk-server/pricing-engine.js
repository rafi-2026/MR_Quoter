// Pricing & Validation Engine for MR_Quoter (Interior & Windows Quotations)
'use strict';

const UNIT_FT = { mm: 1 / 304.8, ft: 1, in: 1 / 12, m: 3.28084 };

const num = v => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

function lineCalc(l, q = {}) {
  if (!l || l.type === 'section') return { amt: 0, gross: 0, disc: 0, cost: 0, totalArea: 0 };
  const qty = num(l.qty);
  const dimUnit = q.dimUnit || l.dimUnit || 'mm';

  if (l.type === 'size') {
    const k = UNIT_FT[dimUnit] || UNIT_FT.mm;
    const w = num(l.w);
    const h = num(l.h);
    // Area in square feet
    const area = r2(w * k * h * k);
    const minArea = num(l.minArea);
    const billed = Math.max(area, minArea);
    const rate = num(l.rate) + num(l.glassAdd) + num(l.finishAdd);
    const hw = num(l.hw);
    const unit = r2(billed * rate + hw);
    const gross = r2(unit * qty);
    const disc = r2(gross * num(l.disc) / 100);
    const amt = r2(gross - disc);
    const cost = r2(billed * num(l.cost) * qty);
    const totalArea = r2(billed * qty);
    return { area, billed, rate, unit, gross, disc, amt, cost, totalArea };
  }

  // Standard item or lump sum
  const rate = num(l.rate);
  const gross = r2(qty * rate);
  const disc = r2(gross * num(l.disc) / 100);
  const amt = r2(gross - disc);
  const cost = r2(qty * num(l.cost));
  return { area: 0, billed: qty, rate, unit: rate, gross, disc, amt, cost, totalArea: 0 };
}

function calcTotals(q, settings = {}) {
  const lines = q.lines || [];
  let sub = 0;
  let gross = 0;
  let lineDisc = 0;
  let cost = 0;
  let costedRev = 0;
  let sizeArea = 0;

  lines.forEach(l => {
    const c = lineCalc(l, q);
    sub += c.amt;
    gross += c.gross;
    lineDisc += c.disc;
    if (c.cost > 0) {
      cost += c.cost;
      costedRev += c.amt;
    }
    if (c.totalArea) sizeArea += c.totalArea;
  });

  sub = r2(sub);
  gross = r2(gross);
  lineDisc = r2(lineDisc);
  cost = r2(cost);

  const dAmt = r2(q.discType === 'pct' ? sub * num(q.discVal) / 100 : Math.min(num(q.discVal), sub));
  const extras = r2((q.extras || []).reduce((a, e) => a + num(e.amount), 0));
  const taxable = Math.max(r2(sub - dAmt + extras), 0);
  const gstRate = q.gst !== false ? num(q.gstRate || settings.gstRate || 18) : 0;

  let inter = false;
  if (q.gstType === 'igst') {
    inter = true;
  } else if (q.gstType === 'cgst_sgst') {
    inter = false;
  } else {
    inter = !!q.pos && !!settings.state && q.pos.toLowerCase() !== settings.state.toLowerCase();
  }

  const cg = inter ? 0 : r2(taxable * (gstRate / 2) / 100);
  const sg = inter ? 0 : r2(taxable * (gstRate / 2) / 100);
  const ig = inter ? r2(taxable * gstRate / 100) : 0;
  const gstAmt = r2(cg + sg + ig);

  const raw = r2(taxable + gstAmt);
  const grand = Math.round(raw);
  const round = r2(grand - raw);

  const effDisc = gross > 0 ? r2((lineDisc + dAmt) / gross * 100) : 0;
  const margin = costedRev > 0 ? {
    amt: r2(costedRev - cost),
    pct: r2((costedRev - cost) / costedRev * 100),
    rev: r2(costedRev)
  } : null;

  return {
    gross,
    lineDisc,
    sub,
    dAmt,
    extras,
    taxable,
    rate: gstRate,
    inter,
    cg,
    sg,
    ig,
    gstAmt,
    raw,
    round,
    grand,
    effDisc,
    margin,
    sizeArea: r2(sizeArea)
  };
}

function validateQuote(q) {
  const errors = [];
  if (!q) {
    errors.push('Quote data is missing.');
    return errors;
  }
  if (!q.cust || !String(q.cust.name || '').trim()) {
    errors.push('Enter customer name.');
  }

  const items = (q.lines || []).filter(l => l.type !== 'section');
  if (items.length === 0) {
    errors.push('Add at least one item.');
  } else {
    items.forEach((l, idx) => {
      const label = `Item ${idx + 1}`;
      if (!String(l.name || l.desc || '').trim()) {
        errors.push(`${label}: Add a description or product name.`);
      }
      if (l.type === 'size') {
        if (num(l.w) <= 0 || num(l.h) <= 0) {
          errors.push(`${label}: Enter valid width and height.`);
        }
      }
      if (num(l.qty) <= 0) {
        errors.push(`${label}: Quantity must be greater than zero.`);
      }
      if (lineCalc(l, q).amt <= 0) {
        errors.push(`${label}: Total amount is zero. Check rate.`);
      }
    });
  }

  if (q.pay && q.pay.length > 0) {
    const totalPct = q.pay.reduce((a, p) => a + num(p.pct), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      errors.push(`Payment schedule adds up to ${totalPct}%, not 100%.`);
    }
  }

  return errors;
}

function amountWords(n) {
  n = Math.round(n);
  if (n === 0) return 'Zero';
  if (n < 0) return 'Minus ' + amountWords(Math.abs(n));

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
             'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');

  const out = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;

  if (cr) out.push(three(cr) + ' Crore');
  if (lk) out.push(two(lk) + ' Lakh');
  if (th) out.push(two(th) + ' Thousand');
  if (n) out.push(three(n));

  return out.join(' ');
}

module.exports = {
  UNIT_FT,
  num,
  r2,
  lineCalc,
  calcTotals,
  validateQuote,
  amountWords
};
