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

// Normalize expression: replace special chars (×, ÷), implicit multiplication (3W -> 3*W), and trim
function normalizeExpr(expr) {
  if (!expr || String(expr).trim() === '') return '0';
  var s = String(expr).trim();
  s = s.replace(/×/g, '*').replace(/÷/g, '/');
  // insert * between number and variable, e.g. 3W -> 3*W, 8H -> 8*H, 2L1 -> 2*L1
  s = s.replace(/(\d+)\s*([A-Za-z])/g, '$1 * $2');
  return s;
}

// Safe expression parser (no eval)
// Variables: W, H, A (dimensions), L1..Ln (total metres of prior lines)
function evalExpr(expr, vars) {
  if (!expr || String(expr).trim() === '') return 0;
  var s = normalizeExpr(expr);
  var unifiedVars = {};
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      unifiedVars[k.toUpperCase()] = Number(vars[k]) || 0;
    });
  }
  var names = Object.keys(unifiedVars).sort(function(a, b) { return b.length - a.length; });
  var safe = s;
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b' + escaped + '\\b', 'gi');
    safe = safe.replace(re, '(' + Number(unifiedVars[n]) + ')');
  }
  if (!/^[\d\s.\+\-\*\/\(\)]+$/.test(safe)) {
    throw new Error('Unsafe expression: ' + expr);
  }
  return (new Function('return (' + safe + ')'))();
}

// Live formula validator for UI template builder
function validateFormula(expr, sampleVars) {
  try {
    var v = sampleVars || { W: 3.048, H: 1.8288, A: 5.574, L1: 3.048, L2: 3.048, L3: 3.6576, L4: 6.096, L5: 7.3152, L6: 3.6576, L7: 9.144 };
    var res = evalExpr(expr, v);
    return { valid: true, result: res, error: null };
  } catch(err) {
    return { valid: false, result: null, error: err.message };
  }
}

// Main calculation function
function calculateItem(template, templateLines, widthFt, heightFt, options, settings, rates, allTemplates) {
  options = options || {};
  settings = settings || {};
  rates = rates || {};
  allTemplates = allTemplates || options.allTemplates || rates.allTemplates || (typeof getSeedTemplates === 'function' ? getSeedTemplates() : []);

  var FT_TO_M = Number(settings.ft_to_m) || 0.3048;
  var sqftPerSqm = Number(settings.sqft_per_sqm) || 10.764;
  var wastagePct = Number(settings.wastage_pct) || 5;
  var marginPct  = Number(settings.margin_pct)  || 35;
  var gstPct     = Number(settings.gst_pct)     || 18;

  var W = widthFt  * FT_TO_M;  // metres
  var H = heightFt * FT_TO_M;  // metres
  var A = W * H;                // sqm

  // COMBINATION PRODUCT (Section 1.4)
  // A tall opening is split into a fixed part and an operable part.
  // Each part is costed with its own BOM, then:
  // Rate/Sqft for the whole opening = (Fixed price + Operable price) ÷ total opening area.
  var isCombo = template && (template.category === 'combo' || template.is_combo) && (template.fixed_template_id || template.operable_template_id);
  if (isCombo) {
    var fixedTpl = allTemplates.find(function(t) {
      return t.id === template.fixed_template_id || t.template_key === template.fixed_template_id;
    }) || allTemplates.find(function(t) { return t.id === 'tpl_fixed_window'; });

    var operableTpl = allTemplates.find(function(t) {
      return t.id === template.operable_template_id || t.template_key === template.operable_template_id;
    }) || allTemplates.find(function(t) { return t.id === 'tpl_sliding_door'; });

    var defaultOpH = Number(template.default_operable_h || template.default_operable_height_ft || 7);
    var operableHFt = Number(options.operable_h_ft || options.operable_h || defaultOpH);
    if (operableHFt >= heightFt || operableHFt <= 0) {
      operableHFt = Math.round(heightFt * 0.4 * 10) / 10;
    }
    var fixedHFt = Math.max(0.1, heightFt - operableHFt);

    var fixedRes = fixedTpl
      ? calculateItem(fixedTpl, fixedTpl.lines || [], widthFt, fixedHFt, Object.assign({}, options, { mesh: 'NA' }), settings, rates, allTemplates)
      : { priceExTax: 0, subtotal: 0, wastage: 0, totalCost: 0, margin: 0, lines: [] };

    var operableRes = operableTpl
      ? calculateItem(operableTpl, operableTpl.lines || [], widthFt, operableHFt, options, settings, rates, allTemplates)
      : { priceExTax: 0, subtotal: 0, wastage: 0, totalCost: 0, margin: 0, lines: [] };

    var totalPriceExTax = fixedRes.priceExTax + operableRes.priceExTax;
    var totalAreaSqft = widthFt * heightFt;
    var ratePerSqft = totalAreaSqft > 0 ? Math.round(totalPriceExTax / totalAreaSqft) : 0;
    var ratePerSqm = A > 0 ? Math.round(totalPriceExTax / A) : 0;
    var priceInclGst = Math.round(totalPriceExTax * (1 + gstPct / 100));

    var comboBomLines = [];
    (fixedRes.lines || []).forEach(function(l) {
      comboBomLines.push(Object.assign({}, l, {
        sl_no: 'F-' + l.sl_no,
        description: '[Fixed ' + fixedHFt.toFixed(1) + 'ft] ' + l.description
      }));
    });
    (operableRes.lines || []).forEach(function(l) {
      comboBomLines.push(Object.assign({}, l, {
        sl_no: 'O-' + l.sl_no,
        description: '[Operable ' + operableHFt.toFixed(1) + 'ft] ' + l.description
      }));
    });

    return {
      widthFt: widthFt, heightFt: heightFt, options: options,
      isCombo: true,
      fixedHFt: fixedHFt, operableHFt: operableHFt,
      fixedPrice: fixedRes.priceExTax, operablePrice: operableRes.priceExTax,
      W: W, H: H, A: A,
      lines: comboBomLines,
      subtotal: fixedRes.subtotal + operableRes.subtotal,
      wastage: fixedRes.wastage + operableRes.wastage,
      totalCost: fixedRes.totalCost + operableRes.totalCost,
      margin: fixedRes.margin + operableRes.margin,
      priceExTax: totalPriceExTax,
      ratePerSqm: ratePerSqm,
      ratePerSqft: ratePerSqft,
      priceInclGst: priceInclGst,
      wastagePct: wastagePct, marginPct: marginPct, gstPct: gstPct
    };
  }

  var alRate    = Number(settings.aluminium_rate_per_kg) || 500;
  var upvcRate  = Number(settings.upvc_rate_per_kg) || 380;
  var steelRate = Number(settings.upvc_steel_rate_per_kg) || 120;
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
      var profRate = alRate;
      var isUpvcMat = (line.material && line.material.toLowerCase() === 'upvc') ||
                      (template && template.material_type === 'upvc') ||
                      (template && template.series && /upvc/i.test(template.series)) ||
                      (line.profile_no && /upvc/i.test(line.profile_no));
      var isSteelReinforce = (line.material && line.material.toLowerCase() === 'steel') ||
                             (line.description && /reinforce|steel/i.test(line.description));

      if (isSteelReinforce) {
        profRate = steelRate;
      } else if (isUpvcMat) {
        profRate = upvcRate;
      }
      if (Number(line.unit_price) > 0) profRate = Number(line.unit_price);
      amount = totalMetres * w * profRate;
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
  return {
    aluminium_rate_per_kg: 500,
    upvc_rate_per_kg: 380,
    upvc_steel_rate_per_kg: 120,
    wastage_pct: 5,
    margin_pct: 35,
    gst_pct: 18,
    labour_rate_per_sqm: 500,
    sqft_per_sqm: 10.764,
    ft_to_m: 0.3048
  };
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
    },
    // Template 5: Combo Fixed + 2.5T Sliding Door (F+SD) (Section 1.4 & Section 4)
    {
      id: 'tpl_combo_fixed_sliding_door',
      name: 'Combo Fixed + 2.5T Sliding Door (F+SD)',
      series: 'Domal 27',
      category: 'combo',
      material_type: 'aluminium',
      fixed_template_id: 'tpl_fixed_window',
      operable_template_id: 'tpl_sliding_door',
      default_operable_h: 7,
      allows_mesh: true,
      default_glass: '8mm Toughened Clear',
      default_handle: 'Pop-up Handle',
      lines: []
    },
    // Template 6: UPVC 2-Track 2-Panel Sliding Window (60mm Series)
    {
      id: 'tpl_upvc_sliding_window',
      name: 'UPVC 2-Track 2-Panel Sliding Window',
      series: '60mm UPVC System',
      category: 'window',
      material_type: 'upvc',
      allows_mesh: true,
      default_handle: 'Standard Handle',
      default_glass: '6mm Toughened',
      lines: [
        { sl_no: 1, description: 'UPVC 2-Track Outer Frame Top', kind: 'profile', length_expr: 'W', nos_expr: '1', weight_kg_per_m: 1.20, profile_no: 'UPVC-OF-60', material: 'upvc' },
        { sl_no: 2, description: 'UPVC 2-Track Outer Frame Bottom', kind: 'profile', length_expr: 'W', nos_expr: '1', weight_kg_per_m: 1.20, profile_no: 'UPVC-OF-60', material: 'upvc' },
        { sl_no: 3, description: 'UPVC 2-Track Outer Frame Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.20, profile_no: 'UPVC-OF-60', material: 'upvc' },
        { sl_no: 4, description: 'UPVC Sliding Sash Horizontal', kind: 'profile', length_expr: 'W', nos_expr: '2', weight_kg_per_m: 1.10, profile_no: 'UPVC-SS-60', material: 'upvc' },
        { sl_no: 5, description: 'UPVC Sliding Sash Vertical', kind: 'profile', length_expr: 'H', nos_expr: '4', weight_kg_per_m: 1.10, profile_no: 'UPVC-SS-60', material: 'upvc' },
        { sl_no: 6, description: 'UPVC Interlock Profile', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 0.40, profile_no: 'UPVC-IL-60', material: 'upvc' },
        { sl_no: 7, description: 'Galvanized Steel Reinforcement', kind: 'profile', length_expr: '2*W+4*H', nos_expr: '1', weight_kg_per_m: 0.85, profile_no: 'UPVC-STEEL', material: 'steel' },
        { sl_no: 8, description: 'EPDM Glazing Gasket for Sash', kind: 'gasket', length_expr: 'L4+L5', nos_expr: '1', unit_price: 15 },
        { sl_no: 9, description: 'Wool Pile Brush Seal', kind: 'brush_seal', length_expr: '6*W+6*H', nos_expr: '1', unit_price: 5 },
        { sl_no: 10, description: 'Heavy Duty Nylon Rollers', kind: 'hardware', length_expr: '0', nos_expr: '4', unit_price: 65 },
        { sl_no: 11, description: 'Crescent / Touch Lock', kind: 'hardware', length_expr: '0', nos_expr: '2', unit_price: 60 },
        { sl_no: 12, description: 'UPVC Fusion Welding & Labour', kind: 'labour', length_expr: 'A', nos_expr: '1', unit_price: 450 },
        { sl_no: 13, description: 'Glass', kind: 'glass', length_expr: 'A', nos_expr: '1', unit_price: 0 },
        { sl_no: 14, description: 'SS Mesh', kind: 'mesh', length_expr: 'A/2', nos_expr: '1', unit_price: 290, condition: "mesh != 'NA'" }
      ]
    },
    // Template 7: UPVC 2-Track 2-Panel Sliding Door (60mm Heavy Duty)
    {
      id: 'tpl_upvc_sliding_door',
      name: 'UPVC 2-Track 2-Panel Sliding Door',
      series: '60mm UPVC Heavy Duty',
      category: 'door',
      material_type: 'upvc',
      allows_mesh: true,
      default_handle: 'Pop-up Handle',
      default_glass: '8mm Toughened Clear',
      lines: [
        { sl_no: 1, description: 'UPVC Door Outer Frame Top', kind: 'profile', length_expr: 'W', nos_expr: '1', weight_kg_per_m: 1.45, profile_no: 'UPVC-OFD-60', material: 'upvc' },
        { sl_no: 2, description: 'UPVC Door Outer Frame Bottom Track', kind: 'profile', length_expr: 'W', nos_expr: '1', weight_kg_per_m: 1.45, profile_no: 'UPVC-OFD-60', material: 'upvc' },
        { sl_no: 3, description: 'UPVC Door Outer Frame Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.45, profile_no: 'UPVC-OFD-60', material: 'upvc' },
        { sl_no: 4, description: 'UPVC Door Sash Horizontal', kind: 'profile', length_expr: 'W', nos_expr: '2', weight_kg_per_m: 1.35, profile_no: 'UPVC-SSD-60', material: 'upvc' },
        { sl_no: 5, description: 'UPVC Door Sash Vertical', kind: 'profile', length_expr: 'H', nos_expr: '4', weight_kg_per_m: 1.35, profile_no: 'UPVC-SSD-60', material: 'upvc' },
        { sl_no: 6, description: 'UPVC Interlock Profile', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 0.40, profile_no: 'UPVC-IL-60', material: 'upvc' },
        { sl_no: 7, description: 'Galvanized Steel Reinforcement', kind: 'profile', length_expr: '2*W+4*H', nos_expr: '1', weight_kg_per_m: 1.10, profile_no: 'UPVC-STEEL', material: 'steel' },
        { sl_no: 8, description: 'Glazing & Weather Gasket', kind: 'gasket', length_expr: 'L4+L5', nos_expr: '1', unit_price: 18 },
        { sl_no: 9, description: 'Wool Pile Seal', kind: 'brush_seal', length_expr: '6*W+6*H', nos_expr: '1', unit_price: 6 },
        { sl_no: 10, description: 'Heavy Duty Tandem Rollers', kind: 'hardware', length_expr: '0', nos_expr: '4', unit_price: 110 },
        { sl_no: 11, description: 'Multi-Point Door Lock & Handle', kind: 'hardware', length_expr: '0', nos_expr: '1', unit_price: 320 },
        { sl_no: 12, description: 'UPVC Fusion Welding & Labour', kind: 'labour', length_expr: 'A', nos_expr: '1', unit_price: 500 },
        { sl_no: 13, description: 'Glass', kind: 'glass', length_expr: 'A', nos_expr: '1', unit_price: 0 }
      ]
    },
    // Template 8: UPVC Casement Window (Openable with Friction Stays)
    {
      id: 'tpl_upvc_casement_window',
      name: 'UPVC Casement / Openable Window',
      series: '60mm UPVC Casement',
      category: 'window',
      material_type: 'upvc',
      allows_mesh: false,
      default_handle: 'Standard Handle',
      default_glass: '5mm Clear',
      lines: [
        { sl_no: 1, description: 'UPVC Casement Outer Frame Top & Bottom', kind: 'profile', length_expr: 'W', nos_expr: '2', weight_kg_per_m: 1.25, profile_no: 'UPVC-COF-60', material: 'upvc' },
        { sl_no: 2, description: 'UPVC Casement Outer Frame Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.25, profile_no: 'UPVC-COF-60', material: 'upvc' },
        { sl_no: 3, description: 'UPVC Casement Sash Frame Top & Bottom', kind: 'profile', length_expr: 'W', nos_expr: '2', weight_kg_per_m: 1.15, profile_no: 'UPVC-CSF-60', material: 'upvc' },
        { sl_no: 4, description: 'UPVC Casement Sash Frame Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.15, profile_no: 'UPVC-CSF-60', material: 'upvc' },
        { sl_no: 5, description: 'UPVC Glazing Bead', kind: 'profile', length_expr: '2*W+2*H', nos_expr: '1', weight_kg_per_m: 0.28, profile_no: 'UPVC-GB-60', material: 'upvc' },
        { sl_no: 6, description: 'Steel Reinforcement Section', kind: 'profile', length_expr: '2*W+2*H', nos_expr: '1', weight_kg_per_m: 0.85, profile_no: 'UPVC-STEEL', material: 'steel' },
        { sl_no: 7, description: 'EPDM Double Sealing Gaskets', kind: 'gasket', length_expr: '4*W+4*H', nos_expr: '1', unit_price: 16 },
        { sl_no: 8, description: 'Stainless Steel Friction Stays (Pair)', kind: 'hardware', length_expr: '0', nos_expr: '2', unit_price: 120 },
        { sl_no: 9, description: 'Espag Multi-point Locking Handle', kind: 'hardware', length_expr: '0', nos_expr: '1', unit_price: 150 },
        { sl_no: 10, description: 'UPVC Fabrication & Labour', kind: 'labour', length_expr: 'A', nos_expr: '1', unit_price: 450 },
        { sl_no: 11, description: 'Glass', kind: 'glass', length_expr: 'A', nos_expr: '1', unit_price: 0 }
      ]
    },
    // Template 9: UPVC Openable Casement Door
    {
      id: 'tpl_upvc_casement_door',
      name: 'UPVC Openable Casement Door',
      series: '60mm UPVC Door System',
      category: 'door',
      material_type: 'upvc',
      allows_mesh: false,
      default_handle: 'Standard Handle',
      default_glass: '8mm Toughened Clear',
      lines: [
        { sl_no: 1, description: 'UPVC Door Outer Frame Top', kind: 'profile', length_expr: 'W', nos_expr: '1', weight_kg_per_m: 1.45, profile_no: 'UPVC-COFD-60', material: 'upvc' },
        { sl_no: 2, description: 'UPVC Door Outer Frame Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.45, profile_no: 'UPVC-COFD-60', material: 'upvc' },
        { sl_no: 3, description: 'UPVC Door Sash Top & Bottom', kind: 'profile', length_expr: 'W', nos_expr: '2', weight_kg_per_m: 1.40, profile_no: 'UPVC-CSD-60', material: 'upvc' },
        { sl_no: 4, description: 'UPVC Door Sash Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.40, profile_no: 'UPVC-CSD-60', material: 'upvc' },
        { sl_no: 5, description: 'UPVC Glazing Bead', kind: 'profile', length_expr: '2*W+2*H', nos_expr: '1', weight_kg_per_m: 0.28, profile_no: 'UPVC-GB-60', material: 'upvc' },
        { sl_no: 6, description: 'Galvanized Steel Reinforcement', kind: 'profile', length_expr: '2*W+2*H', nos_expr: '1', weight_kg_per_m: 1.20, profile_no: 'UPVC-STEEL', material: 'steel' },
        { sl_no: 7, description: 'EPDM Perimeter Gasket', kind: 'gasket', length_expr: '4*W+4*H', nos_expr: '1', unit_price: 18 },
        { sl_no: 8, description: 'Heavy Duty 3D Adjustable Hinges', kind: 'hardware', length_expr: '0', nos_expr: '3', unit_price: 180 },
        { sl_no: 9, description: 'Multi-point Door Espag & Lever Handle', kind: 'hardware', length_expr: '0', nos_expr: '1', unit_price: 380 },
        { sl_no: 10, description: 'UPVC Door Fabrication & Labour', kind: 'labour', length_expr: 'A', nos_expr: '1', unit_price: 550 },
        { sl_no: 11, description: 'Glass', kind: 'glass', length_expr: 'A', nos_expr: '1', unit_price: 0 }
      ]
    },
    // Template 10: UPVC Fixed Window
    {
      id: 'tpl_upvc_fixed_window',
      name: 'UPVC Fixed Glass Window (60mm)',
      series: '60mm UPVC System',
      category: 'window',
      material_type: 'upvc',
      allows_mesh: false,
      default_glass: '6mm Toughened',
      lines: [
        { sl_no: 1, description: 'UPVC Fixed Outer Frame Top & Bottom', kind: 'profile', length_expr: 'W', nos_expr: '2', weight_kg_per_m: 1.10, profile_no: 'UPVC-COF-60', material: 'upvc' },
        { sl_no: 2, description: 'UPVC Fixed Outer Frame Verticals', kind: 'profile', length_expr: 'H', nos_expr: '2', weight_kg_per_m: 1.10, profile_no: 'UPVC-COF-60', material: 'upvc' },
        { sl_no: 3, description: 'UPVC Glazing Bead', kind: 'profile', length_expr: '2*W+2*H', nos_expr: '1', weight_kg_per_m: 0.28, profile_no: 'UPVC-GB-60', material: 'upvc' },
        { sl_no: 4, description: 'Galvanized Steel Reinforcement', kind: 'profile', length_expr: '2*W+2*H', nos_expr: '1', weight_kg_per_m: 0.80, profile_no: 'UPVC-STEEL', material: 'steel' },
        { sl_no: 5, description: 'EPDM Glazing Gaskets', kind: 'gasket', length_expr: '4*W+4*H', nos_expr: '1', unit_price: 14 },
        { sl_no: 6, description: 'UPVC Fabrication & Labour', kind: 'labour', length_expr: 'A', nos_expr: '1', unit_price: 350 },
        { sl_no: 7, description: 'Glass', kind: 'glass', length_expr: 'A', nos_expr: '1', unit_price: 0 }
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
    // Profiles (Aluminium)
    { category: 'profile', code: '5045', name: 'Outer Frame Top / Bottom / Verticals (Domal 27)', unit: 'kg/m', weight_kg_per_m: 1.28, rate: 500, material: 'aluminium', active: true },
    { category: 'profile', code: '5047', name: 'Sliding Sash (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.78, rate: 500, material: 'aluminium', active: true },
    { category: 'profile', code: '5042', name: 'Interlock (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.35, rate: 500, material: 'aluminium', active: true },
    { category: 'profile', code: '5043', name: 'Mesh Sash (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.90, rate: 500, material: 'aluminium', active: true },
    { category: 'profile', code: '5008', name: 'Outer Frame Top / Vertical (Fixed Window)', unit: 'kg/m', weight_kg_per_m: 0.60, rate: 500, material: 'aluminium', active: true },
    { category: 'profile', code: '5006', name: 'Mullion (Fixed Window / Vent)', unit: 'kg/m', weight_kg_per_m: 0.68, rate: 500, material: 'aluminium', active: true },
    { category: 'profile', code: '5013', name: 'Glazing Bead (Fixed Window)', unit: 'kg/m', weight_kg_per_m: 0.26, rate: 500, material: 'aluminium', active: true },

    // Profiles (UPVC & Steel Reinforcement)
    { category: 'profile', code: 'UPVC-OF-60', name: 'UPVC 60mm 2-Track Outer Frame', unit: 'kg/m', weight_kg_per_m: 1.20, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-SS-60', name: 'UPVC 60mm Sliding Sash Profile', unit: 'kg/m', weight_kg_per_m: 1.10, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-IL-60', name: 'UPVC Interlock Profile', unit: 'kg/m', weight_kg_per_m: 0.40, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-OFD-60', name: 'UPVC 60mm Door Outer Frame', unit: 'kg/m', weight_kg_per_m: 1.45, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-SSD-60', name: 'UPVC 60mm Door Sash Profile', unit: 'kg/m', weight_kg_per_m: 1.35, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-COF-60', name: 'UPVC Casement Outer Frame 60mm', unit: 'kg/m', weight_kg_per_m: 1.25, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-CSF-60', name: 'UPVC Casement Sash 60mm', unit: 'kg/m', weight_kg_per_m: 1.15, rate: 380, material: 'upvc', active: true },
    { category: 'profile', code: 'UPVC-STEEL', name: 'UPVC Galvanized Steel Reinforcement', unit: 'kg/m', weight_kg_per_m: 0.85, rate: 120, material: 'steel', active: true },

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
  normalizeExpr: normalizeExpr,
  evalExpr: evalExpr,
  validateFormula: validateFormula,
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
