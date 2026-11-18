'use strict';
/**
 * documents-ui.js — Universal Document Engine Frontend UI
 * Provides full interface for Proforma Invoices, Customer POs, Delivery Challans,
 * Material Requisitions, Vendor POs, Tax Invoices, and Running-Account Bills.
 *
 * Adheres strictly to Golden Rules:
 *  - Matches existing sidebar, cards, indigo theme and role permissions
 *  - Multi-tenant company isolation
 *  - Universal revisions with side-by-side diff compare
 *  - Mandatory revision reason
 *  - Statutory 16-char rule compliance
 */

(function () {
  const DOC_LABELS = {
    pi:  'Proforma Invoice',
    cpo: 'Customer PO / Work Order',
    dc:  'Delivery Challan',
    mrl: 'Material Requisition',
    vpo: 'Vendor Purchase Order',
    inv: 'Tax Invoice',
    ra:  'Running Account (RA) Bill',
    cn:  'Credit Note',
    dn:  'Debit Note'
  };

  const DOC_ICONS = {
    pi:  '📄',
    cpo: '📑',
    dc:  '🚚',
    mrl: '📦',
    vpo: '🛒',
    inv: '🧾',
    ra:  '📊',
    cn:  '↩️',
    dn:  '↪️'
  };

  const DOC_STATUSES = {
    draft:     'Draft',
    pending:   'Awaiting Approval',
    approved:  'Approved',
    issued:    'Issued / Finalised',
    cancelled: 'Cancelled'
  };

  let docFilter = { type: 'all', status: 'all', q: '', showAllRevs: false };
  let currentDocsList = [];
  let activeDoc = null;

  function statusBadge(status) {
    const s = String(status || 'draft').toLowerCase();
    const map = {
      draft:     'background:#f1f5f9;color:#475569',
      pending:   'background:#fef3c7;color:#b45309',
      approved:  'background:#dcfce7;color:#15803d',
      issued:    'background:#e0f2fe;color:#0369a1',
      finalised: 'background:#e0f2fe;color:#0369a1',
      cancelled: 'background:#fee2e2;color:#b91c1c'
    };
    const style = map[s] || map.draft;
    return `<span class="bd" style="${style};font-weight:700;text-transform:uppercase;font-size:0.75rem">${DOC_STATUSES[s] || s}</span>`;
  }

  /**
   * Main View: Documents List
   */
  async function viewDocuments(initialType) {
    if (initialType && DOC_LABELS[initialType]) {
      docFilter.type = initialType;
    }
    const m = $('#main');
    m.innerHTML = `
      <div class="ph">
        <div>
          <h1>📑 Billing &amp; Documents</h1>
          <div class="mute">Universal document engine for Proforma Invoices, Customer POs, Tax Invoices, Delivery Challans, and Procurement.</div>
        </div>
        <div class="acts">
          <button class="btn" id="btnDocConvertQuote" style="background:#f8fafc;border:1px solid #cbd5e1">🔄 Convert from Quote</button>
          <button class="btn pri" id="btnDocCreateNew">+ New Document</button>
        </div>
      </div>

      <div class="tools" style="flex-wrap:wrap;gap:8px">
        <input type="search" id="docSearch" placeholder="Search number, customer, project or HSN..." style="flex:1;min-width:220px" value="${esc(docFilter.q)}">
        <select id="docTypeSelect" style="max-width:220px">
          <option value="all">All Document Types</option>
          ${Object.entries(DOC_LABELS).map(([k, v]) => `<option value="${k}" ${docFilter.type === k ? 'selected' : ''}>${DOC_ICONS[k] || ''} ${esc(v)}</option>`).join('')}
        </select>
        <label class="chk" style="align-self:center;font-size:0.85rem">
          <input type="checkbox" id="docShowAllRevs" ${docFilter.showAllRevs ? 'checked' : ''}> Show superseded revisions
        </label>
      </div>

      <div class="chips" id="docStatusChips" style="margin-bottom:14px"></div>
      <div class="card" style="padding:6px 10px">
        <div class="scx" id="docsTableArea"><div style="padding:24px;text-align:center" class="mute">⏳ Loading documents...</div></div>
      </div>
    `;

    $('#docSearch').oninput = e => { docFilter.q = e.target.value; renderDocsTable(); };
    $('#docTypeSelect').onchange = e => { docFilter.type = e.target.value; loadAndRenderDocs(); };
    $('#docShowAllRevs').onchange = e => { docFilter.showAllRevs = e.target.checked; loadAndRenderDocs(); };
    $('#btnDocCreateNew').onclick = openCreateDocModal;
    $('#btnDocConvertQuote').onclick = openConvertQuoteModal;

    await loadAndRenderDocs();
  }

  async function loadAndRenderDocs() {
    try {
      const url = `/api/documents?docType=${encodeURIComponent(docFilter.type)}&status=${encodeURIComponent(docFilter.status)}&showAllRevs=${docFilter.showAllRevs}`;
      currentDocsList = await apiGet(url);
    } catch (e) {
      console.warn('Failed to load documents:', e);
      currentDocsList = [];
    }
    renderDocsStatusChips();
    renderDocsTable();
  }

  function renderDocsStatusChips() {
    const el = $('#docStatusChips');
    if (!el) return;
    const allStatuses = ['all', 'draft', 'pending', 'approved', 'issued', 'cancelled'];
    el.innerHTML = allStatuses.map(s => {
      const cnt = s === 'all'
        ? currentDocsList.length
        : currentDocsList.filter(d => d.status === s).length;
      return `<button class="chip ${docFilter.status === s ? 'on' : ''}" data-dstatus="${s}">
        ${s === 'all' ? 'All' : (DOC_STATUSES[s] || s)} <b>${cnt}</b>
      </button>`;
    }).join('');

    $$('[data-dstatus]', el).forEach(btn => {
      btn.onclick = () => {
        docFilter.status = btn.dataset.dstatus;
        renderDocsStatusChips();
        renderDocsTable();
      };
    });
  }

  function renderDocsTable() {
    const el = $('#docsTableArea');
    if (!el) return;

    const q = docFilter.q.trim().toLowerCase();
    const filtered = currentDocsList.filter(d => {
      if (docFilter.status !== 'all' && d.status !== docFilter.status) return false;
      if (docFilter.type !== 'all' && d.docType !== docFilter.type) return false;
      if (q) {
        const text = [
          d.no,
          d.baseNo,
          d.cust && d.cust.name,
          d.project,
          d.site,
          ...(d.lines || []).map(l => l.name + ' ' + (l.hsn || ''))
        ].join(' ').toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      el.innerHTML = `
        <div class="empty" style="padding:28px 12px">
          ${currentDocsList.length ? 'No documents match this filter.' : 'No documents created yet.'}
          <div style="margin-top:10px">
            <button class="btn sm pri" id="btnEmptyCreate">+ Create First Document</button>
          </div>
        </div>
      `;
      const btn = $('#btnEmptyCreate');
      if (btn) btn.onclick = openCreateDocModal;
      return;
    }

    el.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Type</th>
            <th>Document No</th>
            <th>Revision</th>
            <th>Date</th>
            <th>Party / Project</th>
            <th class="r">Grand Total</th>
            <th>Status</th>
            <th class="r">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(d => {
            const icon = DOC_ICONS[d.docType] || '📄';
            const typeLabel = DOC_LABELS[d.docType] || d.docType;
            const revBadge = d.rev > 0
              ? `<span class="bd" style="background:#e0e7ff;color:#3730a3;font-weight:700">Rev ${d.rev}</span>`
              : `<span class="bd" style="background:#f1f5f9;color:#64748b">Rev 0</span>`;
            const partyName = (d.cust && d.cust.name) || (d.vendor && d.vendor.name) || '(no party)';
            const total = (d.totals && d.totals.grandTotal) || 0;

            return `
              <tr>
                <td class="nowrap"><span title="${esc(typeLabel)}">${icon} <b>${esc(typeLabel)}</b></span></td>
                <td class="nowrap">
                  <a class="rl" href="#/document/${d.id}"><b>${esc(d.no)}</b></a>
                  ${d.sourceDocNo ? `<div class="mute sm">Source: ${esc(d.sourceDocNo)}</div>` : ''}
                </td>
                <td class="nowrap">
                  ${revBadge}
                  ${d.superseded ? `<span class="mute sm" style="display:block;font-size:0.7rem;color:#dc2626">Replaced</span>` : ''}
                </td>
                <td class="nowrap">${fmtDate(d.date)}</td>
                <td>
                  <b>${esc(partyName)}</b>
                  ${d.project ? `<div class="mute sm">${esc(d.project)}</div>` : ''}
                </td>
                <td class="r nowrap"><b>${rs(total, 0)}</b></td>
                <td>${statusBadge(d.status)}</td>
                <td class="r nowrap">
                  <button class="btn sm ghost" data-docact="view" data-id="${d.id}" title="View Details">👁️</button>
                  <button class="btn sm ghost" data-docact="history" data-id="${d.id}" title="Revision History">📜 History</button>
                  ${!d.superseded && !(d.docType === 'inv' && d.status === 'issued') ? `
                    <button class="btn sm ghost" data-docact="revise" data-id="${d.id}" title="Create Revision" style="color:#0284c7">🔄 Revise</button>
                  ` : ''}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    $$('[data-docact="view"]', el).forEach(b => b.onclick = () => go('#/document/' + b.dataset.id));
    $$('[data-docact="history"]', el).forEach(b => b.onclick = () => openRevisionHistoryModal(b.dataset.id));
    $$('[data-docact="revise"]', el).forEach(b => b.onclick = () => promptCreateRevision(b.dataset.id));
  }

  /**
   * Modal: Create New Document
   */
  function openCreateDocModal() {
    const custOptions = (db.customers || []).map(c => `<option value="${c.id}">${esc(c.name)} ${c.gstin ? '(' + esc(c.gstin) + ')' : ''}</option>`).join('');

    modal({
      title: '➕ Create New Document',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:8px 0">
          <label class="f">
            <span>Document Type</span>
            <select id="m_docType">
              ${Object.entries(DOC_LABELS).map(([k, v]) => `<option value="${k}">${DOC_ICONS[k] || ''} ${esc(v)}</option>`).join('')}
            </select>
          </label>
          <div class="grid g2">
            <label class="f">
              <span>Date</span>
              <input type="date" id="m_docDate" value="${today()}">
            </label>
            <label class="f">
              <span>Place of Supply (State)</span>
              <input type="text" id="m_docPos" value="${esc(db.settings.state || 'Tamil Nadu')}">
            </label>
          </div>
          <label class="f">
            <span>Customer / Party</span>
            <select id="m_docCust">
              <option value="">-- Choose Existing Customer or type manual below --</option>
              ${custOptions}
            </select>
          </label>
          <div class="grid g2">
            <label class="f">
              <span>Customer Name</span>
              <input type="text" id="m_docCustName" placeholder="Customer or Company name">
            </label>
            <label class="f">
              <span>GSTIN</span>
              <input type="text" id="m_docCustGstin" placeholder="e.g. 33AAAAA0000A1Z5">
            </label>
          </div>
          <div class="grid g2">
            <label class="f">
              <span>Project Title</span>
              <input type="text" id="m_docProject" placeholder="e.g. Commercial Glazing or Villa Windows">
            </label>
            <label class="f">
              <span>Site Location / Address</span>
              <input type="text" id="m_docSite" placeholder="Site address">
            </label>
          </div>
          <div class="mute sm" style="background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0">
            💡 <b>Universal Numbering:</b> Number will be automatically allocated with gap-less Indian FY series. Statutory 16-character GST limit strictly applied for Invoices &amp; Challans.
          </div>
        </div>
      `,
      okText: 'Create Document & Add Lines',
      onOk: async el => {
        const docType = $('#m_docType').value;
        const date = $('#m_docDate').value || today();
        const pos = $('#m_docPos').value.trim() || 'Tamil Nadu';
        const project = $('#m_docProject').value.trim();
        const site = $('#m_docSite').value.trim();

        const custId = $('#m_docCust').value;
        const selCust = (db.customers || []).find(c => c.id === custId) || {};
        const custName = $('#m_docCustName').value.trim() || selCust.name || 'Client';
        const custGstin = $('#m_docCustGstin').value.trim() || selCust.gstin || '';

        try {
          const created = await apiPost('/api/documents', {
            docType,
            date,
            pos,
            project,
            site,
            customerId: custId || '',
            cust: {
              name: custName,
              gstin: custGstin,
              phone: selCust.phone || '',
              email: selCust.email || '',
              address: selCust.address || '',
              city: selCust.city || '',
              state: selCust.state || pos
            },
            lines: [
              {
                name: 'Item / Scope Description',
                desc: 'Standard supply & installation scope',
                hsn: '7610',
                qty: 1,
                unit: 'nos',
                rate: 1000,
                disc: 0,
                gstRate: 18
              }
            ],
            terms: db.settings.terms || ''
          });

          closeModal();
          toast(`✅ Created ${DOC_LABELS[docType]} ${created.no}`);
          go('#/document/' + created.id);
        } catch (err) {
          toast('Failed to create document: ' + err.message, 'bad');
          return false;
        }
      }
    });

    // Auto-fill customer details on dropdown change
    $('#m_docCust').onchange = e => {
      const c = (db.customers || []).find(x => x.id === e.target.value);
      if (c) {
        $('#m_docCustName').value = c.name || '';
        $('#m_docCustGstin').value = c.gstin || '';
      }
    };
  }

  /**
   * Modal: Convert Quotation to Document
   */
  function openConvertQuoteModal() {
    const eligibleQuotes = (db.quotes || []).filter(q => !q.superseded);
    if (!eligibleQuotes.length) {
      toast('No quotations available to convert.', 'bad');
      return;
    }

    modal({
      title: '🔄 Convert Quotation to Document',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:8px 0">
          <label class="f">
            <span>Select Target Document Type</span>
            <select id="cq_targetType">
              <option value="pi">📄 Proforma Invoice (PI)</option>
              <option value="cpo">📑 Customer PO / Work Order (CPO)</option>
              <option value="inv">🧾 Tax Invoice (INV)</option>
              <option value="dc">🚚 Delivery Challan (DC)</option>
              <option value="mrl">📦 Material Requisition List (MRL)</option>
            </select>
          </label>
          <label class="f">
            <span>Select Source Quotation</span>
            <select id="cq_quoteId">
              ${eligibleQuotes.map(q => {
                const tot = (typeof quoteTotal === 'function') ? quoteTotal(q) : (q.total || 0);
                return `<option value="${q.id}">
                  ${esc(q.no)} (Rev ${q.rev || 0}) — ${esc(q.cust && q.cust.name || 'Client')} [${esc(q.status)}] — ₹${inr(tot, 0)}
                </option>`;
              }).join('')}
            </select>
          </label>
          <div class="mute sm" style="background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0">
            🛡️ <b>Audit Safety:</b> The original quotation will remain 100% untouched. The generated document will be linked to Quotation Revision ${eligibleQuotes[0].rev || 0} for downstream tracking.
          </div>
        </div>
      `,
      okText: 'Generate & Open Document',
      onOk: async el => {
        const quoteId = $('#cq_quoteId').value;
        const targetDocType = $('#cq_targetType').value;
        try {
          const res = await apiPost('/api/documents/convert-from-quote/' + quoteId, { targetDocType });
          closeModal();
          toast(`✅ Converted to ${DOC_LABELS[targetDocType]} ${res.no}`);
          go('#/document/' + res.id);
        } catch (err) {
          toast('Conversion failed: ' + err.message, 'bad');
          return false;
        }
      }
    });
  }

  /**
   * Detail / Editor View for a Document
   */
  async function viewDocument(id) {
    const m = $('#main');
    m.innerHTML = `<div style="padding:32px;text-align:center" class="mute">⏳ Loading document ${esc(id)}...</div>`;

    try {
      activeDoc = await apiGet('/api/documents/' + id);
    } catch (e) {
      m.innerHTML = `<div class="empty">Document not found or access denied. <a href="#/documents">Back to documents</a></div>`;
      return;
    }

    const d = activeDoc;
    const isLocked = d.superseded || (d.docType === 'inv' && ['issued', 'finalised'].includes(d.status));
    const revBadge = d.rev > 0 ? `Rev ${d.rev}` : 'Rev 0';
    const typeLabel = DOC_LABELS[d.docType] || d.docType;

    m.innerHTML = `
      <div class="ph">
        <div>
          <a href="#/documents" class="sm">&lsaquo; Back to all documents</a>
          <h1>${DOC_ICONS[d.docType] || '📄'} ${esc(d.no)} ${statusBadge(d.status)}</h1>
          <div class="mute sm">
            <b>${esc(typeLabel)}</b> &middot; ${revBadge} &middot; Created on ${fmtDate(d.date)}
            ${d.sourceDocNo ? `&middot; Linked to Quote <b>${esc(d.sourceDocNo)}</b>` : ''}
            ${d.revReason ? `<br><span style="color:#0284c7"><b>Revision Note:</b> ${esc(d.revReason)}</span>` : ''}
            ${d.superseded ? `<br><span style="color:#dc2626;font-weight:700">⚠️ This revision has been replaced by a newer revision.</span>` : ''}
          </div>
        </div>
        <div class="acts" id="docDetailActs"></div>
      </div>

      ${isLocked ? `
        <div class="note" style="margin-bottom:14px;background:#fef3c7;border:1px solid #f59e0b;color:#92400e">
          ${d.superseded
            ? 'This revision is locked for editing because a newer revision exists.'
            : 'This document is finalised / issued. To adjust values, create a Credit/Debit note or cancel and reissue.'}
        </div>
      ` : ''}

      <div class="qg">
        <div>
          <!-- Party Card -->
          <div class="card" style="margin-bottom:14px">
            <h3>Party &amp; Project Information</h3>
            <div class="grid g2" style="margin-top:10px">
              <label class="f">
                <span>Party / Customer Name</span>
                <input type="text" id="ed_custName" value="${esc(d.cust && d.cust.name || '')}" ${isLocked ? 'disabled' : ''}>
              </label>
              <label class="f">
                <span>GSTIN</span>
                <input type="text" id="ed_custGstin" value="${esc(d.cust && d.cust.gstin || '')}" ${isLocked ? 'disabled' : ''}>
              </label>
              <label class="f">
                <span>Project Name</span>
                <input type="text" id="ed_project" value="${esc(d.project || '')}" ${isLocked ? 'disabled' : ''}>
              </label>
              <label class="f">
                <span>Site Address</span>
                <input type="text" id="ed_site" value="${esc(d.site || '')}" ${isLocked ? 'disabled' : ''}>
              </label>
              <label class="f">
                <span>Date</span>
                <input type="date" id="ed_date" value="${d.date || today()}" ${isLocked ? 'disabled' : ''}>
              </label>
              <label class="f">
                <span>Place of Supply</span>
                <input type="text" id="ed_pos" value="${esc(d.pos || 'Tamil Nadu')}" ${isLocked ? 'disabled' : ''}>
              </label>
            </div>
          </div>

          <!-- Lines Card -->
          <div class="card" style="margin-bottom:14px">
            <div class="card-h">
              <h3>Line Items &amp; GST Rates</h3>
              ${!isLocked ? `<button class="btn sm pri" id="btnAddDocLine">+ Add Item Line</button>` : ''}
            </div>
            <div class="scx" style="margin-top:10px">
              <table class="tbl" id="docLinesTable">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>HSN/SAC</th>
                    <th class="r">Qty</th>
                    <th>UOM</th>
                    <th class="r">Rate (₹)</th>
                    <th class="r">Disc %</th>
                    <th class="r">Taxable (₹)</th>
                    <th class="r">GST %</th>
                    <th class="r">Total (₹)</th>
                    ${!isLocked ? '<th class="r"></th>' : ''}
                  </tr>
                </thead>
                <tbody id="docLinesTbody"></tbody>
              </table>
            </div>
          </div>

          <!-- Terms Card -->
          <div class="card" style="margin-bottom:14px">
            <h3>Terms and Conditions</h3>
            <textarea id="ed_terms" rows="4" style="width:100%;margin-top:8px" ${isLocked ? 'disabled' : ''}>${esc(d.terms || '')}</textarea>
          </div>
        </div>

        <!-- Sidebar Summary -->
        <aside class="qside">
          <div class="card" style="position:sticky;top:80px">
            <h3>Summary &amp; Totals</h3>
            <div id="docTotalsSummary" style="margin-top:12px;font-size:0.92rem"></div>
            <hr style="margin:14px 0;border:0;border-top:1px solid #e2e8f0">
            <div style="display:flex;flex-direction:column;gap:8px">
              ${!isLocked ? `
                <button class="btn pri" id="btnSaveDocLines" style="justify-content:center;padding:10px">💾 Save Changes</button>
              ` : ''}
              ${d.docType === 'dc' ? `
                <button class="btn" id="btnChallanPdf" style="justify-content:center;padding:10px;background:#e0f2fe;color:#0369a1;border-color:#bae6fd">🚚 Print / Download Challan</button>
              ` : ''}
              ${(d.docType === 'dc' || d.docType === 'inv') ? `
                <button class="btn" id="btnDocEwayBill" style="justify-content:center;padding:10px;background:#fef3c7;color:#b45309;border-color:#fde68a">⚡ Generate E-Way Bill</button>
              ` : ''}
              ${d.sourceDocId ? `
                <button class="btn" id="btnCheckDeliveries" style="justify-content:center;padding:10px">📦 Track Partial Deliveries</button>
              ` : ''}
              <button class="btn" id="btnMeasurementSheet" style="justify-content:center;padding:10px;background:#f0fdf4;color:#166534;border-color:#bbf7d0">📐 Measurement Sheet (M-Sheet)</button>
              <button class="btn" id="btnVariationStatement" style="justify-content:center;padding:10px;background:#fefce8;color:#854d0e;border-color:#fef08a">📊 Variation Statement</button>
              <button class="btn" id="btnRaBillCalc" style="justify-content:center;padding:10px;background:#faf5ff;color:#6b21a8;border-color:#e9d5ff">📑 RA Bill / Progress Summary</button>
              ${!d.superseded ? `
                <button class="btn" id="btnDocRevise" style="justify-content:center;padding:10px;color:#0284c7">🔄 Create Revision (R+1)</button>
              ` : ''}
              <button class="btn" id="btnDocHistory" style="justify-content:center;padding:10px">📜 Revision History</button>
              <button class="btn" id="btnDocCompare" style="justify-content:center;padding:10px">⚖️ Compare Revisions</button>
            </div>
          </div>
        </aside>
      </div>
    `;

    renderDetailActs(d, isLocked);
    renderLinesTable(d, isLocked);
    renderTotalsBox(d);

    if (!isLocked) {
      $('#btnAddDocLine').onclick = () => {
        d.lines = d.lines || [];
        d.lines.push({
          id: 'line_' + Math.random().toString(36).slice(2, 8),
          name: 'New Item',
          desc: '',
          hsn: '7610',
          qty: 1,
          unit: 'nos',
          rate: 1000,
          disc: 0,
          gstRate: 18
        });
        recalcAndDrawLines();
      };

      $('#btnSaveDocLines').onclick = async () => {
        collectFormLines();
        try {
          const updated = await apiPut('/api/documents/' + d.id, {
            cust: { name: $('#ed_custName').value.trim(), gstin: $('#ed_custGstin').value.trim() },
            project: $('#ed_project').value.trim(),
            site: $('#ed_site').value.trim(),
            date: $('#ed_date').value,
            pos: $('#ed_pos').value.trim(),
            terms: $('#ed_terms').value,
            lines: d.lines
          });
          activeDoc = updated;
          toast('✅ Document saved successfully!');
          renderTotalsBox(updated);
        } catch (err) {
          toast('Failed to save: ' + err.message, 'bad');
        }
      };
    }

    $('#btnDocRevise').onclick = () => promptCreateRevision(d.id);
    $('#btnDocHistory').onclick = () => openRevisionHistoryModal(d.id);
    $('#btnDocCompare').onclick = () => openCompareModal(d.id);

    const btnChallan = $('#btnChallanPdf');
    if (btnChallan) btnChallan.onclick = () => openChallanPdfModal(d);

    const btnEwb = $('#btnDocEwayBill');
    if (btnEwb) btnEwb.onclick = () => openEwayBillModal(d);

    const btnDeliv = $('#btnCheckDeliveries');
    if (btnDeliv) btnDeliv.onclick = () => openPendingDeliveriesModal(d);

    const btnM = $('#btnMeasurementSheet');
    if (btnM) btnM.onclick = () => openMeasurementSheetModal(d);

    const btnV = $('#btnVariationStatement');
    if (btnV) btnV.onclick = () => openVariationStatementModal(d);

    const btnRA = $('#btnRaBillCalc');
    if (btnRA) btnRA.onclick = () => openRaBillModal(d);
  }

  function renderDetailActs(d, isLocked) {
    const el = $('#docDetailActs');
    if (!el) return;

    const acts = [];
    if (d.status === 'draft') {
      acts.push(`<button class="btn pri sm" id="actSubmitApproval">Submit for Approval</button>`);
    } else if (d.status === 'pending') {
      acts.push(`<button class="btn pri sm" id="actApprove">Approve Document</button>`);
    } else if (d.status === 'approved') {
      acts.push(`<button class="btn pri sm" id="actIssue" style="background:#0284c7;border-color:#0284c7">Mark Issued / Finalised</button>`);
    }

    el.innerHTML = acts.join('');

    const btnSub = $('#actSubmitApproval');
    if (btnSub) btnSub.onclick = async () => {
      try {
        await apiPost(`/api/documents/${d.id}/status`, { status: 'pending', reason: 'Submitted for manager review' });
        toast('Document submitted for approval.');
        viewDocument(d.id);
      } catch (e) { toast(e.message, 'bad'); }
    };

    const btnApp = $('#actApprove');
    if (btnApp) btnApp.onclick = async () => {
      try {
        await apiPost(`/api/documents/${d.id}/status`, { status: 'approved', reason: 'Approved by ' + (me ? me.name : 'Manager') });
        toast('Document approved.');
        viewDocument(d.id);
      } catch (e) { toast(e.message, 'bad'); }
    };

    const btnIss = $('#actIssue');
    if (btnIss) btnIss.onclick = async () => {
      try {
        await apiPost(`/api/documents/${d.id}/status`, { status: 'issued', reason: 'Official issue / delivery' });
        toast('Document marked as Issued & Finalised.');
        viewDocument(d.id);
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  function collectFormLines() {
    if (!activeDoc) return;
    const tbody = $('#docLinesTbody');
    if (!tbody) return;
    const rows = $$('tr[data-lineid]', tbody);
    activeDoc.lines = rows.map(r => {
      const lid = r.dataset.lineid;
      return {
        id: lid,
        name: $('.l_name', r).value.trim(),
        hsn: $('.l_hsn', r).value.trim(),
        qty: Number($('.l_qty', r).value) || 0,
        unit: $('.l_unit', r).value.trim() || 'nos',
        rate: Number($('.l_rate', r).value) || 0,
        disc: Number($('.l_disc', r).value) || 0,
        gstRate: Number($('.l_gst', r).value) || 18
      };
    });
  }

  function recalcAndDrawLines() {
    collectFormLines();
    const isInterState = (activeDoc.pos && db.settings.state && activeDoc.pos.toLowerCase() !== db.settings.state.toLowerCase());
    let subtotal = 0, totalDisc = 0, taxable = 0;

    activeDoc.lines.forEach(l => {
      const gross = (l.qty || 0) * (l.rate || 0);
      const d = (gross * (l.disc || 0) / 100);
      const tax = gross - d;
      subtotal += gross;
      totalDisc += d;
      taxable += tax;
    });

    const gst = Math.round(taxable * 0.18);
    activeDoc.totals = {
      subtotal: Math.round(subtotal),
      discount: Math.round(totalDisc),
      taxable: Math.round(taxable),
      totalTax: gst,
      grandTotal: Math.round(taxable + gst)
    };

    renderLinesTable(activeDoc, false);
    renderTotalsBox(activeDoc);
  }

  function renderLinesTable(d, isLocked) {
    const tbody = $('#docLinesTbody');
    if (!tbody) return;

    tbody.innerHTML = (d.lines || []).map((l, i) => {
      const gross = (l.qty || 0) * (l.rate || 0);
      const discAmt = gross * (l.disc || 0) / 100;
      const tax = gross - discAmt;
      const gstAmt = tax * (l.gstRate || 18) / 100;
      const tot = tax + gstAmt;

      return `
        <tr data-lineid="${l.id || i}">
          <td><input type="text" class="l_name" value="${esc(l.name || '')}" style="min-width:160px" ${isLocked ? 'disabled' : ''}></td>
          <td><input type="text" class="l_hsn" value="${esc(l.hsn || '7610')}" style="width:70px" ${isLocked ? 'disabled' : ''}></td>
          <td><input type="number" step="any" class="l_qty" value="${l.qty != null ? l.qty : 1}" style="width:65px;text-align:right" ${isLocked ? 'disabled' : ''}></td>
          <td><input type="text" class="l_unit" value="${esc(l.unit || 'sqft')}" style="width:50px" ${isLocked ? 'disabled' : ''}></td>
          <td><input type="number" step="any" class="l_rate" value="${l.rate != null ? l.rate : 0}" style="width:80px;text-align:right" ${isLocked ? 'disabled' : ''}></td>
          <td><input type="number" step="any" class="l_disc" value="${l.disc != null ? l.disc : 0}" style="width:55px;text-align:right" ${isLocked ? 'disabled' : ''}></td>
          <td class="r nowrap"><b>${rs(Math.round(tax), 0)}</b></td>
          <td>
            <select class="l_gst" style="width:60px" ${isLocked ? 'disabled' : ''}>
              <option value="18" ${l.gstRate === 18 ? 'selected' : ''}>18%</option>
              <option value="12" ${l.gstRate === 12 ? 'selected' : ''}>12%</option>
              <option value="5" ${l.gstRate === 5 ? 'selected' : ''}>5%</option>
              <option value="28" ${l.gstRate === 28 ? 'selected' : ''}>28%</option>
              <option value="0" ${l.gstRate === 0 ? 'selected' : ''}>0%</option>
            </select>
          </td>
          <td class="r nowrap"><b>${rs(Math.round(tot), 0)}</b></td>
          ${!isLocked ? `
            <td class="r"><button class="btn sm bad" data-delline="${l.id || i}" style="padding:2px 8px">&times;</button></td>
          ` : ''}
        </tr>
      `;
    }).join('');

    if (!isLocked) {
      $$('input, select', tbody).forEach(inp => {
        inp.oninput = () => recalcAndDrawLines();
      });

      $$('[data-delline]', tbody).forEach(btn => {
        btn.onclick = () => {
          const lid = btn.dataset.delline;
          d.lines = d.lines.filter((l, i) => (l.id || String(i)) !== lid);
          recalcAndDrawLines();
        };
      });
    }
  }

  function renderTotalsBox(d) {
    const el = $('#docTotalsSummary');
    if (!el) return;
    const t = d.totals || {};
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="mute">Subtotal:</span><b>${rs(t.subtotal || 0, 0)}</b>
      </div>
      ${t.discount ? `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#dc2626">
          <span>Discount:</span><b>-${rs(t.discount, 0)}</b>
        </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="mute">Taxable Amount:</span><b>${rs(t.taxable || 0, 0)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="mute">GST (CGST/SGST/IGST):</span><b>${rs(t.totalTax || 0, 0)}</b>
      </div>
      <hr style="margin:10px 0;border:0;border-top:1px dashed #cbd5e1">
      <div style="display:flex;justify-content:space-between;font-size:1.15rem;color:var(--pri)">
        <span>Grand Total:</span><b>${rs(t.grandTotal || 0, 0)}</b>
      </div>
    `;
  }

  /**
   * Modal: Prompt create new revision
   */
  function promptCreateRevision(docId) {
    modal({
      title: '🔄 Create Document Revision',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:8px 0">
          <p class="mute sm" style="margin:0">
            A new revision (R+1) will be generated. The existing revision will remain permanently recorded as replaced (superseded).
          </p>
          <label class="f">
            <span><b>Reason for Revision (Mandatory):</b></span>
            <textarea id="rev_reason" rows="3" placeholder="e.g. Client requested qty change, site measurement variation, rate renegotiation..." autofocus required></textarea>
          </label>
        </div>
      `,
      okText: 'Create Revision',
      onOk: async () => {
        const reason = $('#rev_reason').value.trim();
        if (!reason) {
          toast('Please enter the mandatory reason for revision.', 'bad');
          return false;
        }
        try {
          const res = await apiPost(`/api/documents/${docId}/revise`, { revReason: reason });
          closeModal();
          toast(`✅ Created Revision ${res.rev} (${res.no})`);
          go('#/document/' + res.id);
        } catch (err) {
          toast('Failed to create revision: ' + err.message, 'bad');
          return false;
        }
      }
    });
  }

  /**
   * Modal: Revision History
   */
  async function openRevisionHistoryModal(docId) {
    modal({
      title: '📜 Document Revision History',
      body: `<div style="padding:20px;text-align:center" class="mute">⏳ Loading revision audit history...</div>`,
      noFooter: true
    });

    try {
      const history = await apiGet(`/api/documents/${docId}/history`);
      if (!history.length) {
        $('.modal-body').innerHTML = '<div class="empty">No revisions found.</div>';
        return;
      }

      $('.modal-body').innerHTML = `
        <div style="margin:8px 0">
          <table class="tbl sm">
            <thead>
              <tr>
                <th>Rev</th>
                <th>Document No</th>
                <th>Date</th>
                <th>Author</th>
                <th>Status</th>
                <th>Reason for Revision</th>
                <th class="r">Total</th>
                <th class="r">Action</th>
              </tr>
            </thead>
            <tbody>
              ${history.map(h => `
                <tr>
                  <td><b>Rev ${h.rev || 0}</b></td>
                  <td><b>${esc(h.no)}</b> ${h.superseded ? '<span class="mute sm">(replaced)</span>' : '<span style="color:#15803d;font-weight:700">(active)</span>'}</td>
                  <td>${fmtDate(h.date)}</td>
                  <td>${esc(h.preparedByName || 'Staff')}</td>
                  <td>${statusBadge(h.status)}</td>
                  <td class="sm">${esc(h.revReason || (h.rev === 0 ? 'Original Document' : '-'))}</td>
                  <td class="r nowrap"><b>${rs((h.totals && h.totals.grandTotal) || 0, 0)}</b></td>
                  <td class="r nowrap">
                    <button class="btn sm" onclick="location.hash='#/document/${h.id}'; closeModal()">Open</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="margin-top:14px;text-align:right">
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: Side-by-Side Compare Revisions
   */
  async function openCompareModal(docId) {
    try {
      const history = await apiGet(`/api/documents/${docId}/history`);
      if (history.length < 2) {
        toast('At least two revisions are required for side-by-side comparison.', 'bad');
        return;
      }

      const revA = history[0].id;
      const revB = history[history.length - 1].id;

      modal({
        title: '⚖️ Side-by-Side Revision Compare',
        wide: true,
        body: `
          <div style="margin:8px 0">
            <div class="grid g2" style="margin-bottom:12px">
              <label class="f">
                <span>Base Revision A:</span>
                <select id="cmp_revA">
                  ${history.map(h => `<option value="${h.id}" ${h.id === revA ? 'selected' : ''}>Rev ${h.rev} — ${esc(h.no)} (${rs((h.totals && h.totals.grandTotal) || 0, 0)})</option>`).join('')}
                </select>
              </label>
              <label class="f">
                <span>Comparison Revision B:</span>
                <select id="cmp_revB">
                  ${history.map(h => `<option value="${h.id}" ${h.id === revB ? 'selected' : ''}>Rev ${h.rev} — ${esc(h.no)} (${rs((h.totals && h.totals.grandTotal) || 0, 0)})</option>`).join('')}
                </select>
              </label>
            </div>
            <div id="cmpDiffResultsArea">
              <div style="padding:20px;text-align:center" class="mute">Loading diff...</div>
            </div>
          </div>
        `,
        noFooter: true
      });

      const refreshDiff = async () => {
        const idA = $('#cmp_revA').value;
        const idB = $('#cmp_revB').value;
        const area = $('#cmpDiffResultsArea');
        area.innerHTML = '<div style="padding:20px;text-align:center" class="mute">⏳ Computing side-by-side variance...</div>';
        try {
          const diff = await apiGet(`/api/documents/${idA}/compare/${idB}`);
          const sign = diff.totalDifference >= 0 ? '+' : '';
          const diffColor = diff.totalDifference > 0 ? '#15803d' : (diff.totalDifference < 0 ? '#b91c1c' : '#475569');

          area.innerHTML = `
            <div class="card" style="background:#f8fafc;padding:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <b>Grand Total Variance:</b>
                <span style="font-size:1.1rem;font-weight:800;color:${diffColor};margin-left:8px">
                  ${sign}${rs(diff.totalDifference, 0)}
                </span>
              </div>
              <div class="mute sm">
                Comparing Rev ${diff.docA.rev} (${rs(diff.docA.total, 0)}) &rarr; Rev ${diff.docB.rev} (${rs(diff.docB.total, 0)})
              </div>
            </div>

            <table class="tbl sm">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Item Name</th>
                  <th>UOM</th>
                  <th class="r">Rev A Qty</th>
                  <th class="r">Rev B Qty</th>
                  <th class="r">Qty Diff</th>
                  <th class="r">Rev A Total</th>
                  <th class="r">Rev B Total</th>
                  <th class="r">Amount Variance</th>
                </tr>
              </thead>
              <tbody>
                ${diff.linesDiff.map(l => {
                  const tagMap = {
                    MODIFIED: 'background:#fef3c7;color:#b45309',
                    ADDED:    'background:#dcfce7;color:#15803d',
                    REMOVED:  'background:#fee2e2;color:#b91c1c',
                    UNCHANGED:'background:#f1f5f9;color:#64748b'
                  };
                  return `
                    <tr>
                      <td><span class="bd" style="${tagMap[l.status]};font-weight:700;font-size:0.7rem">${l.status}</span></td>
                      <td><b>${esc(l.name)}</b></td>
                      <td>${esc(l.unit || '-')}</td>
                      <td class="r">${l.revA ? l.revA.qty : '—'}</td>
                      <td class="r">${l.revB ? l.revB.qty : '—'}</td>
                      <td class="r">${l.qtyDiff != null ? (l.qtyDiff > 0 ? '+' + l.qtyDiff : l.qtyDiff) : '—'}</td>
                      <td class="r">${l.revA ? rs(l.revA.total, 0) : '—'}</td>
                      <td class="r">${l.revB ? rs(l.revB.total, 0) : '—'}</td>
                      <td class="r" style="font-weight:700;color:${l.totalDiff > 0 ? '#15803d' : (l.totalDiff < 0 ? '#b91c1c' : '#475569')}">
                        ${l.totalDiff != null ? (l.totalDiff > 0 ? '+' + rs(l.totalDiff, 0) : rs(l.totalDiff, 0)) : '—'}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
        } catch (err) {
          area.innerHTML = `<div class="note bad">${esc(err.message)}</div>`;
        }
      };

      $('#cmp_revA').onchange = refreshDiff;
      $('#cmp_revB').onchange = refreshDiff;
      await refreshDiff();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  /**
   * Modal: Delivery Challan PDF Print (With Value vs Without Value)
   */
  function openChallanPdfModal(d) {
    modal({
      title: '🚚 Print / Download Delivery Challan',
      body: `
        <div style="margin:8px 0">
          <p class="mute sm" style="margin-bottom:14px">
            Per CGST Rule 55, MR_Quoter supports two distinct Delivery Challan print modes using the exact same document number:
          </p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <label style="display:flex;align-items:flex-start;gap:12px;padding:12px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer;background:#f8fafc">
              <input type="radio" name="chl_mode" value="with_value" checked style="margin-top:4px">
              <div>
                <b style="color:#0f172a">1. Commercial Copy (WITH VALUE)</b>
                <div class="mute sm">Includes item rates, taxable value, GST tax amount, and total consignment value. Required for road transport, check-posts, and E-Way Bill inspection.</div>
              </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:12px;padding:12px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer;background:#f8fafc">
              <input type="radio" name="chl_mode" value="without_value" style="margin-top:4px">
              <div>
                <b style="color:#0f172a">2. Gate Pass / Site Copy (WITHOUT VALUE)</b>
                <div class="mute sm">Shows items, quantities, UOM, and HSN only. Rates, prices, taxes, and totals are completely hidden. Ideal for client security gate entry, site stores, and receiver acknowledgements.</div>
              </div>
            </label>
          </div>
          <div class="mute sm" style="margin-top:14px;background:#e0f2fe;padding:10px;border-radius:6px;color:#0369a1">
            🛡️ <b>Audit Trail:</b> Each print or download is securely recorded in the document audit log with the user's name and selected mode.
          </div>
        </div>
      `,
      okText: '📄 Download Official PDF',
      onOk: () => {
        const mode = $('input[name="chl_mode"]:checked').value;
        const url = `/api/documents/${d.id}/challan/pdf?mode=${mode}`;
        window.open(url, '_blank');
        toast(`✅ Delivery Challan (${mode === 'without_value' ? 'Without Value' : 'With Value'}) opened.`);
      }
    });
  }

  /**
   * Modal: E-Way Bill Generator & JSON Bulk-Upload Export (Phase A)
   */
  function openEwayBillModal(d) {
    const meta = d.metadata || {};
    const t = d.totals || {};

    modal({
      title: '⚡ Generate E-Way Bill (NIC Compliant)',
      wide: true,
      body: `
        <div style="margin:8px 0">
          <div class="card" style="background:#f8fafc;padding:12px;margin-bottom:14px">
            <div class="grid g2" style="font-size:0.88rem">
              <div><b>Document No:</b> ${esc(d.no)} (Length: ${d.no.length} chars &le; 16)</div>
              <div><b>Consignment Value:</b> ₹${Number(t.grandTotal || 0).toLocaleString('en-IN')} ${t.grandTotal >= 50000 ? '<span class="bd" style="background:#dcfce7;color:#15803d;font-size:0.75rem">&ge; ₹50,000</span>' : '<span class="bd" style="background:#fef3c7;color:#b45309;font-size:0.75rem">&lt; ₹50,000</span>'}</div>
              <div><b>From (Supplier):</b> ${esc(db.settings.company || 'Consignor')} [${esc(db.settings.gstin || 'No GSTIN')}]</div>
              <div><b>To (Recipient):</b> ${esc(d.cust && d.cust.name || 'Consignee')} [${esc(d.cust && d.cust.gstin || 'URP')}]</div>
            </div>
          </div>

          <h4 style="margin:0 0 10px">Part-A &amp; Part-B Transportation Details</h4>
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span>Vehicle Number (Part-B)</span>
              <input type="text" id="ewb_vehNo" value="${esc(meta.vehicleNo || '')}" placeholder="e.g. TN01AB1234" style="text-transform:uppercase">
            </label>
            <label class="f">
              <span>Transporter ID (GSTIN / TRANSIN)</span>
              <input type="text" id="ewb_transId" value="${esc(meta.transporterId || '')}" placeholder="15-character Transporter GSTIN">
            </label>
            <label class="f">
              <span>Transporter Name</span>
              <input type="text" id="ewb_transName" value="${esc(meta.transporterName || '')}" placeholder="Transporter company name">
            </label>
            <label class="f">
              <span>LR / Bilty / RR No</span>
              <input type="text" id="ewb_lrNo" value="${esc(meta.lrNo || '')}" placeholder="Lorry receipt number">
            </label>
            <label class="f">
              <span>Destination PIN Code</span>
              <input type="text" id="ewb_toPin" value="${esc((d.cust && d.cust.pincode) || '')}" placeholder="6-digit PIN">
            </label>
            <label class="f">
              <span>Approximate Distance (KM)</span>
              <input type="number" id="ewb_dist" value="50" min="1" max="4000">
            </label>
          </div>

          <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
            <button class="btn pri" id="btnExportEwbJson" style="background:#15803d;border-color:#15803d;padding:10px">
              📥 Export Official NIC Bulk-Upload JSON
            </button>
          </div>

          <hr style="margin:16px 0;border:0;border-top:1px solid #e2e8f0">

          <h4 style="margin:0 0 8px">Record Generated E-Way Bill (From Portal)</h4>
          <div class="mute sm" style="margin-bottom:10px">After uploading the JSON to ewaybillgst.gov.in, enter the assigned 12-digit E-Way Bill Number below to record it permanently on this document:</div>
          <div class="grid g3" style="gap:10px">
            <label class="f">
              <span>E-Way Bill Number (12 digits)</span>
              <input type="text" id="rec_ewbNo" value="${esc(meta.ewbNo || '')}" placeholder="e.g. 121000000001" maxlength="12">
            </label>
            <label class="f">
              <span>EWB Date</span>
              <input type="date" id="rec_ewbDate" value="${meta.ewbDate || today()}">
            </label>
            <label class="f">
              <span>Valid Until Date</span>
              <input type="date" id="rec_ewbValid" value="${meta.ewbValidUpto || ''}">
            </label>
          </div>
          <div style="margin-top:10px">
            <button class="btn" id="btnRecordEwbData" style="color:#0284c7">💾 Record EWB on Document</button>
          </div>
        </div>
      `,
      noFooter: true
    });

    $('#btnExportEwbJson').onclick = async () => {
      const transport = {
        vehicleNo: $('#ewb_vehNo').value.trim(),
        transporterId: $('#ewb_transId').value.trim(),
        transporterName: $('#ewb_transName').value.trim(),
        lrNo: $('#ewb_lrNo').value.trim(),
        toPincode: $('#ewb_toPin').value.trim(),
        distanceKm: Number($('#ewb_dist').value) || 50
      };

      try {
        const res = await apiPost(`/api/documents/${d.id}/ewaybill/json`, transport);
        if (res.validation && res.validation.errors && res.validation.errors.length) {
          toast('EWB Validation warning: ' + res.validation.errors[0], 'bad');
        }

        const jsonStr = JSON.stringify(res.payload, null, 2);
        download(`EwayBill_${(d.no || 'doc').replace(/[/\\?%*:|"<>]/g, '_')}.json`, jsonStr, 'application/json');
        toast('✅ Official E-Way Bill JSON downloaded! Ready for upload at ewaybillgst.gov.in');
      } catch (err) {
        toast('Failed to generate EWB JSON: ' + err.message, 'bad');
      }
    };

    $('#btnRecordEwbData').onclick = async () => {
      const ewbNo = $('#rec_ewbNo').value.trim();
      const ewbDate = $('#rec_ewbDate').value;
      const ewbValidUpto = $('#rec_ewbValid').value;
      if (!ewbNo) {
        toast('Please enter the E-Way Bill Number.', 'bad');
        return;
      }
      try {
        await apiPost(`/api/documents/${d.id}/ewaybill/record`, { ewbNo, ewbDate, ewbValidUpto });
        toast(`✅ E-Way Bill #${ewbNo} recorded on document!`);
        closeModal();
        viewDocument(d.id);
      } catch (err) {
        toast('Failed to record EWB: ' + err.message, 'bad');
      }
    };
  }

  /**
   * Modal: Track Partial Delivery Quantities
   */
  async function openPendingDeliveriesModal(d) {
    if (!d.sourceDocId) {
      toast('This document has no linked source order.', 'bad');
      return;
    }

    modal({
      title: '📦 Partial Deliveries Tracker',
      body: `<div style="padding:20px;text-align:center" class="mute">⏳ Loading delivery ledger...</div>`,
      noFooter: true
    });

    try {
      const tracking = await apiGet(`/api/documents/${d.sourceDocId}/pending-deliveries`);
      if (!tracking.length) {
        $('.modal-body').innerHTML = '<div class="empty">No lines found on source document.</div>';
        return;
      }

      $('.modal-body').innerHTML = `
        <div style="margin:8px 0">
          <p class="mute sm" style="margin-bottom:12px">
            Tracking ordered quantities on Source <b>${esc(d.sourceDocNo || 'Order')}</b> vs cumulative dispatched quantities across all Delivery Challans:
          </p>
          <table class="tbl sm">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>HSN</th>
                <th>UOM</th>
                <th class="r">Ordered</th>
                <th class="r">Delivered</th>
                <th class="r">Pending</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${tracking.map(t => `
                <tr>
                  <td><b>${esc(t.name)}</b></td>
                  <td>${esc(t.hsn)}</td>
                  <td>${esc(t.unit)}</td>
                  <td class="r">${t.orderedQty}</td>
                  <td class="r">${t.deliveredQty}</td>
                  <td class="r" style="font-weight:700;color:${t.pendingQty > 0 ? '#b45309' : '#15803d'}">${t.pendingQty}</td>
                  <td>
                    ${t.isFullyDelivered
                      ? '<span class="bd" style="background:#dcfce7;color:#15803d;font-size:0.75rem">Fully Delivered</span>'
                      : '<span class="bd" style="background:#fef3c7;color:#b45309;font-size:0.75rem">Partial / Pending</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="margin-top:14px;text-align:right">
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: Site Measurement Sheet (M-Sheet)
   */
  async function openMeasurementSheetModal(d) {
    modal({
      title: '📐 Site Measurement Sheet (M-Sheet)',
      wide: true,
      body: `<div class="mute" style="padding:20px;text-align:center">Loading site measurement data...</div>`
    });

    try {
      const sheet = await apiGet(`/api/documents/${d.id}/measurement`);
      sheet.rows = sheet.rows || [];

      function renderSheetModal() {
        const bodyEl = $('.modal-body');
        if (!bodyEl) return;

        bodyEl.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
            <div class="card" style="background:#f8fafc;padding:12px">
              <div class="grid g4" style="gap:10px;font-size:0.85rem">
                <div><b>Sheet Ref:</b> ${esc(sheet.sheetNo || 'M-' + d.no)}</div>
                <div><b>Date:</b> ${esc(sheet.date || d.date)}</div>
                <div><b>Status:</b> <span class="bd" style="background:#e0f2fe;color:#0369a1">${esc(sheet.status || 'Verified')}</span></div>
                <div><b>Document:</b> ${esc(d.no)}</div>
              </div>
              <div class="grid g3" style="gap:10px;margin-top:10px">
                <label class="f">
                  <span class="sm">Prepared By (Site Engineer)</span>
                  <input type="text" id="ms_prepBy" value="${esc(sheet.preparedBy || 'Site Engineer')}">
                </label>
                <label class="f">
                  <span class="sm">Checked By (Project Manager)</span>
                  <input type="text" id="ms_chkBy" value="${esc(sheet.checkedBy || 'Project Manager')}">
                </label>
                <label class="f">
                  <span class="sm">Client Representative</span>
                  <input type="text" id="ms_clientRep" value="${esc(sheet.clientRep || 'Client Rep Sign')}">
                </label>
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center">
              <h4 style="margin:0">Detailed Measurement Entries (L &times; B &times; H)</h4>
              <button class="btn sm pri" id="btnAddMsRow">+ Add Measurement Row</button>
            </div>

            <div class="scx" style="max-height:280px">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>Location / Ref</th>
                    <th class="r">Nos</th>
                    <th class="r">L</th>
                    <th class="r">B</th>
                    <th class="r">H</th>
                    <th class="r">Ded.</th>
                    <th class="r">Qty</th>
                    <th>UOM</th>
                    <th>Remarks</th>
                    <th class="r"></th>
                  </tr>
                </thead>
                <tbody>
                  ${sheet.rows.map((r, i) => {
                    const nos = Number(r.nos) || 1;
                    const l = Number(r.length) || 0;
                    const b = Number(r.breadth) || (r.height ? 1 : 0);
                    const h = Number(r.height) || 1;
                    const ded = Number(r.deduction) || 0;
                    let raw = (l > 0 && b > 0) ? (nos * l * b * (r.height ? h : 1)) : (l > 0 ? nos * l : nos);
                    const qty = Math.max(0, raw - ded);

                    return `
                      <tr data-msidx="${i}">
                        <td><input type="text" class="ms_desc" value="${esc(r.itemDesc || '')}" style="width:130px;font-size:0.8rem"></td>
                        <td><input type="text" class="ms_loc" value="${esc(r.location || '')}" style="width:110px;font-size:0.8rem"></td>
                        <td><input type="number" class="ms_nos r" value="${nos}" style="width:50px;font-size:0.8rem"></td>
                        <td><input type="number" step="0.01" class="ms_l r" value="${l}" style="width:60px;font-size:0.8rem"></td>
                        <td><input type="number" step="0.01" class="ms_b r" value="${b}" style="width:60px;font-size:0.8rem"></td>
                        <td><input type="number" step="0.01" class="ms_h r" value="${h}" style="width:60px;font-size:0.8rem"></td>
                        <td><input type="number" step="0.01" class="ms_ded r" value="${ded}" style="width:60px;font-size:0.8rem;color:#dc2626"></td>
                        <td class="r" style="font-weight:700">${qty.toFixed(2)}</td>
                        <td><input type="text" class="ms_uom" value="${esc(r.uom || 'sqft')}" style="width:55px;font-size:0.8rem"></td>
                        <td><input type="text" class="ms_rem" value="${esc(r.remarks || '')}" style="width:100px;font-size:0.8rem"></td>
                        <td class="r"><button class="btn sm del btnDelMsRow" data-delidx="${i}">✕</button></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px">
              <button class="btn" id="btnDownloadMsPdf" style="background:#e0f2fe;color:#0369a1;border-color:#bae6fd">
                📄 Download Official Measurement Annexure PDF
              </button>
              <div style="display:flex;gap:8px">
                <button class="btn ghost" onclick="closeModal()">Close</button>
                <button class="btn pri" id="btnSaveMsSheet">💾 Save Measurement Sheet</button>
              </div>
            </div>
          </div>
        `;

        $('#btnAddMsRow').onclick = () => {
          syncSheetRowsFromDom();
          sheet.rows.push({
            itemDesc: d.lines && d.lines[0] ? d.lines[0].name : 'Site Work',
            location: 'Site Location',
            nos: 1,
            length: 10,
            breadth: 10,
            height: 1,
            deduction: 0,
            uom: 'sqft',
            remarks: ''
          });
          renderSheetModal();
        };

        $$('.btnDelMsRow', bodyEl).forEach(b => {
          b.onclick = () => {
            syncSheetRowsFromDom();
            const idx = parseInt(b.dataset.delidx, 10);
            sheet.rows.splice(idx, 1);
            renderSheetModal();
          };
        });

        $('#btnDownloadMsPdf').onclick = () => {
          window.open(`/api/documents/${d.id}/measurement/pdf`, '_blank');
        };

        $('#btnSaveMsSheet').onclick = async () => {
          syncSheetRowsFromDom();
          try {
            await apiPost(`/api/documents/${d.id}/measurement`, sheet);
            toast('✅ Site Measurement Sheet saved successfully!');
            closeModal();
          } catch (e) {
            toast(e.message, 'bad');
          }
        };
      }

      function syncSheetRowsFromDom() {
        const bodyEl = $('.modal-body');
        if (!bodyEl) return;
        sheet.preparedBy = $('#ms_prepBy') ? $('#ms_prepBy').value.trim() : sheet.preparedBy;
        sheet.checkedBy = $('#ms_chkBy') ? $('#ms_chkBy').value.trim() : sheet.checkedBy;
        sheet.clientRep = $('#ms_clientRep') ? $('#ms_clientRep').value.trim() : sheet.clientRep;

        const trs = $$('tr[data-msidx]', bodyEl);
        sheet.rows = trs.map(tr => ({
          itemDesc: $('.ms_desc', tr).value.trim(),
          location: $('.ms_loc', tr).value.trim(),
          nos: parseFloat($('.ms_nos', tr).value) || 1,
          length: parseFloat($('.ms_l', tr).value) || 0,
          breadth: parseFloat($('.ms_b', tr).value) || 0,
          height: parseFloat($('.ms_h', tr).value) || 0,
          deduction: parseFloat($('.ms_ded', tr).value) || 0,
          uom: $('.ms_uom', tr).value.trim(),
          remarks: $('.ms_rem', tr).value.trim()
        }));
      }

      renderSheetModal();
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: Variation Statement (Quoted vs Approved PO vs Actual Measured)
   */
  async function openVariationStatementModal(d) {
    modal({
      title: '📊 Variation Statement & Control Audit',
      wide: true,
      body: `<div class="mute" style="padding:20px;text-align:center">Calculating variance across quoted lines and measurements...</div>`
    });

    try {
      const statement = await apiGet(`/api/documents/${d.id}/variation`);
      const bodyEl = $('.modal-body');
      if (!bodyEl) return;

      const hasExcess = statement.some(s => s.needsVariationOrder);

      bodyEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          ${hasExcess ? `
            <div class="card" style="background:#fffbeb;border:1px solid #fef08a;padding:12px">
              <b style="color:#b45309">⚠️ Statutory Contractor Hard Control Alert:</b>
              <div class="sm" style="color:#92400e;margin-top:4px">
                Actual measured quantities exceed the approved PO quantities for one or more items.
                In accordance with contractor governance, excess billing is blocked until an official <b>Variation Order</b> is approved or a <b>Quotation Revision (R+1)</b> is issued.
              </div>
            </div>
          ` : `
            <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px">
              <b style="color:#15803d">✅ All Quantities Within Approved Scope:</b>
              <div class="sm" style="color:#166534;margin-top:4px">
                Actual measured quantities are within or below approved Purchase Order limits. No variation order required.
              </div>
            </div>
          `}

          <div class="scx" style="max-height:360px">
            <table class="tbl sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item Description</th>
                  <th>UOM</th>
                  <th class="r">Rate (₹)</th>
                  <th class="r">Quoted Qty</th>
                  <th class="r">Approved PO Qty</th>
                  <th class="r">Actual Measured</th>
                  <th class="r">Variance Qty</th>
                  <th class="r">Variance %</th>
                  <th class="r">Variance Value</th>
                  <th>Audit Status</th>
                </tr>
              </thead>
              <tbody>
                ${statement.map((s, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td><b>${esc(s.description)}</b></td>
                    <td>${esc(s.uom)}</td>
                    <td class="r">${rs(s.rate, 0)}</td>
                    <td class="r">${s.quotedQty}</td>
                    <td class="r">${s.poQty}</td>
                    <td class="r" style="font-weight:700">${s.actualMeasuredQty}</td>
                    <td class="r" style="font-weight:700;color:${s.varianceQty > 0 ? '#dc2626' : (s.varianceQty < 0 ? '#b45309' : '#15803d')}">
                      ${s.varianceQty > 0 ? '+' + s.varianceQty : s.varianceQty}
                    </td>
                    <td class="r" style="color:${s.variancePct > 0 ? '#dc2626' : '#64748b'}">
                      ${s.variancePct > 0 ? '+' + s.variancePct + '%' : s.variancePct + '%'}
                    </td>
                    <td class="r" style="font-weight:700;color:${s.varianceAmount > 0 ? '#dc2626' : '#64748b'}">
                      ${s.varianceAmount > 0 ? '+' + rs(s.varianceAmount, 0) : rs(s.varianceAmount, 0)}
                    </td>
                    <td>
                      ${s.needsVariationOrder
                        ? '<span class="bd" style="background:#fee2e2;color:#b91c1c;font-weight:700;font-size:0.75rem">⚠️ Excess (VO Req)</span>'
                        : (s.isShort
                          ? '<span class="bd" style="background:#fef3c7;color:#b45309;font-size:0.75rem">Short of Scope</span>'
                          : '<span class="bd" style="background:#dcfce7;color:#15803d;font-size:0.75rem">✓ Within Scope</span>')}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <div class="mute sm">💡 Tip: Create a revision (R+1) from this document to adjust rates or approved quantities.</div>
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: Contractor Running Account (RA) Bill / Progress Billing
   */
  async function openRaBillModal(d) {
    modal({
      title: '📑 Contractor Running Account (RA) Bill Breakdown',
      wide: true,
      body: `<div class="mute" style="padding:20px;text-align:center">Preparing progress billing calculations...</div>`
    });

    try {
      let lines = (d.lines || []).map(l => ({
        id: l.id,
        name: l.name || l.desc,
        unit: l.unit || 'sqft',
        rate: Number(l.rate) || 0,
        prevQty: 0,
        currentQty: Number(l.qty) || 1
      }));

      let advPct = 10;
      let retPct = 5;
      let tdsSec = '194C_CO';
      let cessPct = 1;
      let otherDeds = 0;

      async function recalcAndRender() {
        const bodyEl = $('.modal-body');
        if (!bodyEl) return;

        const summary = await apiPost(`/api/documents/${d.id}/rabill/calculate`, {
          lines,
          advanceRecoveryPct: advPct,
          retentionPct: retPct,
          tdsSection: tdsSec,
          labourCessPct: cessPct,
          otherDeductions: otherDeds
        });

        const g = summary.gross;
        const ded = summary.deductions;
        const tx = summary.taxes;

        bodyEl.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
            <!-- Progress Billing 3-Column Table -->
            <h4 style="margin:0">Work Done Breakdown (3-Column Progress Format)</h4>
            <div class="scx" style="max-height:220px">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>UOM</th>
                    <th class="r">Rate (₹)</th>
                    <th class="r">Prev Qty</th>
                    <th class="r">Prev Val (₹)</th>
                    <th class="r">This Bill Qty</th>
                    <th class="r">This Bill Val (₹)</th>
                    <th class="r">Cum. Qty</th>
                    <th class="r">Cum. Val (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${summary.lines.map((l, i) => `
                    <tr data-raidx="${i}">
                      <td><b>${esc(l.description)}</b></td>
                      <td>${esc(l.uom)}</td>
                      <td class="r">${rs(l.rate, 0)}</td>
                      <td class="r"><input type="number" step="0.1" class="ra_prev r" value="${l.previous.qty}" style="width:60px;font-size:0.8rem"></td>
                      <td class="r">${rs(l.previous.amount, 0)}</td>
                      <td class="r"><input type="number" step="0.1" class="ra_curr r" value="${l.thisBill.qty}" style="width:60px;font-size:0.8rem"></td>
                      <td class="r" style="font-weight:700">${rs(l.thisBill.amount, 0)}</td>
                      <td class="r">${l.cumulative.qty}</td>
                      <td class="r">${rs(l.cumulative.amount, 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <!-- Deductions and Controls -->
            <div class="grid g2" style="gap:14px;margin-top:6px">
              <div class="card" style="background:#f8fafc;padding:12px">
                <h4 style="margin:0 0 10px">Contractor Deductions Settings</h4>
                <div class="grid g2" style="gap:10px">
                  <label class="f">
                    <span class="sm">Advance Recovery (%)</span>
                    <input type="number" id="ra_advPct" value="${advPct}" min="0" max="100" step="1">
                  </label>
                  <label class="f">
                    <span class="sm">Retention Money / SD (%)</span>
                    <input type="number" id="ra_retPct" value="${retPct}" min="0" max="100" step="1">
                  </label>
                  <label class="f">
                    <span class="sm">TDS Section</span>
                    <select id="ra_tdsSec">
                      <option value="194C_CO" ${tdsSec === '194C_CO' ? 'selected' : ''}>194C Company (2%)</option>
                      <option value="194C_IND" ${tdsSec === '194C_IND' ? 'selected' : ''}>194C Ind/HUF (1%)</option>
                      <option value="194J" ${tdsSec === '194J' ? 'selected' : ''}>194J Professional (10%)</option>
                      <option value="none" ${tdsSec === 'none' ? 'selected' : ''}>None (0%)</option>
                    </select>
                  </label>
                  <label class="f">
                    <span class="sm">Labour Welfare Cess (%)</span>
                    <input type="number" id="ra_cessPct" value="${cessPct}" min="0" max="5" step="0.5">
                  </label>
                  <label class="f" style="grid-column:span 2">
                    <span class="sm">Other Deductions / Penalties (₹)</span>
                    <input type="number" id="ra_otherDeds" value="${otherDeds}" min="0">
                  </label>
                </div>
              </div>

              <!-- Net Payable Card -->
              <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0;padding:14px;display:flex;flex-direction:column;justify-content:space-between">
                <div>
                  <h4 style="margin:0 0 8px;color:#166534">Bill Summary &amp; Net Payable</h4>
                  <div style="font-size:0.85rem;line-height:1.7">
                    <div style="display:flex;justify-content:space-between">
                      <span>Gross Work Done This Bill:</span>
                      <b>${rs(g.thisBillAmount, 0)}</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#b45309">
                      <span>Less: Advance Recovery (${ded.advanceRecoveryPct}%):</span>
                      <span>-${rs(ded.advanceAdjustment, 0)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#b45309">
                      <span>Less: Retention (${ded.retentionPct}%):</span>
                      <span>-${rs(ded.retentionAmount, 0)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#b45309">
                      <span>Less: TDS u/s ${ded.tdsSection} (${ded.tdsPct}%):</span>
                      <span>-${rs(ded.tdsAmount, 0)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#b45309">
                      <span>Less: Labour Cess (${ded.labourCessPct}%):</span>
                      <span>-${rs(ded.labourCess, 0)}</span>
                    </div>
                    ${ded.otherDeductions ? `
                      <div style="display:flex;justify-content:space-between;color:#b45309">
                        <span>Less: Other Deductions:</span>
                        <span>-${rs(ded.otherDeductions, 0)}</span>
                      </div>
                    ` : ''}
                    <div style="display:flex;justify-content:space-between;color:#1e3a8a">
                      <span>Add: GST (${tx.gstRate}%):</span>
                      <span>+${rs(tx.totalTax, 0)}</span>
                    </div>
                  </div>
                </div>
                <div style="margin-top:14px;padding-top:10px;border-top:2px solid #bbf7d0;display:flex;justify-content:space-between;align-items:center">
                  <span style="font-weight:700;font-size:1.05rem;color:#166534">NET PAYABLE:</span>
                  <span style="font-weight:900;font-size:1.35rem;color:#166534">${rs(summary.netPayable, 0)}</span>
                </div>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
              <button class="btn sm pri" onclick="closeModal()">Close</button>
            </div>
          </div>
        `;

        // Wire inputs
        $('#ra_advPct').onchange = () => { advPct = parseFloat($('#ra_advPct').value) || 0; recalcAndRender(); };
        $('#ra_retPct').onchange = () => { retPct = parseFloat($('#ra_retPct').value) || 0; recalcAndRender(); };
        $('#ra_tdsSec').onchange = () => { tdsSec = $('#ra_tdsSec').value; recalcAndRender(); };
        $('#ra_cessPct').onchange = () => { cessPct = parseFloat($('#ra_cessPct').value) || 0; recalcAndRender(); };
        $('#ra_otherDeds').onchange = () => { otherDeds = parseFloat($('#ra_otherDeds').value) || 0; recalcAndRender(); };

        $$('tr[data-raidx]', bodyEl).forEach(tr => {
          const idx = parseInt(tr.dataset.raidx, 10);
          $('.ra_prev', tr).onchange = () => {
            lines[idx].prevQty = parseFloat($('.ra_prev', tr).value) || 0;
            recalcAndRender();
          };
          $('.ra_curr', tr).onchange = () => {
            lines[idx].currentQty = parseFloat($('.ra_curr', tr).value) || 0;
            recalcAndRender();
          };
        });
      }

      await recalcAndRender();
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // Export functions to window
  window.viewDocuments = viewDocuments;
  window.viewDocument = viewDocument;
})();
