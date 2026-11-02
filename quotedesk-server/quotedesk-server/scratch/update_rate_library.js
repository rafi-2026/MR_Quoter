'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', '..', '..', '..', 'd:', 'MY website', 'MR_Quoter', 'quotedesk-server', 'quotedesk-server', 'public', 'index.html');
const actualPath = 'd:\\MY website\\MR_Quoter\\quotedesk-server\\quotedesk-server\\public\\index.html';

let html = fs.readFileSync(actualPath, 'utf8');

const targetStr = `    let rateTab = 'products';
    function viewRates() {
      const m = $('#main'), ed = canEditRates() && canWrite();
      m.innerHTML = \`<div class="ph"><div><h1>Rate library</h1><div class="mute">\${ed ? 'Rates and profiles set here are copied into new quotes. Changing them later does not alter existing quotes.' : 'Read only. Manager, MD or authorised roles can change rates and profiles.'}</div></div></div>
  <div class="note" style="margin-bottom:14px">The products, items, profiles and rates here are sample entries. Replace them with your own rates before sending quotations.</div>
  <div class="chips" style="margin-bottom:14px">\${[['products', 'Windows, doors and facades'], ['items', 'BOQ items'], ['profiles', 'Profiles (Aluminium & uPVC)'], ['options', 'Glass and finish options']].map(([k, t]) => \`<button class="chip \${rateTab === k ? 'on' : ''}" data-act="rtab" data-t="\${k}">\${t}</button>\`).join('')}</div><div id="rbody"></div>\`;
      drawRates();
    }
    ACT.rtab = b => { rateTab = b.dataset.t; viewRates() };
    function drawRates() {
      const ed = canEditRates() && canWrite(), b = $('#rbody');
      if (rateTab === 'products') {
        b.innerHTML = \`<div class="card"><div class="card-h"><h3>Size-based products (rate per sq ft)</h3>\${ed ? '<button class="btn pri sm" data-act="prodEdit">Add product</button>' : ''}</div><div class="scx"><table class="tbl"><thead><tr><th>Product</th><th>Type</th><th class="r">Rate / sq ft</th><th class="r">Min area</th>\${ed ? '<th class="r">Cost / sq ft</th><th></th>' : ''}</tr></thead><tbody>\${db.products.map(p => \`<tr><td><b>\${esc(p.name)}</b><div class="mute sm">\${esc(p.desc)}</div></td><td>\${esc(GLYPHS[p.glyph] || '')}</td><td class="r">\${rs(p.rate)}</td><td class="r">\${p.minArea ? inr(p.minArea) + ' sq ft' : '-'}</td>\${ed ? \`<td class="r">\${p.cost ? rs(p.cost) : '-'}</td><td class="r nowrap"><button class="btn sm" data-act="prodEdit" data-id="\${p.id}">Edit</button> <button class="btn sm bad" data-act="prodDel" data-id="\${p.id}">Delete</button></td>\` : ''}</tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No products yet.</div></td></tr>\`}</tbody></table></div></div>\`;
      } else if (rateTab === 'items') {
        b.innerHTML = \`<div class="card"><div class="card-h"><h3>BOQ items (construction, interiors, other works)</h3>\${ed ? '<button class="btn pri sm" data-act="itemEdit">Add item</button>' : ''}</div><div class="scx"><table class="tbl"><thead><tr><th>Category</th><th>Description</th><th>Unit</th><th class="r">Rate</th>\${ed ? '<th class="r">Cost</th><th></th>' : ''}</tr></thead><tbody>\${db.items.map(p => \`<tr><td>\${esc(p.category)}</td><td>\${esc(p.desc)}</td><td>\${esc(p.unit)}</td><td class="r">\${rs(p.rate)}</td>\${ed ? \`<td class="r">\${p.cost ? rs(p.cost) : '-'}</td><td class="r nowrap"><button class="btn sm" data-act="itemEdit" data-id="\${p.id}">Edit</button> <button class="btn sm bad" data-act="itemDel" data-id="\${p.id}">Delete</button></td>\` : ''}</tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No items yet.</div></td></tr>\`}</tbody></table></div></div>\`;
      } else if (rateTab === 'profiles') {
        const profs = db.profiles || [];
        b.innerHTML = \`<div class="card"><div class="card-h"><h3>Aluminium &amp; uPVC Profile Master Database</h3>\${ed ? '<button class="btn pri sm" data-act="profEdit">Add Profile</button>' : ''}</div><div class="mute sm" style="margin-bottom:8px">Upload profile specifications with images. These are used in the Profile Cost Calculator on each quote line item.</div><div class="scx"><table class="tbl"><thead><tr><th>Image</th><th>Profile Name</th><th>Material</th><th>Series</th><th>Dimensions</th><th class="r">Weight (kg/m)</th><th class="r">Rate / kg</th>\${ed ? '<th></th>' : ''}</tr></thead><tbody>\${profs.map(p => \`<tr><td>\${p.img ? \`<img src="\${p.img}" alt="" style="width:60px;height:44px;object-fit:contain;border:1px solid var(--line);border-radius:3px">\` : "<span class='mute sm'>No image</span>"}</td><td><b>\${esc(p.name)}</b><div class="mute sm">\${esc(p.desc)}</div></td><td><span class="bd \${p.material === 'UPVC' ? 'pending' : 'approved'}">\${esc(p.material)}</span></td><td>\${esc(p.series)}</td><td class="mute sm">\${p.widthMm ? \`\${p.widthMm}×\${p.depthMm}mm\${p.thicknessMm ? ' t=' + p.thicknessMm : ''}\` : '-'}</td><td class="r">\${inr(p.weightPerM, 2)} kg/m</td><td class="r">\${rs(p.ratePerKg)}</td>\${ed ? \`<td class="r nowrap"><button class="btn sm" data-act="profEdit" data-id="\${p.id}">Edit</button> <button class="btn sm bad" data-act="profDel" data-id="\${p.id}">Delete</button></td>\` : ''}</tr>\`).join('') || \`<tr><td colspan="8"><div class="empty">No profiles added yet. Click Add Profile to start building your database.</div></td></tr>\`}</tbody></table></div></div>\`;
      } else {
        const tbl = (key, title) => \`<div class="card"><div class="card-h"><h3>\${title}</h3>\${ed ? \`<button class="btn sm" data-act="optAdd" data-k="\${key}">Add option</button>\` : ''}</div><div class="mute sm" style="margin-bottom:8px">Extra charge per sq ft added to the base rate.</div>\${db.settings[key].map((o, i) => \`<div class="row2"><input value="\${esc(o.name)}" data-opt="\${key}" data-i="\${i}" data-f="name" \${ed ? '' : 'disabled'}><input type="number" step="any" value="\${o.add}" data-opt="\${key}" data-i="\${i}" data-f="add" \${ed ? '' : 'disabled'}>\${ed ? \`<button class="btn sm bad" data-act="optDel" data-k="\${key}" data-i="\${i}">Remove</button>\` : '<span></span>'}</div>\`).join('')}</div>\`;
        b.innerHTML = \`<div class="grid g2">\${tbl('glass', 'Glass options')}\${tbl('finish', 'Finish options')}</div>\`;
      }
    }`;

const replacementStr = `    let rateTab = 'templates';
    let selectedTemplateId = null;

    function getMaterialUsage(mat) {
      const tpls = db.productTemplates || [];
      let count = 0;
      tpls.forEach(t => {
        const lines = t.lines || [];
        const used = lines.some(l => {
          if (mat.category === 'profile') return String(l.profile_no || '').trim() === String(mat.code || '').trim();
          if (mat.category === 'glass') return l.kind === 'glass';
          if (mat.category === 'mesh') return l.kind === 'mesh';
          if (mat.category === 'hardware') return l.kind === 'hardware' && (l.description === mat.name || String(l.profile_no || '') === String(mat.code || ''));
          if (mat.category === 'gasket') return (l.kind === 'gasket' || l.kind === 'brush_seal') && (l.description === mat.name || String(l.profile_no || '') === String(mat.code || ''));
          return false;
        });
        if (used) count++;
      });
      return count;
    }

    function viewRates() {
      const m = $('#main'), ed = canEditRates() && canWrite();
      const rateTabsList = [
        ['templates', '⚡ Product Templates (BOM Costing)'],
        ['profiles', 'Profiles (kg/m)'],
        ['glass', 'Glass library'],
        ['mesh_handle', 'Mesh & Handles'],
        ['hardware', 'Hardware'],
        ['gaskets', 'Gaskets & Seals'],
        ['products', 'Custom Products'],
        ['items', 'BOQ items'],
        ['options', 'Legacy options']
      ];
      m.innerHTML = \`<div class="ph"><div><h1>Rate library</h1><div class="mute">\${ed ? 'Rates, materials and BOM templates set here are used by the auto costing engine for accurate quotation pricing.' : 'Read only. Manager or authorised roles can change rates and templates.'}</div></div></div>
  <div class="note" style="margin-bottom:14px">Materials, rates and product templates are specific to your company. All BOM line amounts calculate automatically with Excel-matching precision.</div>
  <div class="chips" style="margin-bottom:14px">\${rateTabsList.map(([k, t]) => \`<button class="chip \${rateTab === k ? 'on' : ''}" data-act="rtab" data-t="\${k}">\${t}</button>\`).join('')}</div><div id="rbody"></div>\`;
      drawRates();
    }
    ACT.rtab = b => { rateTab = b.dataset.t; selectedTemplateId = null; viewRates() };

    function drawRates() {
      const ed = canEditRates() && canWrite(), b = $('#rbody');
      db.materials = db.materials || [];
      db.productTemplates = db.productTemplates || [];

      if (rateTab === 'templates') {
        const tpls = db.productTemplates || [];
        if (selectedTemplateId) {
          const tpl = tpls.find(t => t.id === selectedTemplateId) || tpls[0];
          if (!tpl) { selectedTemplateId = null; drawRates(); return; }
          const cs = db.costingSettings || CostingEngine.getDefaultCostingSettings();
          const mats = db.materials || [];
          const glassMats = mats.filter(m => m.category === 'glass');
          const meshMats = mats.filter(m => m.category === 'mesh');
          const rates = {
            glass: glassMats,
            mesh: meshMats,
            handle: mats.filter(m => m.category === 'hardware')
          };
          const defGlassId = tpl.default_glass ? (glassMats.find(g => g.name === tpl.default_glass)?.id || glassMats[0]?.id) : glassMats[0]?.id;
          const previewRes = CostingEngine.calculateItem(tpl, tpl.lines, 10, 6, { glass_id: defGlassId, mesh: tpl.allows_mesh ? 'SS Mesh' : 'NA' }, cs, rates);

          b.innerHTML = \`<div class="card" style="margin-bottom:16px">
            <div class="card-h">
              <div style="display:flex;align-items:center;gap:10px">
                <button class="btn sm" data-act="tplBack">← Back to Templates</button>
                <div>
                  <h3 style="margin:0">\${esc(tpl.name)}</h3>
                  <div class="mute sm">Series: <b>\${esc(tpl.series || 'Domal 27')}</b> &bull; Category: \${esc(tpl.category || 'window')} &bull; Mesh: \${tpl.allows_mesh ? 'Allowed' : 'Not applicable'}</div>
                </div>
              </div>
              <div class="acts">
                \${ed ? \`<button class="btn sm" data-act="tplDuplicate" data-id="\${tpl.id}">Duplicate</button>\` : ''}
              </div>
            </div>

            <!-- Live Preview Top Bar -->
            <div style="background:var(--bg);padding:14px;border-radius:6px;border:1px solid var(--line);margin-bottom:16px">
              <div style="font-weight:600;margin-bottom:10px;color:var(--pri)">⚡ Live Costing Preview &amp; Auto Recalculator</div>
              <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
                <label class="f" style="margin:0"><span>Width (ft)</span><input id="prev_w" type="number" step="any" value="10" style="width:90px" oninput="ACT.tplLiveRecalc()"></label>
                <label class="f" style="margin:0"><span>Height (ft)</span><input id="prev_h" type="number" step="any" value="6" style="width:90px" oninput="ACT.tplLiveRecalc()"></label>
                <label class="f" style="margin:0"><span>Glass Type</span>
                  <select id="prev_glass" onchange="ACT.tplLiveRecalc()">
                    \${glassMats.map(g => \`<option value="\${g.id}" \${g.id === defGlassId ? 'selected' : ''}>\${esc(g.name)} (₹\${g.rate}/sqm)</option>\`).join('')}
                  </select>
                </label>
                <label class="f" style="margin:0"><span>Mesh Provision</span>
                  <select id="prev_mesh" onchange="ACT.tplLiveRecalc()">
                    \${tpl.allows_mesh ? '<option value="SS Mesh" selected>SS Mesh (₹290/sqm)</option>' : ''}
                    <option value="NA" \${!tpl.allows_mesh ? 'selected' : ''}>NA (No Mesh)</option>
                  </select>
                </label>
              </div>

              <!-- Live Calculated Badges -->
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:14px">
                <div style="background:var(--card);padding:10px;border-radius:4px;border:1px solid var(--line)">
                  <div class="mute sm">Billing Area</div>
                  <div id="prev_res_area" style="font-weight:600">60.0 sqft (\${previewRes.A.toFixed(2)} sqm)</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:1px solid var(--line)">
                  <div class="mute sm">Subtotal BOM</div>
                  <div id="prev_res_subtotal" style="font-weight:600">₹\${previewRes.subtotal.toFixed(2)}</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:1px solid var(--line)">
                  <div class="mute sm">Wastage (5%)</div>
                  <div id="prev_res_wastage" style="font-weight:600">₹\${previewRes.wastage.toFixed(2)}</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:1px solid var(--line)">
                  <div class="mute sm">Total Cost</div>
                  <div id="prev_res_totalcost" style="font-weight:600">₹\${previewRes.totalCost.toFixed(2)}</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:1px solid var(--line)">
                  <div class="mute sm">Margin (35%)</div>
                  <div id="prev_res_margin" style="font-weight:600">₹\${previewRes.margin}</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:2px solid var(--pri)">
                  <div class="mute sm" style="color:var(--pri);font-weight:600">Price Ex-Tax</div>
                  <div id="prev_res_price" style="font-size:18px;font-weight:700;color:var(--pri)">₹\${previewRes.priceExTax.toLocaleString('en-IN')}</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:2px solid var(--pri)">
                  <div class="mute sm" style="color:var(--pri);font-weight:600">Rate / Sq Ft</div>
                  <div id="prev_res_sqft" style="font-size:18px;font-weight:700;color:var(--pri)">₹\${previewRes.ratePerSqft} / sqft</div>
                </div>
                <div style="background:var(--card);padding:10px;border-radius:4px;border:1px solid var(--line)">
                  <div class="mute sm">Price Incl GST (18%)</div>
                  <div id="prev_res_gst" style="font-weight:600">₹\${previewRes.priceInclGst.toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            <!-- BOM Lines Table -->
            <div class="card-h">
              <h4>Bill of Materials (BOM Structure)</h4>
              <div class="mute sm">Formulas evaluate W, H, A (metres/sqm) and prior profile total metres (L1, L2...).</div>
            </div>
            <div class="scx">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Sl</th><th>Profile No</th><th>Description</th><th>Kind</th>
                    <th>Length Formula</th><th>Nos Formula</th><th class="r">kg/m</th><th class="r">Unit Price</th>
                    <th class="r">Calc Length</th><th class="r">Calc Nos</th><th class="r">Line Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  \${(tpl.lines || []).map((l, idx) => {
                    const pl = previewRes.lines.find(x => x.sl_no === l.sl_no) || { evaluatedLen: 0, evaluatedNos: 0, amount: 0 };
                    return \`<tr>
                      <td>\${l.sl_no || (idx + 1)}</td>
                      <td><b>\${esc(l.profile_no || '-')}</b></td>
                      <td>\${esc(l.description || '')}</td>
                      <td><span class="bd pending">\${esc(l.kind || 'profile')}</span></td>
                      <td><code>\${esc(l.length_expr || '')}</code></td>
                      <td><code>\${esc(l.nos_expr || '')}</code></td>
                      <td class="r">\${l.weight_kg_per_m ? inr(l.weight_kg_per_m, 2) : '-'}</td>
                      <td class="r">\${l.unit_price ? rs(l.unit_price) : (l.kind === 'profile' ? rs(cs.aluminium_rate_per_kg || 500) : '-')}</td>
                      <td class="r" id="line_len_\${l.sl_no}">\${pl.evaluatedLen ? pl.evaluatedLen.toFixed(3) + ' m' : '-'}</td>
                      <td class="r" id="line_nos_\${l.sl_no}">\${pl.evaluatedNos || '-'}</td>
                      <td class="r" id="line_amt_\${l.sl_no}" style="font-weight:600">\${rs(pl.amount)}</td>
                    </tr>\`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>\`;
        } else {
          // Templates List
          b.innerHTML = \`<div class="card">
            <div class="card-h">
              <h3>Product Costing Templates (Excel BOM Engine)</h3>
              <div class="mute sm">Pre-configured product templates verified against Excel sheets 2TM, SD, F, and V.</div>
            </div>
            <div class="scx">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Template Name</th>
                    <th>Series</th>
                    <th>Category</th>
                    <th>Mesh Provision</th>
                    <th>Default Glass</th>
                    <th>BOM Lines</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  \${tpls.map(t => \`<tr>
                    <td><b>\${esc(t.name)}</b></td>
                    <td>\${esc(t.series || 'Domal 27')}</td>
                    <td><span class="bd approved">\${esc(t.category || 'window')}</span></td>
                    <td>\${t.allows_mesh ? '✓ SS Mesh' : '<span class="mute">No</span>'}</td>
                    <td>\${esc(t.default_glass || '6mm Toughened')}</td>
                    <td>\${(t.lines || []).length} lines</td>
                    <td class="r nowrap">
                      <button class="btn sm pri" data-act="tplOpen" data-id="\${t.id}">View / Edit BOM &amp; Live Preview</button>
                      \${ed ? \`<button class="btn sm" data-act="tplDuplicate" data-id="\${t.id}">Duplicate</button>\` : ''}
                    </td>
                  </tr>\`).join('') || \`<tr><td colspan="7"><div class="empty">No templates found. Click Run seed or reload to initialize.</div></td></tr>\`}
                </tbody>
              </table>
            </div>
          </div>\`;
        }
      } else if (rateTab === 'profiles') {
        const profs = db.materials.filter(m => m.category === 'profile');
        b.innerHTML = \`<div class="card">
          <div class="card-h">
            <h3>Aluminium Profiles Master Database</h3>
            \${ed ? '<button class="btn pri sm" data-act="matEdit" data-cat="profile">+ Add Profile</button>' : ''}
          </div>
          <div class="mute sm" style="margin-bottom:8px">Profile sections used in BOM formulas. Rate per kg defaults to costing settings if left blank.</div>
          <div class="scx">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Profile Code</th>
                  <th>Profile Description</th>
                  <th class="r">Weight (kg/m)</th>
                  <th class="r">Rate / kg</th>
                  <th class="r">Used in Templates</th>
                  \${ed ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                \${profs.map(p => \`<tr>
                  <td><b>\${esc(p.code || '-')}</b></td>
                  <td>\${esc(p.name)}</td>
                  <td class="r">\${inr(p.weightPerM, 2)} kg/m</td>
                  <td class="r">\${p.rate ? rs(p.rate) : \`<span class="mute sm">\${rs(db.costingSettings?.aluminium_rate_per_kg || 500)} (base)</span>\`}</td>
                  <td class="r"><span class="bd pending">\${getMaterialUsage(p)} templates</span></td>
                  \${ed ? \`<td class="r nowrap"><button class="btn sm" data-act="matEdit" data-id="\${p.id}" data-cat="profile">Edit</button> <button class="btn sm bad" data-act="matDel" data-id="\${p.id}">Delete</button></td>\` : ''}
                </tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No profiles found.</div></td></tr>\`}
              </tbody>
            </table>
          </div>
        </div>\`;
      } else if (rateTab === 'glass') {
        const glass = db.materials.filter(m => m.category === 'glass');
        b.innerHTML = \`<div class="card">
          <div class="card-h">
            <h3>Glass Library (\${'₹'} / sqm)</h3>
            \${ed ? '<button class="btn pri sm" data-act="matEdit" data-cat="glass">+ Add Glass</button>' : ''}
          </div>
          <div class="mute sm" style="margin-bottom:8px">Rates per square metre. Used automatically when selecting glass type on a quotation line.</div>
          <div class="scx">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Glass Type &amp; Specification</th>
                  <th class="r">Rate (\${'₹'} / sqm)</th>
                  <th class="r">Used in Templates</th>
                  \${ed ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                \${glass.map(g => \`<tr>
                  <td><code>\${esc(g.code || '-')}</code></td>
                  <td><b>\${esc(g.name)}</b></td>
                  <td class="r font-bold">\${rs(g.rate)} / sqm</td>
                  <td class="r"><span class="bd pending">\${getMaterialUsage(g)} templates</span></td>
                  \${ed ? \`<td class="r nowrap"><button class="btn sm" data-act="matEdit" data-id="\${g.id}" data-cat="glass">Edit</button> <button class="btn sm bad" data-act="matDel" data-id="\${g.id}">Delete</button></td>\` : ''}
                </tr>\`).join('') || \`<tr><td colspan="5"><div class="empty">No glass types found.</div></td></tr>\`}
              </tbody>
            </table>
          </div>
        </div>\`;
      } else if (rateTab === 'mesh_handle') {
        const mh = db.materials.filter(m => m.category === 'mesh' || (m.category === 'hardware' && (m.name.toLowerCase().includes('handle') || m.code.includes('H-'))));
        b.innerHTML = \`<div class="card">
          <div class="card-h">
            <h3>Mesh &amp; Handle Types</h3>
            <div class="acts">
              \${ed ? '<button class="btn pri sm" data-act="matEdit" data-cat="mesh">+ Add Mesh</button> <button class="btn sm" data-act="matEdit" data-cat="hardware">+ Add Handle</button>' : ''}
            </div>
          </div>
          <div class="mute sm" style="margin-bottom:8px">Mesh rate is per square metre (applied on A/2 in Excel). Handle price is per piece.</div>
          <div class="scx">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th class="r">Rate (\${'₹'})</th>
                  <th class="r">Used in Templates</th>
                  \${ed ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                \${mh.map(m => \`<tr>
                  <td><span class="bd \${m.category === 'mesh' ? 'approved' : 'pending'}">\${esc(m.category)}</span></td>
                  <td><code>\${esc(m.code || '-')}</code></td>
                  <td><b>\${esc(m.name)}</b></td>
                  <td>\${esc(m.unit || 'nos')}</td>
                  <td class="r font-bold">\${rs(m.rate)}</td>
                  <td class="r"><span class="bd pending">\${getMaterialUsage(m)} templates</span></td>
                  \${ed ? \`<td class="r nowrap"><button class="btn sm" data-act="matEdit" data-id="\${m.id}" data-cat="\${m.category}">Edit</button> <button class="btn sm bad" data-act="matDel" data-id="\${m.id}">Delete</button></td>\` : ''}
                </tr>\`).join('') || \`<tr><td colspan="7"><div class="empty">No items found.</div></td></tr>\`}
              </tbody>
            </table>
          </div>
        </div>\`;
      } else if (rateTab === 'hardware') {
        const hw = db.materials.filter(m => m.category === 'hardware');
        b.innerHTML = \`<div class="card">
          <div class="card-h">
            <h3>Hardware &amp; Accessories</h3>
            \${ed ? '<button class="btn pri sm" data-act="matEdit" data-cat="hardware">+ Add Hardware</button>' : ''}
          </div>
          <div class="mute sm" style="margin-bottom:8px">Rollers, touch locks, pop-up handles, corner cleats used in BOM line costing.</div>
          <div class="scx">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Hardware Item</th>
                  <th>Unit</th>
                  <th class="r">Unit Price (\${'₹'})</th>
                  <th class="r">Used in Templates</th>
                  \${ed ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                \${hw.map(h => \`<tr>
                  <td><code>\${esc(h.code || '-')}</code></td>
                  <td><b>\${esc(h.name)}</b></td>
                  <td>\${esc(h.unit || 'nos')}</td>
                  <td class="r font-bold">\${rs(h.rate)}</td>
                  <td class="r"><span class="bd pending">\${getMaterialUsage(h)} templates</span></td>
                  \${ed ? \`<td class="r nowrap"><button class="btn sm" data-act="matEdit" data-id="\${h.id}" data-cat="hardware">Edit</button> <button class="btn sm bad" data-act="matDel" data-id="\${h.id}">Delete</button></td>\` : ''}
                </tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No hardware items found.</div></td></tr>\`}
              </tbody>
            </table>
          </div>
        </div>\`;
      } else if (rateTab === 'gaskets') {
        const gsk = db.materials.filter(m => m.category === 'gasket');
        b.innerHTML = \`<div class="card">
          <div class="card-h">
            <h3>Gaskets &amp; Brush Seals (\${'₹'} / metre)</h3>
            \${ed ? '<button class="btn pri sm" data-act="matEdit" data-cat="gasket">+ Add Gasket / Seal</button>' : ''}
          </div>
          <div class="mute sm" style="margin-bottom:8px">Rates per metre for perimeter glazing gaskets and brush seals.</div>
          <div class="scx">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Gasket / Seal Type</th>
                  <th>Unit</th>
                  <th class="r">Rate (\${'₹'} / m)</th>
                  <th class="r">Used in Templates</th>
                  \${ed ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                \${gsk.map(g => \`<tr>
                  <td><code>\${esc(g.code || '-')}</code></td>
                  <td><b>\${esc(g.name)}</b></td>
                  <td>\${esc(g.unit || 'm')}</td>
                  <td class="r font-bold">\${rs(g.rate)} / m</td>
                  <td class="r"><span class="bd pending">\${getMaterialUsage(g)} templates</span></td>
                  \${ed ? \`<td class="r nowrap"><button class="btn sm" data-act="matEdit" data-id="\${g.id}" data-cat="gasket">Edit</button> <button class="btn sm bad" data-act="matDel" data-id="\${g.id}">Delete</button></td>\` : ''}
                </tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No gaskets found.</div></td></tr>\`}
              </tbody>
            </table>
          </div>
        </div>\`;
      } else if (rateTab === 'products') {
        b.innerHTML = \`<div class="card"><div class="card-h"><h3>Size-based products (rate per sq ft)</h3>\${ed ? '<button class="btn pri sm" data-act="prodEdit">Add product</button>' : ''}</div><div class="scx"><table class="tbl"><thead><tr><th>Product</th><th>Type</th><th class="r">Rate / sq ft</th><th class="r">Min area</th>\${ed ? '<th class="r">Cost / sq ft</th><th></th>' : ''}</tr></thead><tbody>\${db.products.map(p => \`<tr><td><b>\${esc(p.name)}</b><div class="mute sm">\${esc(p.desc)}</div></td><td>\${esc(GLYPHS[p.glyph] || '')}</td><td class="r">\${rs(p.rate)}</td><td class="r">\${p.minArea ? inr(p.minArea) + ' sq ft' : '-'}</td>\${ed ? \`<td class="r">\${p.cost ? rs(p.cost) : '-'}</td><td class="r nowrap"><button class="btn sm" data-act="prodEdit" data-id="\${p.id}">Edit</button> <button class="btn sm bad" data-act="prodDel" data-id="\${p.id}">Delete</button></td>\` : ''}</tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No products yet.</div></td></tr>\`}</tbody></table></div></div>\`;
      } else if (rateTab === 'items') {
        b.innerHTML = \`<div class="card"><div class="card-h"><h3>BOQ items (construction, interiors, other works)</h3>\${ed ? '<button class="btn pri sm" data-act="itemEdit">Add item</button>' : ''}</div><div class="scx"><table class="tbl"><thead><tr><th>Category</th><th>Description</th><th>Unit</th><th class="r">Rate</th>\${ed ? '<th class="r">Cost</th><th></th>' : ''}</tr></thead><tbody>\${db.items.map(p => \`<tr><td>\${esc(p.category)}</td><td>\${esc(p.desc)}</td><td>\${esc(p.unit)}</td><td class="r">\${rs(p.rate)}</td>\${ed ? \`<td class="r">\${p.cost ? rs(p.cost) : '-'}</td><td class="r nowrap"><button class="btn sm" data-act="itemEdit" data-id="\${p.id}">Edit</button> <button class="btn sm bad" data-act="itemDel" data-id="\${p.id}">Delete</button></td>\` : ''}</tr>\`).join('') || \`<tr><td colspan="6"><div class="empty">No items yet.</div></td></tr>\`}</tbody></table></div></div>\`;
      } else {
        const tbl = (key, title) => \`<div class="card"><div class="card-h"><h3>\${title}</h3>\${ed ? \`<button class="btn sm" data-act="optAdd" data-k="\${key}">Add option</button>\` : ''}</div><div class="mute sm" style="margin-bottom:8px">Extra charge per sq ft added to the base rate.</div>\${(db.settings[key] || []).map((o, i) => \`<div class="row2"><input value="\${esc(o.name)}" data-opt="\${key}" data-i="\${i}" data-f="name" \${ed ? '' : 'disabled'}><input type="number" step="any" value="\${o.add}" data-opt="\${key}" data-i="\${i}" data-f="add" \${ed ? '' : 'disabled'}>\${ed ? \`<button class="btn sm bad" data-act="optDel" data-k="\${key}" data-i="\${i}">Remove</button>\` : '<span></span>'}</div>\`).join('')}</div>\`;
        b.innerHTML = \`<div class="grid g2">\${tbl('glass', 'Glass options')}\${tbl('finish', 'Finish options')}</div>\`;
      }
    }

    // Material & Template Action Handlers
    ACT.tplOpen = b => { selectedTemplateId = b.dataset.id; drawRates(); };
    ACT.tplBack = () => { selectedTemplateId = null; drawRates(); };
    ACT.tplDuplicate = b => {
      const tpl = (db.productTemplates || []).find(t => t.id === b.dataset.id);
      if (!tpl) return;
      const copy = JSON.parse(JSON.stringify(tpl));
      copy.id = uid();
      copy.name = tpl.name + ' (Copy)';
      db.productTemplates.push(copy);
      persist(true); toast('Template duplicated.'); drawRates();
    };
    ACT.tplLiveRecalc = () => {
      const w = num($('#prev_w') ? $('#prev_w').value : 10) || 10;
      const h = num($('#prev_h') ? $('#prev_h').value : 6) || 6;
      const glassId = $('#prev_glass') ? $('#prev_glass').value : '';
      const mesh = $('#prev_mesh') ? $('#prev_mesh').value : 'SS Mesh';
      const tpl = (db.productTemplates || []).find(t => t.id === selectedTemplateId);
      if (!tpl) return;
      const cs = db.costingSettings || CostingEngine.getDefaultCostingSettings();
      const mats = db.materials || [];
      const rates = {
        glass: mats.filter(m => m.category === 'glass'),
        mesh: mats.filter(m => m.category === 'mesh'),
        handle: mats.filter(m => m.category === 'hardware')
      };
      const res = CostingEngine.calculateItem(tpl, tpl.lines, w, h, { glass_id: glassId, mesh: mesh }, cs, rates);
      if ($('#prev_res_area')) $('#prev_res_area').textContent = \`\${(w * h).toFixed(1)} sqft (\${res.A.toFixed(2)} sqm)\`;
      if ($('#prev_res_subtotal')) $('#prev_res_subtotal').textContent = '₹' + res.subtotal.toFixed(2);
      if ($('#prev_res_wastage')) $('#prev_res_wastage').textContent = '₹' + res.wastage.toFixed(2);
      if ($('#prev_res_totalcost')) $('#prev_res_totalcost').textContent = '₹' + res.totalCost.toFixed(2);
      if ($('#prev_res_margin')) $('#prev_res_margin').textContent = '₹' + res.margin;
      if ($('#prev_res_price')) $('#prev_res_price').textContent = '₹' + res.priceExTax.toLocaleString('en-IN');
      if ($('#prev_res_sqm')) $('#prev_res_sqm').textContent = '₹' + res.ratePerSqm.toLocaleString('en-IN') + ' / sqm';
      if ($('#prev_res_sqft')) $('#prev_res_sqft').textContent = '₹' + res.ratePerSqft + ' / sqft';
      if ($('#prev_res_gst')) $('#prev_res_gst').textContent = '₹' + res.priceInclGst.toLocaleString('en-IN');

      res.lines.forEach(l => {
        const amtEl = $(\`#line_amt_\${l.sl_no}\`);
        if (amtEl) amtEl.textContent = rs(l.amount);
        const lenEl = $(\`#line_len_\${l.sl_no}\`);
        if (lenEl) lenEl.textContent = l.evaluatedLen.toFixed(3) + ' m';
        const nosEl = $(\`#line_nos_\${l.sl_no}\`);
        if (nosEl) nosEl.textContent = l.evaluatedNos;
      });
    };
    ACT.matEdit = b => {
      const id = b.dataset.id;
      const category = b.dataset.cat || 'profile';
      const mats = db.materials = db.materials || [];
      const m = id ? mats.find(x => x.id === id) : { category, code: '', name: '', unit: category === 'profile' ? 'kg/m' : category === 'glass' || category === 'mesh' ? 'sqm' : category === 'gasket' ? 'm' : 'nos', weight_kg_per_m: 0, rate: 0, active: true };
      modal({
        title: id ? 'Edit Material / Item' : 'Add Material / Item',
        wide: true,
        body: \`<div class="grid g2">
          <label class="f"><span>Item Code / Profile No</span><input name="code" value="\${esc(m.code || '')}" placeholder="e.g. 5045"></label>
          <label class="f"><span>Name / Description</span><input name="name" value="\${esc(m.name || '')}" placeholder="e.g. Outer Frame Top" required></label>
          <label class="f"><span>Category</span>
            <select name="category">
              <option value="profile" \${m.category === 'profile' ? 'selected' : ''}>Aluminium Profile</option>
              <option value="glass" \${m.category === 'glass' ? 'selected' : ''}>Glass</option>
              <option value="mesh" \${m.category === 'mesh' ? 'selected' : ''}>Mesh</option>
              <option value="hardware" \${m.category === 'hardware' ? 'selected' : ''}>Hardware</option>
              <option value="gasket" \${m.category === 'gasket' ? 'selected' : ''}>Gasket / Seal</option>
              <option value="labour" \${m.category === 'labour' ? 'selected' : ''}>Labour</option>
            </select>
          </label>
          <label class="f"><span>Unit</span><input name="unit" value="\${esc(m.unit || '')}" placeholder="kg/m, sqm, nos, m"></label>
          \${m.category === 'profile' ? \`<label class="f"><span>Weight (kg/m)</span><input name="weight_kg_per_m" type="number" step="any" value="\${m.weight_kg_per_m || 0}"></label>\` : ''}
          <label class="f"><span>Rate / Unit Price (\${'₹'})</span><input name="rate" type="number" step="any" value="\${m.rate || 0}"></label>
        </div>\`,
        onOk: el => {
          const d = formData(el);
          if (!d.name.trim()) { toast('Name is required.', 'bad'); return false; }
          d.weight_kg_per_m = num(d.weight_kg_per_m);
          d.rate = num(d.rate);
          d.active = true;
          if (id) Object.assign(m, d);
          else mats.push({ id: uid(), ...d });
          persist(true); drawRates(); toast('Material saved.');
        }
      });
    };
    ACT.matDel = b => {
      const mats = db.materials = db.materials || [];
      const m = mats.find(x => x.id === b.dataset.id);
      if (!m) return;
      confirmBox(\`Delete \${esc(m.name)} from material library?\`, () => {
        db.materials = db.materials.filter(x => x.id !== m.id);
        persist(true); drawRates(); toast('Material deleted.');
      }, 'Delete', 'bad');
    };`;

// Normalize newlines and replace
const normalizedHtml = html.replace(/\r\n/g, '\n');
const normalizedTarget = targetStr.replace(/\r\n/g, '\n');

if (normalizedHtml.includes(normalizedTarget)) {
  const result = normalizedHtml.replace(normalizedTarget, replacementStr);
  fs.writeFileSync(actualPath, result, 'utf8');
  console.log('Successfully updated Rate library in index.html!');
} else {
  console.error('Target string not found for exact replacement.');
}
