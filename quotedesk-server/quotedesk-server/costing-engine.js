'use strict';
/**
 * MR_Quoter Costing Engine - Phase 1
 * Pure functions: no UI code, no DB calls, no side effects.
 * Rounding follows the Excel sheet exactly (spec section 1.2).
 *
 * KEY RULE: In BOM line formulas, L1/L2/... refers to the TOTAL METRES
 * of that line (length_expr * nos), NOT the monetary amount and NOT
 * the per-piece length. This matches the spec's Excel cross-references.
 */

// MM to Feet rounding (site measurement sheet section 1.3)
function roundFeetFromMm(mm) {
  var feet = mm / 304.8;
  var whole = Math.floor(feet);
  var frac  = feet - whole;
  if (frac < 0.3)       return whole;
  if (frac <= 0.7)      return whole + 0.5;
  return whole + 1;
}

// Safe expression parser (no eval)
// Variables: W, H, A (dimensions), L1..Ln (total metres of prior lines)
function evalExpr(expr, vars) {
  if (!expr || String(expr).trim() === '') return 0;
  var s = String(expr).trim();
  var names = Object.keys(vars).sort(function(a, b) { return b.length - a.length; });
  var safe = s;
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b' + escaped + '\\b', 'g');
    safe = safe.replace(re, '(' + Number(vars[n]) + ')');
  }
  if (!/^[\d\s.\+\-\*\/\(\)]+$/.test(safe)) {
    throw new Error('Unsafe expression: ' + expr);
  }
  return (new Function('return (' + safe + ')'))();
}

// Main calculation function
function calculateItem(template, templateLines, widthFt, heightFt, options, settings, rates) {
  var FT_TO_M = Number(settings.ft_to_m) || 0.3048;
  var W = widthFt  * FT_TO_M;  // metres
  var H = heightFt * FT_TO_M;  // metres
  var A = W * H;                // sqm

  var alRate    = Number(settings.aluminium_rate_per_kg) || 500;
  var labourRate = Number(settings.labour_rate_per_sqm) || 500;

  // Glass rate lookup
  var glassOption = null;
  if (options && options.glass_id) {
    var gl = rates.glass || [];
    for (var gi = 0; gi < gl.length; gi++) {
      if (gl[gi].id === options.glass_id || gl[gi].name === options.glass_id) {
        glassOption = gl[gi]; break;
      }
    }
  }
  var glassRate = glassOption ? Number(glassOption.rate_per_sqm) : 600;

  // Mesh
  var meshOption = null;
  var hasMesh = false;
  if (options && options.mesh && options.mesh !== 'NA') {
    var ms = rates.mesh || [];
    for (var mi = 0; mi < ms.length; mi++) {
      if (ms[mi].name === options.mesh) { meshOption = ms[mi]; break; }
    }
    if (!meshOption) meshOption = { rate_per_sqm: 290 };
    hasMesh = true;
  }
  var meshRate = meshOption ? Number(meshOption.rate_per_sqm) : 0;

  // priorLengths: L1..Ln = TOTAL METRES of each prior line (length * nos)
  var priorLengths = {};
  var vars = function() { return Object.assign({ W: W, H: H, A: A }, priorLengths); };

  var bomLines = [];
  var subtotal = 0;

  for (var i = 0; i < templateLines.length; i++) {
    var rawLine = templateLines[i];
    var line = Object.assign({}, rawLine);

    // Condition check (mesh-based)
    var include = true;
    if (line.condition) {
      var cond = line.condition.trim().toLowerCase();
      if (cond.indexOf('mesh') !== -1 && cond.indexOf("'na'") !== -1) {
        include = hasMesh ? (cond.indexOf('!=') !== -1) : (cond.indexOf('==') !== -1);
      }
    }
    if (!include) continue;

    // Inject runtime rates
    var unitPrice = Number(line.unit_price) || 0;
    if (line.kind === 'labour' && unitPrice === 0) unitPrice = labourRate;
    if (line.kind === 'glass')  unitPrice = glassRate;
    if (line.kind === 'mesh')   unitPrice = meshRate;

    // Evaluate length and nos
    var v = vars();
    var length = 0, nos = 0;
    try { length = evalExpr(line.length_expr || '0', v); } catch(e) { length = 0; }
    try { nos    = evalExpr(line.nos_expr    || '1', v); } catch(e) { nos = 1; }

    // totalLineMetres = length * nos (stored for cross-reference by later lines)
    var totalMetres = length * nos;

    // Calculate amount based on kind
    var amount = 0;
    var kind = line.kind;
    if (kind === 'profile') {
      var w = Number(line.weight_kg_per_m) || 0;
      amount = totalMetres * w * alRate;
    } else if (kind === 'gasket' || kind === 'brush_seal') {
      // length_expr evaluates to total metres (may reference L-vars), nos multiplies
      amount = totalMetres * unitPrice;
    } else if (kind === 'hardware') {
      // nos = quantity, unit_price = each
      amount = nos * unitPrice;
    } else if (kind === 'labour' || kind === 'glass' || kind === 'mesh') {
      // length_expr evaluates area (or fraction), unit_price = rate/sqm
      amount = length * unitPrice;  // nos is implicit 1 for these
    } else {
      amount = nos * unitPrice;
    }

    // Store total metres for reference by subsequent lines
    priorLengths['L' + line.sl_no] = totalMetres;

    bomLines.push({
      sl_no:           line.sl_no,
      description:     line.description,
      kind:            kind,
      length:          length,
      nos:             nos,
      totalMetres:     totalMetres,
      weight_kg_per_m: Number(line.weight_kg_per_m) || 0,
      unit_price:      unitPrice,
      amount:          amount
    });
    subtotal += amount;
  }

  // Totals - rounding exactly as in spec section 1.2
  var wastagePct = Number(settings.wastage_pct) || 5;
  var marginPct  = Number(settings.margin_pct)  || 35;
  var gstPct     = Number(settings.gst_pct)     || 18;
  var sqftPerSqm = Number(settings.sqft_per_sqm) || 10.764;

  var wastage      = subtotal * wastagePct / 100;
  var totalCost    = subtotal + wastage;
  var margin       = Math.round(totalCost * marginPct / 100);   // ROUND(,0)
  var priceExTax   = Math.round(totalCost + margin);             // ROUND(,0)
  var ratePerSqm   = A > 0 ? Math.round(priceExTax / A) : 0;   // ROUND(,0)
  var ratePerSqft  = Math.round(ratePerSqm / sqftPerSqm);       // ROUND(,0)
  var priceInclGst = Math.round(priceExTax * (1 + gstPct / 100));

  return {
    widthFt: widthFt, heightFt: heightFt, options: options,
    W: W, H: H, A: A,
    lines: bomLines,
    subtotal: subtotal,
    wastage: wastage,
    totalCost: totalCost,
    margin: margin,
    priceExTax: priceExTax,
    ratePerSqm: ratePerSqm,
    ratePerSqft: ratePerSqft,
    priceInclGst: priceInclGst,
    wastagePct: wastagePct, marginPct: marginPct, gstPct: gstPct
  };
}

// Quote-level totals
function quoteTotals(items, transportCharges, gstPct) {
  var totalQty = 0, totalArea = 0, totalPrice = 0;
  items.forEach(function(item) {
    totalQty   += Number(item.qty) || 0;
    totalArea  += Number(item.area_sqft) || 0;
    totalPrice += Number(item.total_price) || 0;
  });
  var avgRate      = totalArea > 0 ? Math.round(totalPrice / totalArea) : 0;
  var transport    = Number(transportCharges) || 0;
  var totalExGst   = totalPrice + transport;
  var gst          = gstPct || 18;
  var gstAmount    = totalExGst * gst / 100;
  var totalInclGst = totalExGst + gstAmount;
  return { totalQty: totalQty, totalArea: totalArea, totalPrice: totalPrice, avgRate: avgRate, transport: transport, totalExGst: totalExGst, gstAmount: gstAmount, totalInclGst: totalInclGst, gst: gst };
}

function getDefaultCostingSettings() {
  return { aluminium_rate_per_kg: 500, wastage_pct: 5, margin_pct: 35, gst_pct: 18, labour_rate_per_sqm: 500, sqft_per_sqm: 10.764, ft_to_m: 0.3048 };
}

function getDefaultGlassTypes() {
  return [
    { id: 'g1', name: '5mm Clear',                 rate_per_sqm: 600  },
    { id: 'g2', name: '4mm Frosted',                rate_per_sqm: 600  },
    { id: 'g3', name: '6mm Toughened',              rate_per_sqm: 850  },
    { id: 'g4', name: '8mm Toughened Clear',        rate_per_sqm: 1200 },
    { id: 'g5', name: '6mm Toughened Tinted Brown', rate_per_sqm: 2000 }
  ];
}

function getDefaultMeshTypes() {
  return [{ id: 'm1', name: 'SS Mesh', rate_per_sqm: 290 }];
}

function getDefaultHandleTypes() {
  return [
    { id: 'h1', name: 'Standard Handle', price: 0   },
    { id: 'h2', name: 'Pop-up Handle',   price: 110 },
    { id: 'h3', name: 'Flush Handle',    price: 85  }
  ];
}

// IMPORTANT: L-variable references in formulas mean TOTAL METRES of that line.
// Profile lines: L1 = length_expr * nos (total profile metres used)
// Gasket lines: L4+L5+L7 = sum of total metres of those lines
// This matches the Excel where gasket = perimeter of the sash frames

function getSeedTemplates() {
  return [
    // Template 1: 2.5T 2P Sliding Window
    // L4 = W*2, L5 = H*4, L7 = 3*W*1 (total metres)
    // Gasket line 8: L4+L5+L7 = 2W + 4H + 3W = 5W+4H
    {
      id: 'tpl_sliding_window', name: '2.5T - 2P Sliding Window', series: 'Domal 27',
      category: 'window', allows_mesh: true, default_handle: 'Standard Handle',
      lines: [
        { sl_no:  1, description: 'Outer Frame Top',            kind: 'profile',    length_expr: 'W',         nos_expr: '1', weight_kg_per_m: 1.28, profile_no: '5045' },
        { sl_no:  2, description: 'Outer Frame Bottom',         kind: 'profile',    length_expr: 'W',         nos_expr: '1', weight_kg_per_m: 1.28, profile_no: '5045' },
        { sl_no:  3, description: 'Outer Frame Verticals',      kind: 'profile',    length_expr: 'H',         nos_expr: '2', weight_kg_per_m: 1.28, profile_no: '5045' },
        { sl_no:  4, description: 'Sliding Sash Both Side',     kind: 'profile',    length_expr: 'W',         nos_expr: '2', weight_kg_per_m: 0.78, profile_no: '5047' },
        { sl_no:  5, description: 'Sliding Sash One Side',      kind: 'profile',    length_expr: 'H',         nos_expr: '4', weight_kg_per_m: 0.78, profile_no: '5047' },
        { sl_no:  6, description: 'Interlock',                  kind: 'profile',    length_expr: 'H',         nos_expr: '2', weight_kg_per_m: 0.35, profile_no: '5042' },
        { sl_no:  7, description: 'Mesh Sash',                  kind: 'profile',    length_expr: '3*W',       nos_expr: '1', weight_kg_per_m: 0.90, profile_no: '5043' },
        { sl_no:  8, description: 'Glazing Gasket for Shutter', kind: 'gasket',     length_expr: 'L4+L5+L7', nos_expr: '1', unit_price: 12 },
        { sl_no:  9, description: 'Brush Seal Shutter Frame',   kind: 'brush_seal', length_expr: '8*W+8*H',  nos_expr: '1', unit_price: 4  },
        { sl_no: 10, description: 'Rollers',                    kind: 'hardware',   length_expr: '0',         nos_expr: '6', unit_price: 30 },
        { sl_no: 11, description: 'Touch Lock',                 kind: 'hardware',   length_expr: '0',         nos_expr: '2', unit_price: 45 },
        { sl_no: 12, description: 'Labour',                     kind: 'labour',     length_expr: 'A',         nos_expr: '1', unit_price: 500 },
        { sl_no: 13, description: 'Glass',                      kind: 'glass',      length_expr: 'A',         nos_expr: '1', unit_price: 0   },
        { sl_no: 14, description: 'SS Mesh',                    kind: 'mesh',       length_expr: 'A/2',       nos_expr: '1', unit_price: 290, condition: "mesh != 'NA'" }
      ]
    },
    // Template 2: 2.5T 2P Sliding Door
    {
      id: 'tpl_sliding_door', name: '2.5T - 2P Sliding Door', series: 'Domal 27',
      category: 'door', allows_mesh: true, default_handle: 'Pop-up Handle', default_glass: '8mm Toughened Clear',
      lines: [
        { sl_no:  1, description: 'Outer Frame Top',            kind: 'profile',    length_expr: 'W',         nos_expr: '1', weight_kg_per_m: 1.28, profile_no: '5045' },
        { sl_no:  2, description: 'Outer Frame Bottom',         kind: 'profile',    length_expr: 'W',         nos_expr: '1', weight_kg_per_m: 1.28, profile_no: '5045' },
        { sl_no:  3, description: 'Outer Frame Verticals',      kind: 'profile',    length_expr: 'H',         nos_expr: '2', weight_kg_per_m: 1.28, profile_no: '5045' },
        { sl_no:  4, description: 'Sliding Sash Both Side',     kind: 'profile',    length_expr: 'W',         nos_expr: '2', weight_kg_per_m: 0.78, profile_no: '5047' },
        { sl_no:  5, description: 'Sliding Sash One Side',      kind: 'profile',    length_expr: 'H',         nos_expr: '4', weight_kg_per_m: 0.78, profile_no: '5047' },
        { sl_no:  6, description: 'Interlock',                  kind: 'profile',    length_expr: 'H',         nos_expr: '2', weight_kg_per_m: 0.35, profile_no: '5042' },
        { sl_no:  7, description: 'Mesh Sash',                  kind: 'profile',    length_expr: '3*W',       nos_expr: '1', weight_kg_per_m: 0.90, profile_no: '5043' },
        { sl_no:  8, description: 'Glazing Gasket for Shutter', kind: 'gasket',     length_expr: 'L4+L5+L7', nos_expr: '1', unit_price: 12 },
        { sl_no:  9, description: 'Brush Seal Shutter Frame',   kind: 'brush_seal', length_expr: '8*W+8*H',  nos_expr: '1', unit_price: 4  },
        { sl_no: 10, description: 'Rollers',                    kind: 'hardware',   length_expr: '0',         nos_expr: '4', unit_price: 80 },
        { sl_no: 11, description: 'Pop-up Handle',              kind: 'hardware',   length_expr: '0',         nos_expr: '2', unit_price: 110 },
        { sl_no: 12, description: 'Corner Cleat',               kind: 'hardware',   length_expr: '0',         nos_expr: '4', unit_price: 31 },
        { sl_no: 13, description: 'Labour',                     kind: 'labour',     length_expr: 'A',         nos_expr: '1', unit_price: 500 },
        { sl_no: 14, description: 'Glass',                      kind: 'glass',      length_expr: 'A',         nos_expr: '1', unit_price: 0   },
        { sl_no: 15, description: 'SS Mesh',                    kind: 'mesh',       length_expr: 'A/2',       nos_expr: '1', unit_price: 290, condition: "mesh != 'NA'" }
      ]
    },
    // Template 3: Fixed Window
    // L1 = W*2 (frame top total), L2 = H*2 (frame vert total), L3 = H*2 (mullion total)
    // Glazing Bead Outer = L1+L2 (total metres), nos=1
    // Glazing Bead Mullion = L3 (total metres = H*2), nos=2 -> totalMetres = H*2*2 = H*4
    // Gasket = L4+L5 (total metres of bead lines)
    {
      id: 'tpl_fixed_window', name: 'Fixed Window', series: 'Domal 27',
      category: 'window', allows_mesh: false, default_handle: 'Standard Handle',
      lines: [
        { sl_no: 1, description: 'Outer Frame Top',          kind: 'profile', length_expr: 'W',     nos_expr: '2', weight_kg_per_m: 0.60, profile_no: '5008' },
        { sl_no: 2, description: 'Outer Frame Vertical',     kind: 'profile', length_expr: 'H',     nos_expr: '2', weight_kg_per_m: 0.60, profile_no: '5008' },
        { sl_no: 3, description: 'Mullion',                  kind: 'profile', length_expr: 'H',     nos_expr: '2', weight_kg_per_m: 0.68, profile_no: '5006' },
        { sl_no: 4, description: 'Glazing Bead Outer Frame', kind: 'profile', length_expr: 'L1+L2', nos_expr: '1', weight_kg_per_m: 0.26, profile_no: '5013' },
        { sl_no: 5, description: 'Glazing Bead Mullion',     kind: 'profile', length_expr: 'L3',    nos_expr: '2', weight_kg_per_m: 0.26, profile_no: '5013' },
        { sl_no: 6, description: 'Gasket for Beads',         kind: 'gasket',  length_expr: 'L4+L5', nos_expr: '1', unit_price: 10 },
        { sl_no: 7, description: 'Labour',                   kind: 'labour',  length_expr: 'A',     nos_expr: '1', unit_price: 600 },
        { sl_no: 8, description: 'Glass',                    kind: 'glass',   length_expr: 'A',     nos_expr: '1', unit_price: 0   }
      ]
    },
    // Template 4: Ventilator
    {
      id: 'tpl_ventilator', name: 'Ventilator with Adjustable Louver', series: 'Domal 27',
      category: 'ventilator', allows_mesh: false, default_handle: 'Standard Handle', default_glass: '4mm Frosted',
      lines: [
        { sl_no: 1, description: 'Outer Frame Top',          kind: 'profile', length_expr: 'W',      nos_expr: '2', weight_kg_per_m: 0.60, profile_no: '5008' },
        { sl_no: 2, description: 'Outer Frame Vertical',     kind: 'profile', length_expr: 'H',      nos_expr: '2', weight_kg_per_m: 0.60, profile_no: '5008' },
        { sl_no: 3, description: 'Mullion Vertical',         kind: 'profile', length_expr: 'H+0.15', nos_expr: '1', weight_kg_per_m: 0.65, profile_no: '5006' },
        { sl_no: 4, description: 'Glazing Bead Outer Frame', kind: 'profile', length_expr: 'L1+L2',  nos_expr: '1', weight_kg_per_m: 0.26, profile_no: '5013' },
        { sl_no: 5, description: 'Glazing Bead Mullion',     kind: 'profile', length_expr: 'L3',     nos_expr: '2', weight_kg_per_m: 0.26, profile_no: '5013' },
        { sl_no: 6, description: 'Gasket for Beads',         kind: 'gasket',  length_expr: 'L4+L5',  nos_expr: '2', unit_price: 10 },
        { sl_no: 7, description: 'Labour',                   kind: 'labour',  length_expr: 'A',      nos_expr: '1', unit_price: 500 },
        { sl_no: 8, description: 'Glass',                    kind: 'glass',   length_expr: 'A',      nos_expr: '1', unit_price: 0   }
      ]
    }
  ];
}

function runTests() {
  var settings = getDefaultCostingSettings();
  var rates = { glass: getDefaultGlassTypes(), mesh: getDefaultMeshTypes(), handle: getDefaultHandleTypes() };
  var templates = getSeedTemplates();
  console.log('\n========== MR_Quoter Costing Engine - Acceptance Tests ==========\n');
  var cases = [
    { tplId: 'tpl_sliding_window', W: 10, H: 6, glass: '6mm Toughened',      mesh: 'SS Mesh', expectedPrice: 35803, expectedRate: 597, label: '#1 2.5T Window 10x6' },
    { tplId: 'tpl_sliding_window', W: 9,  H: 6, glass: '6mm Toughened',      mesh: 'SS Mesh', expectedPrice: 33110, expectedRate: 613, label: '#2 2.5T Window 9x6',  approxPrice: true },
    { tplId: 'tpl_sliding_door',   W: 8,  H: 8, glass: '8mm Toughened Clear',mesh: 'SS Mesh', expectedPrice: 39898, expectedRate: 623, label: '#3 2.5T Door 8x8' },
    { tplId: 'tpl_fixed_window',   W: 10, H: 8, glass: '6mm Toughened',      mesh: 'NA',      expectedPrice: 26406, expectedRate: 330, label: '#4 Fixed Window 10x8' },
    { tplId: 'tpl_ventilator',     W: 3.5,H: 2, glass: '4mm Frosted',        mesh: 'NA',      expectedPrice: 3826,  expectedRate: 547, label: '#5 Ventilator 3.5x2', approxPrice: true }
  ];
  var allPass = true;
  cases.forEach(function(tc) {
    var tpl = templates.find(function(t) { return t.id === tc.tplId; });
    var glassObj = rates.glass.find(function(g) { return g.name === tc.glass; });
    var result = calculateItem(tpl, tpl.lines, tc.W, tc.H, { glass_id: glassObj ? glassObj.id : null, mesh: tc.mesh }, settings, rates);
    var priceOk = tc.approxPrice ? Math.abs(result.priceExTax - tc.expectedPrice) < 200 : result.priceExTax === tc.expectedPrice;
    var rateOk  = result.ratePerSqft === tc.expectedRate;
    var status  = (priceOk && rateOk) ? 'PASS' : 'FAIL';
    if (!priceOk || !rateOk) allPass = false;
    console.log(status + ' ' + tc.label);
    console.log('  Price Ex-Tax: expected Rs.' + tc.expectedPrice + '  got Rs.' + result.priceExTax + '  ' + (priceOk ? 'OK' : 'MISMATCH'));
    console.log('  Rate/Sqft:    expected Rs.' + tc.expectedRate  + '  got Rs.' + result.ratePerSqft  + '  ' + (rateOk  ? 'OK' : 'MISMATCH'));
    if (tc.label.indexOf('#1') !== -1) {
      console.log('  --- BOM lines ---');
      result.lines.forEach(function(l) { console.log('  ' + l.sl_no + '. ' + l.description + ': Rs.' + l.amount.toFixed(2) + ' (len=' + l.totalMetres.toFixed(4) + ')'); });
      console.log('  Subtotal:  Rs.' + result.subtotal.toFixed(2));
      console.log('  Wastage:   Rs.' + result.wastage.toFixed(2));
      console.log('  TotalCost: Rs.' + result.totalCost.toFixed(2));
      console.log('  Margin:    Rs.' + result.margin);
    }
    console.log('');
  });
  var mmCases = [[3000,10],[1850,6],[1200,4],[2450,8],[2150,7],[4500,15],[2100,7],[2350,8]];
  console.log('--- MM to Feet rounding ---');
  mmCases.forEach(function(pair) {
    var got = roundFeetFromMm(pair[0]);
    var ok  = got === pair[1];
    if (!ok) allPass = false;
    console.log((ok ? 'OK' : 'FAIL') + ' ' + pair[0] + 'mm -> expected ' + pair[1] + 'ft, got ' + got + 'ft');
  });
  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  return allPass;
}

function getDefaultMaterials() {
  return [
    // Profiles
    { category: 'profile', code: '5045', name: 'Outer Frame Top / Bottom / Verticals (Domal 27)', unit: 'kg/m', weight_kg_per_m: 1.28, rate: 500, active: true },
    { category: 'profile', code: '5047', name: 'Sliding Sash (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.78, rate: 500, active: true },
    { category: 'profile', code: '5042', name: 'Interlock (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.35, rate: 500, active: true },
    { category: 'profile', code: '5043', name: 'Mesh Sash (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.90, rate: 500, active: true },
    { category: 'profile', code: '5008', name: 'Outer Frame Top / Vertical (Fixed Window)', unit: 'kg/m', weight_kg_per_m: 0.60, rate: 500, active: true },
    { category: 'profile', code: '5006', name: 'Mullion (Fixed Window / Vent)', unit: 'kg/m', weight_kg_per_m: 0.68, rate: 500, active: true },
    { category: 'profile', code: '5013', name: 'Glazing Bead (Fixed Window)', unit: 'kg/m', weight_kg_per_m: 0.26, rate: 500, active: true },

    // Glass
    { category: 'glass', code: 'G-5C', name: '5mm Clear', unit: 'sqm', weight_kg_per_m: 0, rate: 600, active: true },
    { category: 'glass', code: 'G-4F', name: '4mm Frosted', unit: 'sqm', weight_kg_per_m: 0, rate: 600, active: true },
    { category: 'glass', code: 'G-6T', name: '6mm Toughened', unit: 'sqm', weight_kg_per_m: 0, rate: 850, active: true },
    { category: 'glass', code: 'G-8TC', name: '8mm Toughened Clear', unit: 'sqm', weight_kg_per_m: 0, rate: 1200, active: true },
    { category: 'glass', code: 'G-6TTB', name: '6mm Toughened Tinted Brown', unit: 'sqm', weight_kg_per_m: 0, rate: 2000, active: true },

    // Mesh
    { category: 'mesh', code: 'M-SS', name: 'SS Mesh', unit: 'sqm', weight_kg_per_m: 0, rate: 290, active: true },

    // Hardware & Handles
    { category: 'hardware', code: 'H-ROL', name: 'Rollers', unit: 'nos', weight_kg_per_m: 0, rate: 30, active: true },
    { category: 'hardware', code: 'H-ROLD', name: 'Sliding Door Heavy Rollers', unit: 'nos', weight_kg_per_m: 0, rate: 80, active: true },
    { category: 'hardware', code: 'H-TL', name: 'Touch Lock', unit: 'nos', weight_kg_per_m: 0, rate: 45, active: true },
    { category: 'hardware', code: 'H-PUH', name: 'Pop-up Handle', unit: 'nos', weight_kg_per_m: 0, rate: 110, active: true },
    { category: 'hardware', code: 'H-CC', name: 'Corner Cleat', unit: 'nos', weight_kg_per_m: 0, rate: 31, active: true },
    { category: 'hardware', code: 'H-STD', name: 'Standard Handle', unit: 'nos', weight_kg_per_m: 0, rate: 0, active: true },
    { category: 'hardware', code: 'H-FLUSH', name: 'Flush Handle', unit: 'nos', weight_kg_per_m: 0, rate: 85, active: true },

    // Gaskets & Seal
    { category: 'gasket', code: 'GSK-SL', name: 'Glazing Gasket for Shutter (Sliding)', unit: 'm', weight_kg_per_m: 0, rate: 12, active: true },
    { category: 'gasket', code: 'GSK-BD', name: 'Gasket for Beads (Fixed / Vent)', unit: 'm', weight_kg_per_m: 0, rate: 10, active: true },
    { category: 'gasket', code: 'BRS-SF', name: 'Brush Seal Shutter Frame', unit: 'm', weight_kg_per_m: 0, rate: 4, active: true },

    // Labour
    { category: 'labour', code: 'LAB-STD', name: 'Standard Fabrication & Fixing Labour', unit: 'sqm', weight_kg_per_m: 0, rate: 500, active: true },
    { category: 'labour', code: 'LAB-FW', name: 'Fixed Window Fabrication & Fixing Labour', unit: 'sqm', weight_kg_per_m: 0, rate: 600, active: true }
  ];
}

function seedCostingData(db) {
  if (!db || typeof db !== 'object') return false;
  var modified = false;
  db.companyCostingSettings = db.companyCostingSettings || {};
  db.materials = db.materials || [];
  db.productTemplates = db.productTemplates || [];

  var companyIds = ['master'];
  (db.companies || []).forEach(function(c) {
    if (c && c.id && companyIds.indexOf(c.id) === -1) {
      companyIds.push(c.id);
    }
  });

  var defaultMats = getDefaultMaterials();
  var defaultTpls = getSeedTemplates();

  companyIds.forEach(function(coId) {
    if (!db.companyCostingSettings[coId]) {
      db.companyCostingSettings[coId] = Object.assign({}, getDefaultCostingSettings(), {
        last_changed_by: 'system',
        last_changed_at: new Date().toISOString()
      });
      modified = true;
    }
    var existingMats = db.materials.filter(function(m) { return m.companyId === coId; });
    if (existingMats.length === 0) {
      defaultMats.forEach(function(mat, idx) {
        db.materials.push(Object.assign({
          id: 'mat_' + coId + '_' + (idx + 1),
          companyId: coId
        }, mat));
      });
      modified = true;
    }
    var existingTpls = db.productTemplates.filter(function(t) { return t.companyId === coId; });
    if (existingTpls.length === 0) {
      defaultTpls.forEach(function(tpl) {
        db.productTemplates.push(Object.assign({}, tpl, {
          id: tpl.id + '_' + coId,
          template_key: tpl.id,
          companyId: coId,
          created_at: new Date().toISOString()
        }));
      });
      modified = true;
    }
  });

  return modified;
}

module.exports = {
  roundFeetFromMm: roundFeetFromMm,
  evalExpr: evalExpr,
  calculateItem: calculateItem,
  quoteTotals: quoteTotals,
  getDefaultCostingSettings: getDefaultCostingSettings,
  getDefaultGlassTypes: getDefaultGlassTypes,
  getDefaultMeshTypes: getDefaultMeshTypes,
  getDefaultHandleTypes: getDefaultHandleTypes,
  getSeedTemplates: getSeedTemplates,
  getDefaultMaterials: getDefaultMaterials,
  seedCostingData: seedCostingData,
  runTests: runTests
};

if (require.main === module) { runTests(); }
