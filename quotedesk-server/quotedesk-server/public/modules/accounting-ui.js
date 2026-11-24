'use strict';
/**
 * accounting-ui.js — UI Module for MR_Quoter Contractor Accounting Suite
 *
 * Provides:
 *   - Double-entry vouchers list & balanced voucher creation modal
 *   - Chart of Accounts & Ledger Statement with running balance
 *   - Day Book, Trial Balance (Dr = Cr validation), P&L, Balance Sheet
 *   - GSTR-1 & GSTR-3B Working Sheet
 */

(function () {
  let activeTab = 'vouchers';
  let cachedAccounts = { groups: [], ledgers: [] };
  let cachedVouchers = [];
  let vchFilter = { q: '', type: 'all', status: 'all', fromDate: '', toDate: '' };
  let ledgerFilter = { q: '', nature: 'all', groupId: 'all' };

  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function rs(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtDate(d) {
    if (!d) return '-';
    try {
      const parts = String(d).slice(0, 10).split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return d;
    } catch (e) { return d; }
  }

  async function viewAccounting() {
    const main = $('#main');
    if (!main) return;

    main.innerHTML = `
      <div class="ph">
        <div>
          <h1>📖 Accounting &amp; Financial Ledgers</h1>
          <div class="mute">Tally-compatible double-entry books, verified trial balance, and statutory reports.</div>
        </div>
        <div class="acts">
          <button class="btn sm" id="btnNewLedger" style="background:#f8fafc;border:1px solid #cbd5e1">+ New Ledger</button>
          <button class="btn pri sm" id="btnNewVoucher">+ Create Voucher</button>
        </div>
      </div>

      <!-- Accounting Sub-Navigation Tabs matching QuoteDesk Design -->
      <div class="chips" style="margin:10px 0 16px;overflow-x:auto;padding-bottom:4px;gap:6px">
        <button class="chip ${activeTab === 'vouchers' ? 'on' : ''}" data-acctab="vouchers">📋 Vouchers</button>
        <button class="chip ${activeTab === 'ledgers' ? 'on' : ''}" data-acctab="ledgers">📒 Ledgers</button>
        <button class="chip ${activeTab === 'projects' ? 'on' : ''}" data-acctab="projects">🏗️ Projects</button>
        <button class="chip ${activeTab === 'pettycash' ? 'on' : ''}" data-acctab="pettycash">💵 Petty Cash</button>
        <button class="chip ${activeTab === 'bank' ? 'on' : ''}" data-acctab="bank">🏦 Bank Statements</button>
        <button class="chip ${activeTab === 'suspense' ? 'on' : ''}" data-acctab="suspense" id="tabBtnSuspense">
          🔔 Suspense <span id="suspenseBadge" class="bd" style="background:#fee2e2;color:#b91c1c;font-size:0.75rem;display:none;margin-left:4px">0</span>
        </button>
        <button class="chip ${activeTab === 'daybook' ? 'on' : ''}" data-acctab="daybook">📅 Day Book</button>
        <button class="chip ${activeTab === 'trialbalance' ? 'on' : ''}" data-acctab="trialbalance">⚖️ Trial Balance</button>
        <button class="chip ${activeTab === 'pnl' ? 'on' : ''}" data-acctab="pnl">📈 Profit &amp; Loss</button>
        <button class="chip ${activeTab === 'balancesheet' ? 'on' : ''}" data-acctab="balancesheet">🏦 Balance Sheet</button>
        <button class="chip ${activeTab === 'stocksummary' ? 'on' : ''}" data-acctab="stocksummary">📦 Stock Summary</button>
        <button class="chip ${activeTab === 'reportshub' ? 'on' : ''}" data-acctab="reportshub">📊 Financial Reports Hub</button>
        <button class="chip ${activeTab === 'outstanding' ? 'on' : ''}" data-acctab="outstanding">💰 Bill Allocation &amp; AR/AP</button>
        <button class="chip ${activeTab === 'yearend' ? 'on' : ''}" data-acctab="yearend">🔒 Year-End Close</button>
        <button class="chip ${activeTab === 'masters' ? 'on' : ''}" data-acctab="masters">📦 Tally Masters</button>
        <button class="chip ${activeTab === 'gst' ? 'on' : ''}" data-acctab="gst">📑 GST Working Sheet</button>
        <button class="chip ${activeTab === 'exports' ? 'on' : ''}" data-acctab="exports">🔄 Tally &amp; Zoho Exports</button>
      </div>

      <div id="accountingTabContent">
        <div class="mute" style="padding:28px;text-align:center">Loading accounting records...</div>
      </div>
    `;

    $$('[data-acctab]', main).forEach(btn => {
      btn.onclick = () => {
        activeTab = btn.dataset.acctab;
        viewAccounting();
      };
    });

    const btnVch = $('#btnNewVoucher');
    if (btnVch) btnVch.onclick = openNewVoucherModal;

    const btnLed = $('#btnNewLedger');
    if (btnLed) btnLed.onclick = openNewLedgerModal;

    try {
      cachedAccounts = await apiGet('/api/accounts');
      const suspSummary = await apiGet('/api/bank/suspense');
      const badge = $('#suspenseBadge');
      if (badge && suspSummary && suspSummary.count > 0) {
        badge.innerText = suspSummary.count;
        badge.style.display = 'inline';
      }
    } catch (e) {
      console.warn('Failed to fetch accounts/suspense:', e);
    }

    renderActiveTab();
  }

  function renderActiveTab() {
    const area = $('#accountingTabContent');
    if (!area) return;

    if (activeTab === 'vouchers') renderVouchersTab(area);
    else if (activeTab === 'ledgers') renderLedgersTab(area);
    else if (activeTab === 'projects') renderProjectsTab(area);
    else if (activeTab === 'pettycash') renderPettyCashTab(area);
    else if (activeTab === 'bank') renderBankTab(area);
    else if (activeTab === 'suspense') renderSuspenseTab(area);
    else if (activeTab === 'daybook') renderDayBookTab(area);
    else if (activeTab === 'trialbalance') renderTrialBalanceTab(area);
    else if (activeTab === 'pnl') renderPnlTab(area);
    else if (activeTab === 'balancesheet') renderBalanceSheetTab(area);
    else if (activeTab === 'stocksummary') renderStockSummaryTab(area);
    else if (activeTab === 'reportshub') renderReportsHubTab(area);
    else if (activeTab === 'outstanding') renderOutstandingTab(area);
    else if (activeTab === 'yearend') renderYearEndTab(area);
    else if (activeTab === 'masters') renderMastersTab(area);
    else if (activeTab === 'gst') renderGstTab(area);
    else if (activeTab === 'exports') renderExportsTab(area);
  }

  // 1. Vouchers Tab
  async function renderVouchersTab(area) {
    try {
      if (!cachedVouchers || !cachedVouchers.length) {
        cachedVouchers = await apiGet('/api/vouchers');
      }

      const totalCount = cachedVouchers.length;
      const postedCount = cachedVouchers.filter(v => !v.cancelled).length;
      const cancelledCount = cachedVouchers.filter(v => v.cancelled).length;

      const q = (vchFilter.q || '').trim().toLowerCase();
      const filtered = cachedVouchers.filter(v => {
        if (vchFilter.type !== 'all' && v.voucherType !== vchFilter.type) return false;
        if (vchFilter.status === 'posted' && v.cancelled) return false;
        if (vchFilter.status === 'cancelled' && !v.cancelled) return false;
        if (vchFilter.fromDate && v.date < vchFilter.fromDate) return false;
        if (vchFilter.toDate && v.date > vchFilter.toDate) return false;
        if (q) {
          const text = [
            v.voucherNo,
            v.partyName,
            v.narration,
            v.docRef,
            v.chequeNo,
            ...(v.entries || []).map(e => e.ledgerName || e.ledgerId)
          ].filter(Boolean).join(' ').toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });

      area.innerHTML = `
        <div class="tools" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <input type="search" id="vchSearchInput" placeholder="Search voucher number, party, narration, reference..." style="flex:1;min-width:220px" value="${esc(vchFilter.q)}">
          <select id="vchTypeSelect" style="max-width:180px">
            <option value="all" ${vchFilter.type === 'all' ? 'selected' : ''}>All Voucher Types</option>
            <option value="sales" ${vchFilter.type === 'sales' ? 'selected' : ''}>Sales (SLS)</option>
            <option value="purchase" ${vchFilter.type === 'purchase' ? 'selected' : ''}>Purchase (PUR)</option>
            <option value="payment" ${vchFilter.type === 'payment' ? 'selected' : ''}>Payment (PMT)</option>
            <option value="receipt" ${vchFilter.type === 'receipt' ? 'selected' : ''}>Receipt (RCP)</option>
            <option value="journal" ${vchFilter.type === 'journal' ? 'selected' : ''}>Journal (JRN)</option>
            <option value="contra" ${vchFilter.type === 'contra' ? 'selected' : ''}>Contra (CTR)</option>
            <option value="debit_note" ${vchFilter.type === 'debit_note' ? 'selected' : ''}>Debit Note (DBN)</option>
            <option value="credit_note" ${vchFilter.type === 'credit_note' ? 'selected' : ''}>Credit Note (CRN)</option>
          </select>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="sm mute">From:</span>
            <input type="date" id="vchFromDate" value="${vchFilter.fromDate || ''}" style="max-width:130px;padding:4px 8px;font-size:0.82rem">
            <span class="sm mute">To:</span>
            <input type="date" id="vchToDate" value="${vchFilter.toDate || ''}" style="max-width:130px;padding:4px 8px;font-size:0.82rem">
          </div>
        </div>

        <div class="chips" id="vchStatusChips" style="margin-bottom:12px">
          <button class="chip ${vchFilter.status === 'all' ? 'on' : ''}" data-vchstat="all">All <b>${totalCount}</b></button>
          <button class="chip ${vchFilter.status === 'posted' ? 'on' : ''}" data-vchstat="posted">Posted <b>${postedCount}</b></button>
          <button class="chip ${vchFilter.status === 'cancelled' ? 'on' : ''}" data-vchstat="cancelled">Cancelled <b>${cancelledCount}</b></button>
        </div>

        <div class="card" style="padding:6px 10px">
          <div class="scx">
            ${filtered.length ? `
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Voucher No</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Party / Narration</th>
                    <th>Reference</th>
                    <th class="r">Total Amount</th>
                    <th>Status</th>
                    <th class="r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(v => {
                    const typeLabel = (v.voucherType || '').toUpperCase();
                    return `
                      <tr>
                        <td><b>${esc(v.voucherNo)}</b></td>
                        <td><span class="bd" style="background:#f1f5f9;color:#0f172a;font-weight:700">${typeLabel}</span></td>
                        <td>${fmtDate(v.date)}</td>
                        <td>
                          <b>${esc(v.partyName || '')}</b>
                          <div class="mute sm">${esc(v.narration || '')}</div>
                        </td>
                        <td>${esc(v.docRef || '-')}</td>
                        <td class="r" style="font-weight:700">${rs(v.totalAmount)}</td>
                        <td>
                          ${v.cancelled
                            ? '<span class="bd" style="background:#fee2e2;color:#b91c1c;font-weight:700">CANCELLED</span>'
                            : '<span class="bd" style="background:#dcfce7;color:#15803d">Posted</span>'}
                        </td>
                        <td class="r nowrap">
                          <button class="btn sm ghost btnViewVch" data-vid="${v.id}" title="View Preview">👁 View</button>
                          <button class="btn sm ghost btnDlVch" data-vid="${v.id}" title="Download Options">📥</button>
                          <button class="btn sm ghost btnMailVch" data-vid="${v.id}" title="Send Mail">✉</button>
                          <button class="btn sm ghost btnWaVch" data-vid="${v.id}" title="Share WhatsApp" style="color:#128c7e">📱</button>
                          ${!v.cancelled ? `
                            <button class="btn sm ghost btnCancelVch" data-vid="${v.id}" style="color:var(--bad)" title="Cancel Voucher">🗑️</button>
                          ` : ''}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            ` : `
              <div class="empty" style="padding:24px 12px">
                ${cachedVouchers.length ? 'No vouchers match this filter.' : 'No accounting vouchers recorded yet.'}
                <div style="margin-top:10px">
                  <button class="btn sm pri" id="btnEmptyVch">+ Create First Voucher</button>
                </div>
              </div>
            `}
          </div>
        </div>
      `;

      const searchInput = $('#vchSearchInput', area);
      if (searchInput) searchInput.oninput = (e) => { vchFilter.q = e.target.value; renderVouchersTab(area); };

      const typeSelect = $('#vchTypeSelect', area);
      if (typeSelect) typeSelect.onchange = (e) => { vchFilter.type = e.target.value; renderVouchersTab(area); };

      const fromInput = $('#vchFromDate', area);
      if (fromInput) fromInput.onchange = (e) => { vchFilter.fromDate = e.target.value; renderVouchersTab(area); };

      const toInput = $('#vchToDate', area);
      if (toInput) toInput.onchange = (e) => { vchFilter.toDate = e.target.value; renderVouchersTab(area); };

      $$('[data-vchstat]', area).forEach(b => {
        b.onclick = () => { vchFilter.status = b.dataset.vchstat; renderVouchersTab(area); };
      });

      const btnEmpty = $('#btnEmptyVch', area);
      if (btnEmpty) btnEmpty.onclick = openNewVoucherModal;

      $$('.btnViewVch', area).forEach(b => {
        b.onclick = () => {
          const v = cachedVouchers.find(x => x.id === b.dataset.vid);
          if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.previewVoucher(v);
          else if (v) openVoucherDetailModal(v);
        };
      });

      $$('.btnDlVch', area).forEach(b => {
        b.onclick = () => {
          const v = cachedVouchers.find(x => x.id === b.dataset.vid);
          if (!v) return;
          modal({
            title: `Download & Export Voucher: ${v.voucherNo}`,
            noFooter: true,
            body: `
              <div class="grid g2" style="margin:12px 0;gap:12px">
                <button class="btn pri" id="btnDlVchPdf" style="justify-content:center;padding:14px;font-size:0.92rem;font-weight:600">📄 Download Official PDF Document</button>
                <button class="btn" id="btnDlVchPrint" style="justify-content:center;padding:14px;font-size:0.92rem;font-weight:600;border:1px solid #cbd5e1">🖨️ Open Print &amp; PDF Sheet</button>
              </div>
            `
          });
          const btnPdf = $('#btnDlVchPdf');
          if (btnPdf) btnPdf.onclick = () => { closeModal(); window.QuoteDeskPrint.downloadVchPdfDirect(v); };
          const btnPrint = $('#btnDlVchPrint');
          if (btnPrint) btnPrint.onclick = () => { closeModal(); window.QuoteDeskPrint.previewVoucher(v); };
        };
      });

      $$('.btnMailVch', area).forEach(b => {
        b.onclick = () => {
          const v = cachedVouchers.find(x => x.id === b.dataset.vid);
          if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.openEmailModal(v, true);
        };
      });

      $$('.btnWaVch', area).forEach(b => {
        b.onclick = () => {
          const v = cachedVouchers.find(x => x.id === b.dataset.vid);
          if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.openWhatsAppShare(v, true);
        };
      });

      $$('.btnCancelVch', area).forEach(b => {
        b.onclick = () => promptCancelVoucher(b.dataset.vid);
      });
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 2. Ledgers Tab
  function renderLedgersTab(area) {
    const ledgers = cachedAccounts.ledgers || [];
    const groups = cachedAccounts.groups || [];
    if (!ledgers.length) {
      area.innerHTML = `<div class="card mute" style="padding:24px;text-align:center">No ledgers found.</div>`;
      return;
    }

    const q = (ledgerFilter.q || '').trim().toLowerCase();
    const filtered = ledgers.filter(l => {
      if (ledgerFilter.nature !== 'all' && l.nature !== ledgerFilter.nature) return false;
      if (ledgerFilter.groupId !== 'all' && l.groupId !== ledgerFilter.groupId) return false;
      if (q) {
        const text = [l.name, l.code, l.groupName, l.nature].filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    area.innerHTML = `
      <div class="tools" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <input type="search" id="ledgerSearchInput" placeholder="Search ledger name, code or group..." style="flex:1;min-width:220px" value="${esc(ledgerFilter.q)}">
        <select id="ledgerGroupSelect" style="max-width:220px">
          <option value="all">All Account Groups</option>
          ${groups.map(g => `<option value="${g.id}" ${ledgerFilter.groupId === g.id ? 'selected' : ''}>${esc(g.name)} (${esc(g.nature)})</option>`).join('')}
        </select>
      </div>

      <div class="chips" id="ledgerNatureChips" style="margin-bottom:12px">
        <button class="chip ${ledgerFilter.nature === 'all' ? 'on' : ''}" data-nature="all">All <b>${ledgers.length}</b></button>
        <button class="chip ${ledgerFilter.nature === 'assets' ? 'on' : ''}" data-nature="assets">Assets <b>${ledgers.filter(l => l.nature === 'assets').length}</b></button>
        <button class="chip ${ledgerFilter.nature === 'liabilities' ? 'on' : ''}" data-nature="liabilities">Liabilities <b>${ledgers.filter(l => l.nature === 'liabilities').length}</b></button>
        <button class="chip ${ledgerFilter.nature === 'income' ? 'on' : ''}" data-nature="income">Incomes <b>${ledgers.filter(l => l.nature === 'income').length}</b></button>
        <button class="chip ${ledgerFilter.nature === 'expenses' ? 'on' : ''}" data-nature="expenses">Expenses <b>${ledgers.filter(l => l.nature === 'expenses').length}</b></button>
      </div>

      <div class="card" style="padding:6px 10px">
        <div class="scx">
          ${filtered.length ? `
            <table class="tbl sm">
              <thead>
                <tr>
                  <th>Ledger Name</th>
                  <th>Under Group</th>
                  <th>Nature</th>
                  <th class="r">Opening Balance</th>
                  <th class="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(l => `
                  <tr>
                    <td><b>${esc(l.name)}</b> ${l.isSystem ? '<span class="mute sm" style="font-size:0.75rem">(System)</span>' : ''}</td>
                    <td>${esc(l.groupName)}</td>
                    <td><span class="bd" style="text-transform:capitalize">${esc(l.nature)}</span></td>
                    <td class="r">${rs(l.openingBalance || 0)} ${l.openingBalanceType || 'Dr'}</td>
                    <td class="r nowrap">
                      <button class="btn sm ghost btnOpenStmt" data-lid="${l.id}" title="View Ledger Statement">📜 Statement</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `
            <div class="empty" style="padding:20px;text-align:center">No ledgers match this filter.</div>
          `}
        </div>
      </div>
    `;

    const searchInput = $('#ledgerSearchInput', area);
    if (searchInput) searchInput.oninput = (e) => { ledgerFilter.q = e.target.value; renderLedgersTab(area); };

    const groupSelect = $('#ledgerGroupSelect', area);
    if (groupSelect) groupSelect.onchange = (e) => { ledgerFilter.groupId = e.target.value; renderLedgersTab(area); };

    $$('[data-nature]', area).forEach(b => {
      b.onclick = () => { ledgerFilter.nature = b.dataset.nature; renderLedgersTab(area); };
    });

    $$('.btnOpenStmt', area).forEach(b => {
      b.onclick = () => openLedgerStatementModal(b.dataset.lid);
    });
  }

  // 2A1. Projects & P&L Tab
  async function renderProjectsTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading projects &amp; budget analytics...</div>`;

    try {
      const projects = await apiGet('/api/projects');

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <div>
              <h4 style="margin:0 0 4px">🏗️ Project-Wise Expense Tracker &amp; P&amp;L</h4>
              <div class="mute sm">Track Quoted vs Billed vs Actual Material, Labour &amp; Petty Cash costs with real-time budget utilization alerts.</div>
            </div>
            <button class="btn pri sm" id="btnCreateProject">+ New Project</button>
          </div>

          <div class="card">
            ${!projects.length ? `
              <div class="mute" style="padding:24px;text-align:center">No active projects created yet. Click "+ New Project" to set up your first project.</div>
            ` : `
              <div class="scx">
                <table class="tbl sm">
                  <thead>
                    <tr>
                      <th>Project Code &amp; Name</th>
                      <th>Client / Site</th>
                      <th class="r">Budget (₹)</th>
                      <th>Status</th>
                      <th class="r">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${projects.map(p => `
                      <tr>
                        <td>
                          <b>[${esc(p.code)}]</b> ${esc(p.name)}
                          ${p.notes ? `<div class="mute sm">${esc(p.notes)}</div>` : ''}
                        </td>
                        <td>
                          <b>${esc(p.customerName || '-')}</b>
                          <div class="mute sm">${esc(p.site || '')}</div>
                        </td>
                        <td class="r" style="font-weight:700">${rs(p.budget)}</td>
                        <td>
                          <span class="bd" style="background:#e0f2fe;color:#0369a1;text-transform:uppercase">${esc(p.status)}</span>
                        </td>
                        <td class="r">
                          <button class="btn sm ghost btnProjFin" data-pid="${p.id}">📊 P&amp;L Financials</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      `;

      $('#btnCreateProject').onclick = openCreateProjectModal;

      $$('.btnProjFin', area).forEach(b => {
        b.onclick = () => openProjectFinancialsModal(b.dataset.pid);
      });
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  function openCreateProjectModal() {
    modal({
      title: '🏗️ Create New Project Master',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <label class="f">
            <span>Project Name <b style="color:#dc2626">*</b></span>
            <input type="text" id="np_name" placeholder="e.g. Prestige Tech Park Block B">
          </label>
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span>Project Code</span>
              <input type="text" id="np_code" placeholder="e.g. PTPB" style="text-transform:uppercase">
            </label>
            <label class="f">
              <span>Total Project Budget (₹)</span>
              <input type="number" id="np_budget" value="500000" min="0">
            </label>
          </div>
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span>Client Name</span>
              <input type="text" id="np_cust" placeholder="Client / Owner">
            </label>
            <label class="f">
              <span>Site Location</span>
              <input type="text" id="np_site" placeholder="City / Address">
            </label>
          </div>
          <label class="f">
            <span>Notes / Scope Description</span>
            <input type="text" id="np_notes" placeholder="Brief project scope">
          </label>
        </div>
      `,
      okText: 'Create Project',
      onOk: async () => {
        const name = $('#np_name').value.trim();
        const code = $('#np_code').value.trim();
        const budget = parseFloat($('#np_budget').value) || 0;
        const customerName = $('#np_cust').value.trim();
        const site = $('#np_site').value.trim();
        const notes = $('#np_notes').value.trim();

        if (!name) {
          toast('Project name is required.', 'bad');
          return false;
        }

        try {
          await apiPost('/api/projects', { name, code, budget, customerName, site, notes });
          toast('✅ Project master created successfully!');
          closeModal();
          renderActiveTab();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });
  }

  async function openProjectFinancialsModal(projectId) {
    modal({
      title: '📊 Project Financials & P&L Statement',
      wide: true,
      body: `<div class="mute" style="padding:20px;text-align:center">Computing project costs, revenue, and margins...</div>`
    });

    try {
      const data = await apiGet(`/api/projects/${projectId}/financials`);
      const bodyEl = $('.modal-body');
      if (!bodyEl) return;

      const p = data.project;
      const m = data.metrics;

      const badgeColor = m.budgetStatus === 'exceeded'
        ? 'background:#fee2e2;color:#b91c1c'
        : (m.budgetStatus === 'warning' ? 'background:#fef3c7;color:#b45309' : 'background:#dcfce7;color:#15803d');

      bodyEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px;margin:4px 0">
          <div class="card" style="background:#f8fafc;padding:12px">
            <div class="grid g4" style="font-size:0.85rem">
              <div><b>Project:</b> [${esc(p.code)}] ${esc(p.name)}</div>
              <div><b>Client:</b> ${esc(p.customerName || '-')}</div>
              <div><b>Budget:</b> ${rs(m.budget)}</div>
              <div><b>Budget Status:</b> <span class="bd" style="${badgeColor};font-weight:700">${m.budgetStatus.toUpperCase()} (${m.budgetUtilizationPct}%)</span></div>
            </div>
          </div>

          <div class="grid g3" style="gap:12px">
            <div class="card" style="padding:12px">
              <span class="mute sm">Total Revenue Billed:</span>
              <div style="font-size:1.3rem;font-weight:900;color:#15803d;margin-top:4px">${rs(m.billedValue)}</div>
              <div class="mute sm">Quoted: ${rs(m.quotedValue)}</div>
            </div>
            <div class="card" style="padding:12px">
              <span class="mute sm">Total Actual Expenses:</span>
              <div style="font-size:1.3rem;font-weight:900;color:#dc2626;margin-top:4px">${rs(m.expenses.total)}</div>
              <div class="mute sm">Budget: ${rs(m.budget)}</div>
            </div>
            <div class="card" style="padding:12px;background:#f0fdf4;border-color:#bbf7d0">
              <span class="mute sm" style="color:#166534">Realized Net Profit &amp; Margin:</span>
              <div style="font-size:1.3rem;font-weight:900;color:#166534;margin-top:4px">${rs(m.netProfit)}</div>
              <div style="font-weight:700;color:#15803d">Margin: ${m.marginPct}%</div>
            </div>
          </div>

          <!-- Expense Breakdown Table -->
          <div class="card">
            <h4 style="margin:0 0 8px">Cost Breakdown by Category</h4>
            <table class="tbl sm">
              <thead><tr><th>Cost Category</th><th class="r">Incurred Amount (₹)</th></tr></thead>
              <tbody>
                <tr><td>Raw Materials &amp; Purchases</td><td class="r">${rs(m.expenses.materials)}</td></tr>
                <tr><td>Subcontractor &amp; Labour Wages</td><td class="r">${rs(m.expenses.labour)}</td></tr>
                <tr><td>Site Petty Cash &amp; Other Expenses</td><td class="r">${rs(m.expenses.other)}</td></tr>
              </tbody>
              <tfoot>
                <tr style="font-weight:900;background:#f8fafc">
                  <td>TOTAL PROJECT COSTS:</td>
                  <td class="r" style="color:#dc2626">${rs(m.expenses.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style="text-align:right">
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 2A2. Petty Cash Tab
  async function renderPettyCashTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading petty cash register...</div>`;

    try {
      const res = await apiGet('/api/pettycash/balance');
      const balance = res.balance || 0;

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <!-- Balance & Action Header -->
          <div class="card" style="padding:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;background:#f0fdf4;border:1px solid #bbf7d0">
            <div>
              <span class="mute sm" style="color:#166534">Current Site Imprest Cash in Hand:</span>
              <div style="font-size:1.8rem;font-weight:900;color:#166534;margin-top:2px">${rs(balance)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn pri sm" id="btnRecordPettyExp">💸 Record Expense</button>
              <button class="btn sm" id="btnTopupPetty" style="background:#e0f2fe;color:#0369a1;border-color:#bae6fd">💳 Replenish Imprest</button>
              <button class="btn ghost sm" id="btnReconcilePetty">🔍 Reconcile Physical Cash</button>
            </div>
          </div>

          <!-- Guidelines Card -->
          <div class="card" style="background:#f8fafc;padding:16px">
            <h4 style="margin:0 0 8px">💵 Imprest System &amp; Audit Rules</h4>
            <ul class="mute sm" style="margin:0;padding-left:18px;line-height:1.6">
              <li><b>Imprest Limit:</b> Expenses cannot exceed available cash in hand. Over-spending is strictly blocked.</li>
              <li><b>Double-Entry Auto-Posting:</b> Each recorded expense automatically generates an official Payment Voucher in the general ledger.</li>
              <li><b>Physical Count Verification:</b> Site supervisors can perform physical cash counts; any shortage or surplus is automatically audited.</li>
            </ul>
          </div>
        </div>
      `;

      $('#btnRecordPettyExp').onclick = () => openRecordPettyExpenseModal(balance);
      $('#btnTopupPetty').onclick = openTopupPettyModal;
      $('#btnReconcilePetty').onclick = () => openReconcilePettyModal(balance);
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  function openRecordPettyExpenseModal(currentBal) {
    modal({
      title: '💸 Record Site Petty Cash Expense',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="card" style="background:#f8fafc;padding:10px;font-size:0.85rem">
            <b>Available Cash in Hand:</b> <span style="color:#15803d;font-weight:700">${rs(currentBal)}</span>
          </div>
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span>Expense Category <b style="color:#dc2626">*</b></span>
              <select id="pe_head">
                <option value="Site Tea & Refreshments">Site Tea &amp; Refreshments</option>
                <option value="Local Travel & Auto Conveyance">Local Travel &amp; Conveyance</option>
                <option value="Site Minor Hardware">Minor Hardware &amp; Screws</option>
                <option value="Postage & Courier Charges">Postage &amp; Courier</option>
                <option value="Material Unloading Charges">Unloading / Coolie</option>
              </select>
            </label>
            <label class="f">
              <span>Amount (₹) <b style="color:#dc2626">*</b></span>
              <input type="number" id="pe_amt" placeholder="e.g. 350" min="1" max="${currentBal}">
            </label>
          </div>
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span>Paid To (Person / Shop)</span>
              <input type="text" id="pe_paidTo" placeholder="Vendor / Shop name">
            </label>
            <label class="f">
              <span>Bill / Cash Memo No</span>
              <input type="text" id="pe_billNo" placeholder="Receipt / Memo ref">
            </label>
          </div>
          <label class="f">
            <span>Remarks / Purpose</span>
            <input type="text" id="pe_notes" placeholder="Purpose of this site expense">
          </label>
        </div>
      `,
      okText: 'Record Expense',
      onOk: async () => {
        const expenseHeadName = $('#pe_head').value;
        const amount = parseFloat($('#pe_amt').value) || 0;
        const paidTo = $('#pe_paidTo').value.trim();
        const billNo = $('#pe_billNo').value.trim();
        const notes = $('#pe_notes').value.trim();

        if (amount <= 0) {
          toast('Amount must be greater than zero.', 'bad');
          return false;
        }
        if (amount > currentBal) {
          toast(`Amount exceeds available balance of ${rs(currentBal)}.`, 'bad');
          return false;
        }

        try {
          await apiPost('/api/pettycash/expense', { expenseHeadName, amount, paidTo, billNo, notes });
          toast('✅ Petty cash expense recorded and voucher posted!');
          closeModal();
          renderActiveTab();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });
  }

  function openTopupPettyModal() {
    modal({
      title: '💳 Replenish Petty Cash Imprest',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <label class="f">
            <span>Transfer from Bank Account</span>
            <select id="pt_bank">
              <option value="led_bank_default">Primary Bank Account</option>
            </select>
          </label>
          <label class="f">
            <span>Top-up Amount (₹) <b style="color:#dc2626">*</b></span>
            <input type="number" id="pt_amt" value="10000" min="1">
          </label>
          <label class="f">
            <span>Cheque / ATM / Withdrawal Ref</span>
            <input type="text" id="pt_notes" placeholder="e.g. Self Cheque No 123456 / ATM Cash Withdrawal">
          </label>
        </div>
      `,
      okText: 'Top-up Cash Float',
      onOk: async () => {
        const amount = parseFloat($('#pt_amt').value) || 0;
        const fromLedgerId = $('#pt_bank').value;
        const notes = $('#pt_notes').value.trim();

        if (amount <= 0) {
          toast('Amount must be greater than zero.', 'bad');
          return false;
        }

        try {
          await apiPost('/api/pettycash/topup', { amount, fromLedgerId, notes });
          toast('✅ Imprest fund topped up successfully!');
          closeModal();
          renderActiveTab();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });
  }

  function openReconcilePettyModal(bookBal) {
    modal({
      title: '🔍 Reconcile Physical Cash Count',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="card" style="background:#f8fafc;padding:10px;font-size:0.85rem">
            <b>Current Book Balance:</b> <span style="font-weight:700">${rs(bookBal)}</span>
          </div>
          <label class="f">
            <span>Actual Physical Cash Counted in Safe (₹) <b style="color:#dc2626">*</b></span>
            <input type="number" id="pr_count" value="${bookBal}" min="0" step="1">
          </label>
          <div id="pr_diffNote" style="font-size:0.85rem"></div>
        </div>
      `,
      okText: 'Submit Audit Verification',
      onOk: async () => {
        const physicalCount = parseFloat($('#pr_count').value) || 0;
        try {
          const res = await apiPost('/api/pettycash/reconcile', { physicalCount });
          if (res.status === 'tallied') toast('✅ Physical count strictly matches book balance!');
          else if (res.status === 'shortage') toast(`⚠️ Cash shortage of ${rs(Math.abs(res.discrepancy))} recorded in audit log.`, 'bad');
          else toast(`Cash surplus of ${rs(res.discrepancy)} recorded.`);
          closeModal();
          renderActiveTab();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });

    const inp = $('#pr_count');
    if (inp) {
      inp.oninput = () => {
        const val = parseFloat(inp.value) || 0;
        const diff = val - bookBal;
        const el = $('#pr_diffNote');
        if (diff === 0) el.innerHTML = `<span style="color:#15803d">✓ Perfect Match (₹0 difference)</span>`;
        else if (diff < 0) el.innerHTML = `<span style="color:#dc2626">⚠️ Shortage of ₹${Math.abs(diff)}</span>`;
        else el.innerHTML = `<span style="color:#0284c7">Surplus of ₹${diff}</span>`;
      };
      inp.oninput();
    }
  }

  // 2B. Bank Statements Tab
  async function renderBankTab(area) {
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <h4 style="margin:0 0 4px">🏦 Bank Statement Import &amp; Auto-Reconciliation</h4>
            <div class="mute sm">Upload statements in CSV, TSV or Excel format for automated party matching and double-entry posting.</div>
          </div>
          <button class="btn pri sm" id="btnUploadBankCsv">📥 Upload Statement (CSV / TSV)</button>
        </div>

        <div class="card" style="background:#f8fafc;padding:16px">
          <h4 style="margin:0 0 8px">⚡ Intelligent Auto-Entry &amp; Duplicate Protection Rules</h4>
          <ul class="mute sm" style="margin:0;padding-left:18px;line-height:1.6">
            <li><b>Automatic Party Identification:</b> Client credits are automatically matched to Customers (Receipt Voucher), and supplier debits are matched to Vendors (Payment Voucher).</li>
            <li><b>100% SHA-256 Duplicate Protection:</b> Statements can be uploaded repeatedly with zero fear of double entries. Previously uploaded rows are skipped automatically.</li>
            <li><b>Audit-Grade Suspense Routing:</b> Any unmatched, ambiguous, or unallocated deposit/withdrawal is safely routed to the Suspense Account with a mandatory reason.</li>
          </ul>
        </div>
      </div>
    `;

    $('#btnUploadBankCsv').onclick = openUploadBankModal;
  }

  function openUploadBankModal() {
    modal({
      title: '📥 Upload Bank Statement (CSV / TSV)',
      wide: true,
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span class="sm">Target Bank Account Ledger</span>
              <select id="bu_bankAccount">
                <option value="led_bank_default">Primary Bank Account (Current A/c)</option>
                <option value="led_cash">Cash in Hand</option>
              </select>
            </label>
            <label class="f">
              <span class="sm">Choose CSV File</span>
              <input type="file" id="bu_file" accept=".csv,.txt,.tsv" style="padding:4px">
            </label>
          </div>

          <label class="f">
            <span class="sm">Or Paste Statement Text (CSV / Tabular Copy from Netbanking)</span>
            <textarea id="bu_rawText" rows="6" placeholder="Date,Narration,Chq/Ref,Withdrawal,Deposit,Balance..." style="font-family:monospace;font-size:0.8rem"></textarea>
          </label>

          <div id="bu_previewArea"></div>
        </div>
      `,
      okText: '⚡ Process & Auto-Post',
      onOk: async () => {
        const rawCsv = $('#bu_rawText').value.trim();
        const bankAccountId = $('#bu_bankAccount').value;

        if (!rawCsv) {
          toast('Please choose a CSV file or paste statement text.', 'bad');
          return false;
        }

        try {
          const res = await apiPost('/api/bank/upload', { rawCsv, bankAccountId });
          toast(`✅ Processed: ${res.postedCount} posted, ${res.duplicateCount} duplicates skipped, ${res.suspenseCount} in Suspense.`);
          closeModal();
          viewAccounting();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });

    const fileInp = $('#bu_file');
    if (fileInp) {
      fileInp.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          $('#bu_rawText').value = evt.target.result;
        };
        reader.readAsText(file);
      };
    }
  }

  // 2C. Suspense Items Clearance Tab
  async function renderSuspenseTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading unallocated suspense items...</div>`;

    try {
      const summary = await apiGet('/api/bank/suspense');
      const items = summary.items || [];

      if (!items.length) {
        area.innerHTML = `
          <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0;padding:24px;text-align:center">
            <h3 style="color:#15803d;margin:0 0 6px">✅ All Suspense Items Cleared!</h3>
            <p class="mute sm" style="margin:0">Zero unallocated bank transactions. Your bank ledger is 100% reconciled with party accounts.</p>
          </div>
        `;
        return;
      }

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="card" style="background:#fffbeb;border:1px solid #fef08a;padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <div>
              <b style="color:#b45309">⚠️ Action Required: ${summary.count} Transactions in Suspense Account</b>
              <div class="sm" style="color:#92400e;margin-top:2px">
                Total Unresolved Value: <b>${rs(summary.totalAmount)}</b>. Each transaction must be assigned to its respective customer, vendor, or expense ledger before period closing.
              </div>
            </div>
          </div>

          <div class="card">
            <div class="scx">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th class="r">Amount (₹)</th>
                    <th>Narration / UTR</th>
                    <th>Audit Reason</th>
                    <th class="r">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(item => `
                    <tr>
                      <td>${fmtDate(item.date)}</td>
                      <td>
                        ${item.type === 'credit'
                          ? '<span class="bd" style="background:#dcfce7;color:#15803d;font-weight:700">Receipt (Cr)</span>'
                          : '<span class="bd" style="background:#fee2e2;color:#b91c1c;font-weight:700">Payment (Dr)</span>'}
                      </td>
                      <td class="r" style="font-weight:700">${rs(item.amount)}</td>
                      <td>
                        <b>${esc(item.narration)}</b>
                        ${item.ref ? `<div class="mute sm">Ref: ${esc(item.ref)}</div>` : ''}
                      </td>
                      <td class="sm" style="color:#b45309">${esc(item.suspenseReason)}</td>
                      <td class="r">
                        <button class="btn sm pri btnResolveSusp" data-txnid="${item.id}">⚡ Resolve</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      $$('.btnResolveSusp', area).forEach(b => {
        b.onclick = () => {
          const item = items.find(x => x.id === b.dataset.txnid);
          if (item) openResolveSuspenseModal(item);
        };
      });
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  function openResolveSuspenseModal(item) {
    const ledgers = cachedAccounts.ledgers || [];

    // Extract keyword candidate from narration
    const cleanWords = item.narration.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !['NEFT', 'RTGS', 'UPI', 'IMPS', 'PAYMENT', 'BANK', 'TRANSFER', 'FROM'].includes(w.toUpperCase()));
    const suggestedKeyword = cleanWords[0] || '';

    modal({
      title: `⚡ Resolve Suspense Item — ${rs(item.amount)}`,
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="card" style="background:#f8fafc;padding:12px;font-size:0.85rem">
            <div><b>Txn Date:</b> ${fmtDate(item.date)} | <b>Type:</b> ${item.type.toUpperCase()} | <b>Amount:</b> ${rs(item.amount)}</div>
            <div style="margin-top:6px"><b>Narration:</b> ${esc(item.narration)}</div>
          </div>

          <label class="f">
            <span>Reclassify to Target Ledger Account <b style="color:#dc2626">*</b></span>
            <select id="rs_ledger">
              ${ledgers.map(l => `<option value="${l.id}" data-grp="${esc(l.groupName)}" data-pname="${esc(l.name)}" data-pid="${esc(l.partyId || '')}">${esc(l.name)} (${esc(l.groupName)})</option>`).join('')}
            </select>
          </label>

          <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;cursor:pointer">
            <input type="checkbox" id="rs_remember" checked style="margin-top:3px">
            <div>
              <b style="color:#166534">Remember this rule for future statements</b>
              <div class="mute sm">Automatically route future transactions containing this keyword to this ledger:</div>
              <input type="text" id="rs_keyword" value="${esc(suggestedKeyword)}" style="margin-top:4px;font-size:0.85rem;text-transform:uppercase">
            </div>
          </label>
        </div>
      `,
      okText: '💾 Reclassify & Clear Suspense',
      onOk: async () => {
        const selOpt = $('#rs_ledger option:checked');
        const targetLedgerId = selOpt.value;
        const targetLedgerName = selOpt.dataset.pname;
        const targetPartyId = selOpt.dataset.pid || null;
        const targetPartyName = selOpt.dataset.pname;
        const rememberRule = $('#rs_remember').checked;
        const keyword = $('#rs_keyword').value.trim();

        try {
          await apiPost(`/api/bank/suspense/${item.id}/resolve`, {
            targetLedgerId,
            targetLedgerName,
            targetPartyId,
            targetPartyName,
            rememberRule,
            keyword
          });
          toast('✅ Suspense item cleared and reclassified.');
          closeModal();
          viewAccounting();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });
  }

  // 3. Day Book Tab
  async function renderDayBookTab(area) {
    const today = new Date().toISOString().slice(0, 10);
    area.innerHTML = `
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px">
            <span class="sm">Date:</span>
            <input type="date" id="db_date" value="${today}" style="padding:4px 8px">
          </label>
          <input type="search" id="db_search" placeholder="Search Day Book narration, voucher or party..." style="flex:1;min-width:220px;padding:4px 8px">
          <button class="btn sm pri" id="btnLoadDaybook">Fetch Day Book</button>
          <button class="btn sm ghost" id="btnPrintDaybook" style="border:1px solid #cbd5e1">🖨️ Print Day Book</button>
        </div>
      </div>
      <div id="daybookResults"></div>
    `;

    let currentDayVouchers = [];

    const loadDaybook = async () => {
      const d = $('#db_date').value;
      const q = ($('#db_search').value || '').trim().toLowerCase();
      const resEl = $('#daybookResults');
      resEl.innerHTML = `<div class="mute" style="padding:20px;text-align:center">Loading day book for ${d}...</div>`;
      try {
        const vouchers = await apiGet(`/api/reports/daybook?from=${d}`);
        currentDayVouchers = vouchers;

        const filtered = vouchers.filter(v => {
          if (!q) return true;
          const text = [v.voucherNo, v.partyName, v.narration, v.voucherType].filter(Boolean).join(' ').toLowerCase();
          return text.includes(q);
        });

        if (!filtered.length) {
          resEl.innerHTML = `<div class="card mute" style="padding:20px;text-align:center">${vouchers.length ? 'No vouchers match search.' : `No vouchers recorded on ${fmtDate(d)}.`}</div>`;
          return;
        }

        const totalDayAmount = filtered.reduce((sum, v) => sum + (Number(v.totalAmount) || 0), 0);

        resEl.innerHTML = `
          <div class="card" style="padding:6px 10px">
            <div class="scx">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Voucher No</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Party / Narration</th>
                    <th class="r">Total Amount</th>
                    <th class="r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(v => `
                    <tr>
                      <td><b>${esc(v.voucherNo)}</b></td>
                      <td><span class="bd" style="background:#f1f5f9;font-weight:700">${esc(v.voucherType.toUpperCase())}</span></td>
                      <td>${fmtDate(v.date)}</td>
                      <td>
                        <b>${esc(v.partyName || '')}</b>
                        <div class="mute sm">${esc(v.narration || '-')}</div>
                      </td>
                      <td class="r" style="font-weight:700">${rs(v.totalAmount)}</td>
                      <td class="r nowrap">
                        <button class="btn sm ghost btnDbView" data-vid="${v.id}" title="View Preview">👁 View</button>
                        <button class="btn sm ghost btnDbDl" data-vid="${v.id}" title="Download">📥</button>
                        <button class="btn sm ghost btnDbMail" data-vid="${v.id}" title="Email">✉</button>
                        <button class="btn sm ghost btnDbWa" data-vid="${v.id}" title="WhatsApp" style="color:#128c7e">📱</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="background:#f8fafc;font-weight:800;border-top:2px solid #0f172a">
                    <td colspan="4" style="text-align:right">DAY TOTAL:</td>
                    <td class="r" style="color:#1e3a8a;font-size:1.02rem">${rs(totalDayAmount)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        `;

        $$('.btnDbView', resEl).forEach(b => {
          b.onclick = () => {
            const v = currentDayVouchers.find(x => x.id === b.dataset.vid);
            if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.previewVoucher(v);
          };
        });

        $$('.btnDbDl', resEl).forEach(b => {
          b.onclick = () => {
            const v = currentDayVouchers.find(x => x.id === b.dataset.vid);
            if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.downloadVchPdfDirect(v);
          };
        });

        $$('.btnDbMail', resEl).forEach(b => {
          b.onclick = () => {
            const v = currentDayVouchers.find(x => x.id === b.dataset.vid);
            if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.openEmailModal(v, true);
          };
        });

        $$('.btnDbWa', resEl).forEach(b => {
          b.onclick = () => {
            const v = currentDayVouchers.find(x => x.id === b.dataset.vid);
            if (v && window.QuoteDeskPrint) window.QuoteDeskPrint.openWhatsAppShare(v, true);
          };
        });
      } catch (e) {
        resEl.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
      }
    };

    $('#btnLoadDaybook').onclick = loadDaybook;
    $('#db_search').oninput = loadDaybook;

    $('#btnPrintDaybook').onclick = () => {
      const d = $('#db_date').value;
      if (!currentDayVouchers.length) {
        toast('No vouchers to print for this day.', 'bad');
        return;
      }
      const totalDay = currentDayVouchers.reduce((s, v) => s + (Number(v.totalAmount) || 0), 0);
      const reportHtml = `
        <div style="margin-bottom:12px;font-size:0.85rem"><b>Date:</b> ${fmtDate(d)} &bull; Total Transactions: ${currentDayVouchers.length}</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:14px">
          <thead>
            <tr style="background:#0f172a;color:#ffffff;text-align:left">
              <th style="padding:6px 8px;border:1px solid #0f172a">#</th>
              <th style="padding:6px 8px;border:1px solid #0f172a">Voucher No</th>
              <th style="padding:6px 8px;border:1px solid #0f172a">Type</th>
              <th style="padding:6px 8px;border:1px solid #0f172a">Party / Particulars</th>
              <th style="padding:6px 8px;border:1px solid #0f172a">Narration</th>
              <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${currentDayVouchers.map((v, i) => `
              <tr style="border-bottom:1px solid #e2e8f0;background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${i + 1}</td>
                <td style="padding:6px 8px;border:1px solid #cbd5e1"><b>${esc(v.voucherNo)}</b></td>
                <td style="padding:6px 8px;border:1px solid #cbd5e1">${esc(v.voucherType.toUpperCase())}</td>
                <td style="padding:6px 8px;border:1px solid #cbd5e1">${esc(v.partyName || '-')}</td>
                <td style="padding:6px 8px;border:1px solid #cbd5e1">${esc(v.narration || '-')}</td>
                <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">${rs(v.totalAmount)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#f1f5f9;font-weight:800;border-top:2px solid #0f172a">
              <td colspan="5" style="padding:8px;border:1px solid #cbd5e1;text-align:right">DAY BOOK TOTAL:</td>
              <td style="padding:8px;border:1px solid #cbd5e1;text-align:right;color:#1e3a8a;font-size:1rem">${rs(totalDay)}</td>
            </tr>
          </tfoot>
        </table>
      `;
      window.QuoteDeskPrint.previewReport(`Day Book Register — ${fmtDate(d)}`, reportHtml);
    };

    loadDaybook();
  }

  // 4. Trial Balance Tab
  async function renderTrialBalanceTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Computing trial balance...</div>`;
    try {
      const tb = await apiGet('/api/reports/trialbalance');
      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div>
              <h3 style="margin:0">⚖️ Verified Trial Balance</h3>
              <div class="mute sm">As of Date: ${fmtDate(tb.asOfDate || new Date())} &bull; Double-entry verification</div>
            </div>
            <button class="btn sm" id="btnPrintTbSheet" style="border:1px solid #cbd5e1">🖨️ Print Trial Balance</button>
          </div>

          ${tb.isTallied ? `
            <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px">
              <b style="color:#15803d">✅ Trial Balance Tallied:</b>
              <span class="sm" style="color:#166534">Total Debits strictly equal Total Credits (₹${Number(tb.totalDebit).toLocaleString('en-IN')}). Difference: ₹0.</span>
            </div>
          ` : `
            <div class="card" style="background:#fee2e2;border:1px solid #fecaca;padding:12px">
              <b style="color:#b91c1c">⚠️ Trial Balance Imbalance:</b>
              <span class="sm" style="color:#991b1b">Debits (₹${tb.totalDebit}) do not match Credits (₹${tb.totalCredit}). Difference: ₹${tb.difference}.</span>
            </div>
          `}

          <div class="card" style="padding:6px 10px">
            <div class="scx">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Particulars (Ledger)</th>
                    <th>Under Group</th>
                    <th class="r">Debit (₹)</th>
                    <th class="r">Credit (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${tb.rows.map(r => `
                    <tr>
                      <td><b>${esc(r.ledgerName)}</b></td>
                      <td>${esc(r.groupName)}</td>
                      <td class="r">${r.debit > 0 ? rs(r.debit) : '—'}</td>
                      <td class="r">${r.credit > 0 ? rs(r.credit) : '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="background:#f8fafc;font-weight:900">
                    <td colspan="2">TOTAL:</td>
                    <td class="r" style="color:#1e3a8a;font-size:1.05rem">${rs(tb.totalDebit)}</td>
                    <td class="r" style="color:#1e3a8a;font-size:1.05rem">${rs(tb.totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      `;

      $('#btnPrintTbSheet').onclick = () => {
        if (!window.QuoteDeskPrint) return;
        const reportHtml = `
          <div style="margin-bottom:12px;font-size:0.85rem"><b>As of Date:</b> ${fmtDate(tb.asOfDate || new Date())} &bull; Status: ${tb.isTallied ? '<b style="color:#15803d">Tallied (₹' + Number(tb.totalDebit).toLocaleString('en-IN') + ')</b>' : '<b style="color:#dc2626">Imbalance</b>'}</div>
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:14px">
            <thead>
              <tr style="background:#0f172a;color:#ffffff;text-align:left">
                <th style="padding:6px 8px;border:1px solid #0f172a">#</th>
                <th style="padding:6px 8px;border:1px solid #0f172a">Particulars (Account Ledger)</th>
                <th style="padding:6px 8px;border:1px solid #0f172a">Group</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Debit (Dr ₹)</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Credit (Cr ₹)</th>
              </tr>
            </thead>
            <tbody>
              ${tb.rows.map((r, i) => `
                <tr style="border-bottom:1px solid #e2e8f0;background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                  <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${i + 1}</td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1"><b>${esc(r.ledgerName)}</b></td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1">${esc(r.groupName)}</td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right">${r.debit > 0 ? rs(r.debit) : '-'}</td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right">${r.credit > 0 ? rs(r.credit) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="background:#f1f5f9;font-weight:900;border-top:2px solid #0f172a">
                <td colspan="3" style="padding:8px;border:1px solid #cbd5e1;text-align:right">TRIAL BALANCE TOTAL:</td>
                <td style="padding:8px;border:1px solid #cbd5e1;text-align:right;color:#1e3a8a;font-size:1rem">${rs(tb.totalDebit)}</td>
                <td style="padding:8px;border:1px solid #cbd5e1;text-align:right;color:#1e3a8a;font-size:1rem">${rs(tb.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        `;
        window.QuoteDeskPrint.previewReport('Trial Balance Statement', reportHtml);
      };
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 5. Profit & Loss Tab
  async function renderPnlTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Computing Profit &amp; Loss...</div>`;
    try {
      const pnl = await apiGet('/api/reports/pnl');
      area.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <h3 style="margin:0">📈 Profit &amp; Loss Statement</h3>
            <div class="mute sm">Income and expenditure accounting statement</div>
          </div>
          <button class="btn sm" id="btnPrintPnlSheet" style="border:1px solid #cbd5e1">🖨️ Print P&amp;L</button>
        </div>

        <div class="grid g2" style="gap:16px">
          <!-- Expenses -->
          <div class="card">
            <h4 style="margin:0 0 10px;color:#dc2626">Expenses (Direct &amp; Indirect)</h4>
            <table class="tbl sm">
              <thead>
                <tr><th>Particulars</th><th class="r">Amount (₹)</th></tr>
              </thead>
              <tbody>
                ${pnl.expenses.map(e => `
                  <tr>
                    <td>${esc(e.ledgerName)}</td>
                    <td class="r">${rs(e.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="font-weight:700">
                  <td>Total Expenses</td>
                  <td class="r">${rs(pnl.totalExpense)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Income -->
          <div class="card">
            <h4 style="margin:0 0 10px;color:#15803d">Income (Sales &amp; Services)</h4>
            <table class="tbl sm">
              <thead>
                <tr><th>Particulars</th><th class="r">Amount (₹)</th></tr>
              </thead>
              <tbody>
                ${pnl.income.map(i => `
                  <tr>
                    <td>${esc(i.ledgerName)}</td>
                    <td class="r">${rs(i.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="font-weight:700">
                  <td>Total Income</td>
                  <td class="r">${rs(pnl.totalIncome)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="card" style="margin-top:14px;background:#f0fdf4;border:1px solid #bbf7d0;padding:16px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700;font-size:1.1rem;color:#166534">NET PROFIT / (LOSS):</span>
          <span style="font-weight:900;font-size:1.4rem;color:${pnl.isProfit ? '#15803d' : '#b91c1c'}">
            ${rs(pnl.netProfit)}
          </span>
        </div>
      `;

      $('#btnPrintPnlSheet').onclick = () => {
        if (!window.QuoteDeskPrint) return;
        const reportHtml = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px">
              <b style="color:#dc2626">Expenses:</b>
              <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:6px">
                ${pnl.expenses.map(e => `<tr><td style="padding:4px 0">${esc(e.ledgerName)}</td><td style="text-align:right;font-weight:600">${rs(e.amount)}</td></tr>`).join('')}
                <tr style="border-top:1px solid #cbd5e1;font-weight:700"><td>Total Expenses:</td><td style="text-align:right">${rs(pnl.totalExpense)}</td></tr>
              </table>
            </div>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px">
              <b style="color:#15803d">Income:</b>
              <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:6px">
                ${pnl.income.map(i => `<tr><td style="padding:4px 0">${esc(i.ledgerName)}</td><td style="text-align:right;font-weight:600">${rs(i.amount)}</td></tr>`).join('')}
                <tr style="border-top:1px solid #cbd5e1;font-weight:700"><td>Total Income:</td><td style="text-align:right">${rs(pnl.totalIncome)}</td></tr>
              </table>
            </div>
          </div>
          <div style="background:#f8fafc;border:2px solid #0f172a;border-radius:6px;padding:12px;display:flex;justify-content:space-between;align-items:center">
            <b>NET PROFIT / (LOSS):</b>
            <span style="font-size:1.2rem;font-weight:900;color:${pnl.isProfit ? '#15803d' : '#b91c1c'}">${rs(pnl.netProfit)}</span>
          </div>
        `;
        window.QuoteDeskPrint.previewReport('Profit & Loss Statement', reportHtml);
      };
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 6. Balance Sheet Tab
  async function renderBalanceSheetTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Computing Balance Sheet...</div>`;
    try {
      const bs = await apiGet('/api/reports/balancesheet');
      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div>
              <h3 style="margin:0">🏦 Balance Sheet</h3>
              <div class="mute sm">Statement of Financial Position</div>
            </div>
            <button class="btn sm" id="btnPrintBsSheet" style="border:1px solid #cbd5e1">🖨️ Print Balance Sheet</button>
          </div>

          ${bs.isBalanced ? `
            <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px">
              <b style="color:#15803d">✅ Balance Sheet Balanced:</b>
              <span class="sm" style="color:#166534">Total Assets strictly equal Total Liabilities &amp; Equity (₹${Number(bs.totalAssets).toLocaleString('en-IN')}).</span>
            </div>
          ` : `
            <div class="card" style="background:#fee2e2;border:1px solid #fecaca;padding:12px">
              <b style="color:#b91c1c">⚠️ Balance Sheet Imbalance:</b>
              <span class="sm" style="color:#991b1b">Assets (₹${bs.totalAssets}) do not match Liabilities (₹${bs.totalLiabilities}).</span>
            </div>
          `}

          <div class="grid g2" style="gap:16px">
            <!-- Liabilities -->
            <div class="card">
              <h4 style="margin:0 0 10px;color:#1e3a8a">Liabilities &amp; Capital</h4>
              <table class="tbl sm">
                <thead><tr><th>Particulars</th><th class="r">Amount (₹)</th></tr></thead>
                <tbody>
                  ${bs.liabilities.map(l => `
                    <tr><td>${esc(l.ledgerName)}</td><td class="r">${rs(l.amount)}</td></tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="font-weight:900;background:#f8fafc">
                    <td>TOTAL LIABILITIES:</td>
                    <td class="r" style="font-size:1.05rem;color:#1e3a8a">${rs(bs.totalLiabilities)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <!-- Assets -->
            <div class="card">
              <h4 style="margin:0 0 10px;color:#1e3a8a">Assets (Fixed &amp; Current)</h4>
              <table class="tbl sm">
                <thead><tr><th>Particulars</th><th class="r">Amount (₹)</th></tr></thead>
                <tbody>
                  ${bs.assets.map(a => `
                    <tr><td>${esc(a.ledgerName)}</td><td class="r">${rs(a.amount)}</td></tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="font-weight:900;background:#f8fafc">
                    <td>TOTAL ASSETS:</td>
                    <td class="r" style="font-size:1.05rem;color:#1e3a8a">${rs(bs.totalAssets)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      `;

      $('#btnPrintBsSheet').onclick = () => {
        if (!window.QuoteDeskPrint) return;
        const reportHtml = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px">
              <b style="color:#1e3a8a">Liabilities &amp; Capital:</b>
              <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:6px">
                ${bs.liabilities.map(l => `<tr><td style="padding:4px 0">${esc(l.ledgerName)}</td><td style="text-align:right;font-weight:600">${rs(l.amount)}</td></tr>`).join('')}
                <tr style="border-top:1px solid #cbd5e1;font-weight:800"><td>Total Liabilities:</td><td style="text-align:right">${rs(bs.totalLiabilities)}</td></tr>
              </table>
            </div>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px">
              <b style="color:#1e3a8a">Assets:</b>
              <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:6px">
                ${bs.assets.map(a => `<tr><td style="padding:4px 0">${esc(a.ledgerName)}</td><td style="text-align:right;font-weight:600">${rs(a.amount)}</td></tr>`).join('')}
                <tr style="border-top:1px solid #cbd5e1;font-weight:800"><td>Total Assets:</td><td style="text-align:right">${rs(bs.totalAssets)}</td></tr>
              </table>
            </div>
          </div>
        `;
        window.QuoteDeskPrint.previewReport('Balance Sheet Statement', reportHtml);
      };
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 7. GST Working Sheet Tab
  async function renderGstTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Calculating GST Outward &amp; Inward ITC working sheet...</div>`;
    try {
      const gst = await apiGet('/api/reports/gst');
      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <div>
              <h3 style="margin:0">📑 GST Working Sheet</h3>
              <div class="mute sm">GSTR-1 Outward Supplies &amp; GSTR-3B Input Tax Credit (ITC)</div>
            </div>
            <button class="btn sm" id="btnPrintGstSheet" style="border:1px solid #cbd5e1">🖨️ Print GST Sheet</button>
          </div>

          <!-- GSTR-1 Outward Supplies -->
          <div class="card">
            <h4 style="margin:0 0 10px;color:#1e3a8a">GSTR-1: Outward Taxable Supplies (Sales)</h4>
            <table class="tbl sm">
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="r">Taxable Turnover (₹)</th>
                  <th class="r">CGST (₹)</th>
                  <th class="r">SGST (₹)</th>
                  <th class="r">IGST (₹)</th>
                  <th class="r">Total Tax (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Total Taxable Sales &amp; Services</b></td>
                  <td class="r" style="font-weight:700">${rs(gst.gstr1.taxableSupplies)}</td>
                  <td class="r">${rs(gst.gstr1.cgst)}</td>
                  <td class="r">${rs(gst.gstr1.sgst)}</td>
                  <td class="r">${rs(gst.gstr1.igst)}</td>
                  <td class="r" style="font-weight:800;color:#15803d">${rs(gst.gstr1.totalTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- GSTR-3B ITC Summary -->
          <div class="card">
            <h4 style="margin:0 0 10px;color:#1e3a8a">GSTR-3B: Eligible Input Tax Credit (Purchases)</h4>
            <table class="tbl sm">
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="r">Inward Taxable (₹)</th>
                  <th class="r">Input CGST (₹)</th>
                  <th class="r">Input SGST (₹)</th>
                  <th class="r">Input IGST (₹)</th>
                  <th class="r">Total ITC (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Total Eligible ITC on Purchases</b></td>
                  <td class="r" style="font-weight:700">${rs(gst.gstr3b.eligibleItc.taxableSupplies)}</td>
                  <td class="r">${rs(gst.gstr3b.eligibleItc.cgst)}</td>
                  <td class="r">${rs(gst.gstr3b.eligibleItc.sgst)}</td>
                  <td class="r">${rs(gst.gstr3b.eligibleItc.igst)}</td>
                  <td class="r" style="font-weight:800;color:#0284c7">${rs(gst.gstr3b.eligibleItc.totalTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Net GST Payable -->
          <div class="card" style="background:#f8fafc;border:2px solid #0f172a;padding:16px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:1.1rem;font-weight:800;color:#0f172a">NET GST PAYABLE (CASH / ELECTRONIC LEDGER):</div>
              <div class="mute sm">Output Tax (${rs(gst.gstr1.totalTax)}) less Eligible ITC (${rs(gst.gstr3b.eligibleItc.totalTax)})</div>
            </div>
            <div style="font-size:1.5rem;font-weight:900;color:#1e3a8a">
              ${rs(gst.netGstPayable.total)}
            </div>
          </div>
        </div>
      `;

      $('#btnPrintGstSheet').onclick = () => {
        if (!window.QuoteDeskPrint) return;
        const reportHtml = `
          <div style="border:1px solid #cbd5e1;border-radius:6px;padding:10px;margin-bottom:12px">
            <b>1. GSTR-1 Outward Supplies (Tax on Sales):</b>
            <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:6px">
              <tr style="border-bottom:1px solid #cbd5e1"><th style="text-align:left">Taxable Turnover</th><th style="text-align:right">CGST</th><th style="text-align:right">SGST</th><th style="text-align:right">IGST</th><th style="text-align:right">Total Output Tax</th></tr>
              <tr><td>${rs(gst.gstr1.taxableSupplies)}</td><td style="text-align:right">${rs(gst.gstr1.cgst)}</td><td style="text-align:right">${rs(gst.gstr1.sgst)}</td><td style="text-align:right">${rs(gst.gstr1.igst)}</td><td style="text-align:right;font-weight:700">${rs(gst.gstr1.totalTax)}</td></tr>
            </table>
          </div>
          <div style="border:1px solid #cbd5e1;border-radius:6px;padding:10px;margin-bottom:12px">
            <b>2. GSTR-3B Input Tax Credit (ITC on Purchases):</b>
            <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:6px">
              <tr style="border-bottom:1px solid #cbd5e1"><th style="text-align:left">Inward Taxable</th><th style="text-align:right">Input CGST</th><th style="text-align:right">Input SGST</th><th style="text-align:right">Input IGST</th><th style="text-align:right">Total ITC</th></tr>
              <tr><td>${rs(gst.gstr3b.eligibleItc.taxableSupplies)}</td><td style="text-align:right">${rs(gst.gstr3b.eligibleItc.cgst)}</td><td style="text-align:right">${rs(gst.gstr3b.eligibleItc.sgst)}</td><td style="text-align:right">${rs(gst.gstr3b.eligibleItc.igst)}</td><td style="text-align:right;font-weight:700">${rs(gst.gstr3b.eligibleItc.totalTax)}</td></tr>
            </table>
          </div>
          <div style="background:#f8fafc;border:2px solid #0f172a;border-radius:6px;padding:12px;display:flex;justify-content:space-between;align-items:center">
            <b>NET GST PAYABLE IN CASH:</b>
            <span style="font-size:1.25rem;font-weight:900;color:#1e3a8a">${rs(gst.netGstPayable.total)}</span>
          </div>
        `;
        window.QuoteDeskPrint.previewReport('GST Statutory Working Sheet', reportHtml);
      };
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 8. Tally & Zoho Integration & Exports Tab
  async function renderExportsTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading export settings...</div>`;

    try {
      const sett = await apiGet('/api/settings/accounting-integration');
      const mode = sett.integrationMode || 'native';

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <!-- Integration Choice Settings -->
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 6px">⚙️ Accounting Integration Mode</h4>
            <div class="mute sm" style="margin-bottom:12px">Choose whether to maintain accounts solely in MR_Quoter or enable automatic export packages for your CA / accountant:</div>

            <div style="display:flex;flex-direction:column;gap:8px" id="exp_mode_group">
              <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">
                <input type="radio" name="aimode" value="native" ${mode === 'native' ? 'checked' : ''}>
                <div><b>Native in-app only (Default)</b> <span class="mute sm">— Use MR_Quoter's built-in double-entry accounting and reports.</span></div>
              </label>
              <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">
                <input type="radio" name="aimode" value="tally" ${mode === 'tally' ? 'checked' : ''}>
                <div><b>Export to Tally Prime</b> <span class="mute sm">— Generate Tally-importable XML for masters and vouchers.</span></div>
              </label>
              <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">
                <input type="radio" name="aimode" value="zoho" ${mode === 'zoho' ? 'checked' : ''}>
                <div><b>Export to Zoho Books</b> <span class="mute sm">— Generate Zoho Books standard CSV import files.</span></div>
              </label>
              <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">
                <input type="radio" name="aimode" value="both" ${mode === 'both' ? 'checked' : ''}>
                <div><b>Both (Native + Tally + Zoho)</b> <span class="mute sm">— Full multi-platform flexibility.</span></div>
              </label>
            </div>
            <div style="margin-top:12px;text-align:right">
              <button class="btn pri sm" id="btnSaveAiMode">💾 Save Integration Preference</button>
            </div>
          </div>

          <!-- Tally Prime XML Section -->
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 6px;color:#0284c7">📥 Tally Prime XML Import Export</h4>
            <p class="mute sm">Generates an official XML envelope containing your chart of accounts, party GST particulars, and all balanced double-entry vouchers (Sales, Purchases, Receipts, Payments, Journals) ready for direct import into Tally Prime without manual re-entry.</p>
            <div style="margin-top:10px">
              <button class="btn sm pri" id="btnExportTallyXml" style="background:#0284c7;border-color:#0284c7">
                📄 Download Official Tally Prime XML
              </button>
            </div>
          </div>

          <!-- Zoho Books CSV Section -->
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 6px;color:#15803d">📥 Zoho Books Standard CSV Exports</h4>
            <p class="mute sm">Formatted specifically according to Zoho Books import templates for rapid bulk upload:</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
              <button class="btn sm" id="btnZohoInvoices" style="background:#f0fdf4;color:#15803d;border-color:#bbf7d0">
                📊 Download Invoices CSV
              </button>
              <button class="btn sm" id="btnZohoCustomers" style="background:#f0fdf4;color:#15803d;border-color:#bbf7d0">
                👥 Download Customers CSV
              </button>
              <button class="btn sm" id="btnZohoCoa" style="background:#f0fdf4;color:#15803d;border-color:#bbf7d0">
                📒 Download Chart of Accounts CSV
              </button>
            </div>
          </div>
        </div>
      `;

      $('#btnSaveAiMode').onclick = async () => {
        const val = $('input[name="aimode"]:checked').value;
        try {
          await apiPost('/api/settings/accounting-integration', { integrationMode: val });
          toast('✅ Accounting integration preference saved.');
        } catch (e) {
          toast(e.message, 'bad');
        }
      };

      $('#btnExportTallyXml').onclick = () => {
        window.open('/api/exports/tally/xml', '_blank');
      };

      $('#btnZohoInvoices').onclick = () => {
        window.open('/api/exports/zoho/csv?type=invoices', '_blank');
      };

      $('#btnZohoCustomers').onclick = () => {
        window.open('/api/exports/zoho/csv?type=customers', '_blank');
      };

      $('#btnZohoCoa').onclick = () => {
        window.open('/api/exports/zoho/csv?type=chart_of_accounts', '_blank');
      };
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 17. Stock Summary Statement & Valuation Tab (M4)
  async function renderStockSummaryTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading real-time Stock Summary Statement...</div>`;
    try {
      const summary = await apiGet('/api/inventory/summary');
      const alerts = await apiGet('/api/inventory/reorder-alerts');

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <!-- Summary Header & KPIs -->
          <div class="card" style="padding:16px;background:linear-gradient(135deg,#064e3b,#065f46);color:#fff">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <h3 style="margin:0 0 4px;color:#fff">📦 Tally Stock Summary Statement</h3>
                <div class="mute sm" style="color:#a7f3d0">
                  Real-time double-entry inventory ledger with FIFO valuation, inward/outward movement tracking, and reorder alerts.
                </div>
              </div>
              <div style="text-align:right">
                <div class="mute sm" style="color:#a7f3d0">Total Inventory Valuation</div>
                <div style="font-size:1.6rem;font-weight:700;color:#fff">${rs(summary.totalStockValue)}</div>
              </div>
            </div>
          </div>

          ${alerts.length > 0 ? `
            <div class="note bad" style="margin:0">
              <b>⚠️ Reorder Level Warning:</b> ${alerts.length} material(s) have fallen below minimum safety stock levels:
              <b>${alerts.map(a => esc(a.stockItemName) + ' (' + a.closingQty + ' left)').join(', ')}</b>. Initiate Purchase Orders.
            </div>
          ` : ''}

          <!-- Stock Summary Table -->
          <div class="card" style="padding:16px">
            <div style="overflow-x:auto">
              <table class="tbl sm" style="width:100%">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>HSN</th>
                    <th>Unit</th>
                    <th style="text-align:right">Opening</th>
                    <th style="text-align:right">Inward</th>
                    <th style="text-align:right">Outward</th>
                    <th style="text-align:right">Closing Stock</th>
                    <th style="text-align:right">Avg Rate</th>
                    <th style="text-align:right">Closing Valuation</th>
                    <th style="text-align:center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${summary.items.length === 0 ? '<tr><td colspan="10" class="mute" style="text-align:center;padding:16px">No inventory items found. Add items in Tally Masters tab.</td></tr>' :
                    summary.items.map(s => `
                      <tr>
                        <td><b>${esc(s.stockItemName)}</b></td>
                        <td><code>${esc(s.hsnCode || '-')}</code></td>
                        <td><span class="bd">${esc(s.unitName || 'Nos')}</span></td>
                        <td style="text-align:right">${s.openingQty || 0}</td>
                        <td style="text-align:right;color:#15803d">+${s.totalInQty || 0}</td>
                        <td style="text-align:right;color:#b91c1c">-${s.totalOutQty || 0}</td>
                        <td style="text-align:right;font-weight:700">${s.closingQty}</td>
                        <td style="text-align:right">${rs(s.avgRate)}</td>
                        <td style="text-align:right;font-weight:700">${rs(s.closingValue)}</td>
                        <td style="text-align:center">
                          <span class="bd" style="background:${s.isBelowReorder ? '#fee2e2;color:#b91c1c' : '#dcfce7;color:#15803d'}">
                            ${s.isBelowReorder ? 'Below Reorder' : 'Healthy Stock'}
                          </span>
                        </td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 16. Financial Reports Hub Tab (M3)
  async function renderReportsHubTab(area) {
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card" style="padding:16px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff">
          <h3 style="margin:0 0 4px;color:#fff">📊 Comprehensive Tally Financial Reports Hub</h3>
          <div class="mute sm" style="color:#94a3b8">
            Access statutory cash &amp; bank registers, direct cash flows, working capital analysis, and financial ratios.
          </div>
        </div>

        <div class="grid g4" style="gap:12px">
          <div class="card" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <h4 style="margin:0 0 6px">💵 Cash Book</h4>
              <div class="mute sm">Complete chronological ledger of all cash receipts, counter withdrawals, and balances.</div>
            </div>
            <button class="btn sm" id="btnOpenCashBook" style="margin-top:12px">Open Cash Book &rarr;</button>
          </div>

          <div class="card" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <h4 style="margin:0 0 6px">🏦 Bank Book</h4>
              <div class="mute sm">Register of deposits, client RTGS/NEFT inflows, vendor payments, and bank balances.</div>
            </div>
            <button class="btn sm" id="btnOpenBankBook" style="margin-top:12px">Open Bank Book &rarr;</button>
          </div>

          <div class="card" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <h4 style="margin:0 0 6px">📈 Sales Register</h4>
              <div class="mute sm">Chronological tax invoice log with customer names, GST breakdowns, and gross sales.</div>
            </div>
            <button class="btn sm" id="btnOpenSalesRegister" style="margin-top:12px">Open Sales Register &rarr;</button>
          </div>

          <div class="card" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <h4 style="margin:0 0 6px">📉 Purchase Register</h4>
              <div class="mute sm">Inward supplier bills register with vendor GSTINs, ITC inputs, and gross purchases.</div>
            </div>
            <button class="btn sm" id="btnOpenPurchaseRegister" style="margin-top:12px">Open Purchase Register &rarr;</button>
          </div>
        </div>

        <div class="grid g3" style="gap:12px">
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 6px">🌊 Cash Flow Statement</h4>
            <div class="mute sm" style="margin-bottom:12px">Direct method operating, investing, and financing cash movements.</div>
            <button class="btn sm" id="btnOpenCashFlow">Generate Cash Flow &rarr;</button>
          </div>

          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 6px">⚖️ Ratio Analysis</h4>
            <div class="mute sm" style="margin-bottom:12px">Current ratio, quick ratio, debt-to-equity, and profit margins.</div>
            <button class="btn sm" id="btnOpenRatios">Calculate Ratios &rarr;</button>
          </div>

          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 6px">⏳ AR/AP Ageing Analysis</h4>
            <div class="mute sm" style="margin-bottom:12px">Receivables &amp; payables aged into 0-30, 31-60, 61-90, and 90+ day buckets.</div>
            <button class="btn sm" id="btnOpenAgeing">Run Ageing Report &rarr;</button>
          </div>
        </div>

        <div id="subReportDisplayArea" style="margin-top:10px"></div>
      </div>
    `;

    $('#btnOpenCashBook').onclick = async () => {
      const area = $('#subReportDisplayArea');
      area.innerHTML = '<div class="mute sm" style="padding:16px">Loading Cash Book...</div>';
      try {
        const data = await apiGet('/api/reports/cash-book');
        area.innerHTML = `
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 8px">💵 Cash Book Summary</h4>
            <div class="grid g3" style="gap:10px;margin-bottom:12px">
              <div class="bd" style="padding:8px">Total Inflow: <b>${rs(data.totalReceipts)}</b></div>
              <div class="bd" style="padding:8px">Total Outflow: <b>${rs(data.totalPayments)}</b></div>
              <div class="bd" style="padding:8px">Net Cash: <b>${rs(data.netBalance)}</b></div>
            </div>
            <table class="tbl sm" style="width:100%">
              <thead><tr><th>Date</th><th>Voucher No</th><th>Ledger / Narration</th><th style="text-align:right">Receipt (Dr)</th><th style="text-align:right">Payment (Cr)</th></tr></thead>
              <tbody>
                ${data.entries.length === 0 ? '<tr><td colspan="5" class="mute" style="text-align:center">No cash entries found.</td></tr>' :
                  data.entries.map(e => `<tr><td>${fmtDate(e.date)}</td><td><b>${esc(e.voucherNo)}</b></td><td>${esc(e.narration || e.ledgerName)}</td><td style="text-align:right">${rs(e.debit)}</td><td style="text-align:right">${rs(e.credit)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
      } catch (e) { area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    };

    $('#btnOpenBankBook').onclick = async () => {
      const area = $('#subReportDisplayArea');
      area.innerHTML = '<div class="mute sm" style="padding:16px">Loading Bank Book...</div>';
      try {
        const data = await apiGet('/api/reports/bank-book');
        area.innerHTML = `
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 8px">🏦 Bank Book Summary</h4>
            <div class="grid g3" style="gap:10px;margin-bottom:12px">
              <div class="bd" style="padding:8px">Total Deposits: <b>${rs(data.totalDeposits)}</b></div>
              <div class="bd" style="padding:8px">Total Withdrawals: <b>${rs(data.totalWithdrawals)}</b></div>
              <div class="bd" style="padding:8px">Net Bank Balance: <b>${rs(data.netBalance)}</b></div>
            </div>
            <table class="tbl sm" style="width:100%">
              <thead><tr><th>Date</th><th>Voucher No</th><th>Ledger / Party</th><th style="text-align:right">Deposit (Dr)</th><th style="text-align:right">Withdrawal (Cr)</th></tr></thead>
              <tbody>
                ${data.entries.length === 0 ? '<tr><td colspan="5" class="mute" style="text-align:center">No bank transactions found.</td></tr>' :
                  data.entries.map(e => `<tr><td>${fmtDate(e.date)}</td><td><b>${esc(e.voucherNo)}</b></td><td>${esc(e.partyName || e.ledgerName)}</td><td style="text-align:right">${rs(e.debit)}</td><td style="text-align:right">${rs(e.credit)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
      } catch (e) { area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    };

    $('#btnOpenRatios').onclick = async () => {
      const area = $('#subReportDisplayArea');
      area.innerHTML = '<div class="mute sm" style="padding:16px">Calculating financial ratios...</div>';
      try {
        const r = await apiGet('/api/reports/ratio-analysis');
        area.innerHTML = `
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 12px">⚖️ Financial Ratio Analysis</h4>
            <div class="grid g3" style="gap:12px">
              <div class="card" style="padding:12px;text-align:center;background:#f8fafc"><div class="mute sm">Current Ratio</div><div style="font-size:1.5rem;font-weight:700">${r.currentRatio}</div></div>
              <div class="card" style="padding:12px;text-align:center;background:#f8fafc"><div class="mute sm">Quick Ratio</div><div style="font-size:1.5rem;font-weight:700">${r.quickRatio}</div></div>
              <div class="card" style="padding:12px;text-align:center;background:#f8fafc"><div class="mute sm">Gross Profit %</div><div style="font-size:1.5rem;font-weight:700">${r.gpMargin}%</div></div>
              <div class="card" style="padding:12px;text-align:center;background:#f8fafc"><div class="mute sm">Net Profit %</div><div style="font-size:1.5rem;font-weight:700">${r.npMargin}%</div></div>
              <div class="card" style="padding:12px;text-align:center;background:#f8fafc"><div class="mute sm">Return on Assets</div><div style="font-size:1.5rem;font-weight:700">${r.roa}%</div></div>
              <div class="card" style="padding:12px;text-align:center;background:#f8fafc"><div class="mute sm">Debt to Assets</div><div style="font-size:1.5rem;font-weight:700">${r.debtToAssets}</div></div>
            </div>
          </div>
        `;
      } catch (e) { area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    };

    $('#btnOpenAgeing').onclick = async () => {
      const area = $('#subReportDisplayArea');
      area.innerHTML = '<div class="mute sm" style="padding:16px">Generating Ageing analysis...</div>';
      try {
        const ag = await apiGet('/api/reports/ageing');
        area.innerHTML = `
          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 8px">⏳ AR / AP Ageing Analysis Buckets</h4>
            <div class="grid g4" style="gap:10px;margin-bottom:12px">
              <div class="bd" style="padding:8px">0-30 Days: <b>${rs(ag.buckets.b0_30.total)}</b></div>
              <div class="bd" style="padding:8px">31-60 Days: <b>${rs(ag.buckets.b31_60.total)}</b></div>
              <div class="bd" style="padding:8px">61-90 Days: <b>${rs(ag.buckets.b61_90.total)}</b></div>
              <div class="bd" style="padding:8px;background:#fee2e2;color:#b91c1c">90+ Days: <b>${rs(ag.buckets.b90_plus.total)}</b></div>
            </div>
          </div>
        `;
      } catch (e) { area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    };

    $('#btnOpenSalesRegister').onclick = () => window.open('/api/reports/sales-register', '_blank');
    $('#btnOpenPurchaseRegister').onclick = () => window.open('/api/reports/purchase-register', '_blank');
    $('#btnOpenCashFlow').onclick = () => window.open('/api/reports/cash-flow', '_blank');
  }

  // 14. Bill-by-Bill Allocation & AR/AP Outstanding Tab (M2)
  async function renderOutstandingTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading Outstanding Receivables &amp; Payables...</div>`;
    try {
      const summary = await apiGet('/api/outstanding/summary');
      const totalPending = summary.reduce((acc, s) => acc + (s.netPending || 0), 0);

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card" style="padding:16px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #cbd5e1">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <h3 style="margin:0 0 4px">💰 Bill-by-Bill Allocation &amp; Outstanding (AR / AP)</h3>
                <div class="mute sm">Tally-style Agst Ref settlement tracking against tax invoices and purchase bills.</div>
              </div>
              <div style="text-align:right">
                <div class="mute sm">Total Net Outstanding</div>
                <div style="font-size:1.4rem;font-weight:700;color:${totalPending >= 0 ? '#0f172a' : '#b91c1c'}">${rs(totalPending)}</div>
              </div>
            </div>
          </div>

          <div class="card" style="padding:16px">
            <div style="overflow-x:auto">
              <table class="tbl sm" style="width:100%">
                <thead>
                  <tr>
                    <th>Party Name</th>
                    <th style="text-align:right">Total Invoiced</th>
                    <th style="text-align:right">Total Settled (Agst Ref)</th>
                    <th style="text-align:right">Pending Outstanding</th>
                    <th style="text-align:center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${summary.length === 0 ? '<tr><td colspan="5" class="mute" style="text-align:center;padding:16px">No open bills or allocations recorded yet.</td></tr>' :
                    summary.map(s => `
                      <tr>
                        <td><b>${esc(s.partyName || s.partyId)}</b></td>
                        <td style="text-align:right">${rs(s.totalInvoiced)}</td>
                        <td style="text-align:right;color:#15803d">${rs(s.totalSettled)}</td>
                        <td style="text-align:right;font-weight:700;color:${s.netPending > 0 ? '#b91c1c' : '#0f172a'}">${rs(s.netPending)}</td>
                        <td style="text-align:center">
                          <span class="bd" style="background:${s.netPending <= 0 ? '#dcfce7;color:#15803d' : '#fee2e2;color:#b91c1c'}">
                            ${s.netPending <= 0 ? 'Fully Cleared' : 'Open Balance'}
                          </span>
                        </td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 15. Year-End Financial Closing Tab (M2)
  async function renderYearEndTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading Year-End Audit Logs...</div>`;
    try {
      const history = await apiGet('/api/year-end/history');

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card" style="padding:16px;background:#fef2f2;border:1px solid #fecaca">
            <h4 style="margin:0 0 6px;color:#991b1b">🔒 Financial Year Closing &amp; Retained Earnings Transfer</h4>
            <div class="mute sm" style="color:#7f1d1d;margin-bottom:12px">
              Closing a Financial Year will calculate Net Profit/Loss, transfer nominal balances into Capital / Retained Earnings, reset revenue/expense ledgers, and carry forward Balance Sheet accounts.
            </div>

            <div class="grid g3" style="gap:10px;margin-bottom:12px">
              <div class="fld">
                <label>Closing FY Start Date</label>
                <input type="date" id="ye_from" value="2025-04-01">
              </div>
              <div class="fld">
                <label>Closing FY End Date (Books Locked)</label>
                <input type="date" id="ye_to" value="2026-03-31">
              </div>
              <div class="fld">
                <label>Next FY Start Date</label>
                <input type="date" id="ye_next" value="2026-04-01">
              </div>
            </div>

            <button class="btn sm" id="btnRunYearEnd" style="background:#b91c1c;color:#fff;border-color:#991b1b">
              ⚡ Execute Statutory Year-End Close
            </button>
            <div id="yeResultArea" style="margin-top:10px;display:none"></div>
          </div>

          <div class="card" style="padding:16px">
            <h4 style="margin:0 0 10px">📜 Audit Log of Closed Financial Years</h4>
            <div style="overflow-x:auto">
              <table class="tbl sm" style="width:100%">
                <thead>
                  <tr>
                    <th>Closed FY Ending</th>
                    <th>Closed Date &amp; Time</th>
                    <th>Closed By</th>
                    <th style="text-align:right">Total Revenue</th>
                    <th style="text-align:right">Total Expenses</th>
                    <th style="text-align:right">Net Profit / (Loss)</th>
                    <th style="text-align:right">Ledgers Carried</th>
                  </tr>
                </thead>
                <tbody>
                  ${history.length === 0 ? '<tr><td colspan="7" class="mute" style="text-align:center;padding:16px">No prior years closed yet.</td></tr>' :
                    history.map(h => `
                      <tr>
                        <td><b>${fmtDate(h.toDate)}</b></td>
                        <td>${new Date(h.closedAt).toLocaleString()}</td>
                        <td>${esc(h.closedBy || 'Admin')}</td>
                        <td style="text-align:right;color:#15803d">${rs(h.totalIncome)}</td>
                        <td style="text-align:right;color:#b91c1c">${rs(h.totalExpense)}</td>
                        <td style="text-align:right;font-weight:700">${rs(h.netProfit)}</td>
                        <td style="text-align:right">${h.carryForwardCount}</td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      $('#btnRunYearEnd').onclick = async () => {
        const toDate = $('#ye_to').value;
        const fromDate = $('#ye_from').value;
        const nextFyStart = $('#ye_next').value;
        if (!toDate) { toast('Closing date is required', 'bad'); return; }

        if (!confirm(`Are you sure you want to permanently lock and close Financial Year ending ${toDate}? This will transfer Net Profit to Capital.`)) {
          return;
        }

        const resBox = $('#yeResultArea');
        resBox.style.display = 'block';
        resBox.innerHTML = '<div class="mute sm">Calculating Net Profit and transferring Retained Earnings...</div>';

        try {
          const res = await apiPost('/api/year-end/close', { fromDate, toDate, nextFyStart });
          resBox.innerHTML = `
            <div class="note ok" style="margin:0">
              <b>✅ FY Closed Successfully:</b> Net Profit of <b>${rs(res.netProfit)}</b> transferred to Capital. ${res.carryForwardCount} Balance Sheet accounts carried forward to new FY!
            </div>
          `;
          renderYearEndTab(area);
        } catch (e) {
          resBox.innerHTML = `<div class="note bad" style="margin:0">${esc(e.message)}</div>`;
        }
      };

    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  // 13. Tally Masters Hub Tab (M1 Masters)
  async function renderMastersTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Loading Tally Masters...</div>`;
    try {
      const [stockItems, stockGroups, units, godowns, priceLists, costCentres] = await Promise.all([
        apiGet('/api/stock-items'),
        apiGet('/api/stock-groups'),
        apiGet('/api/units'),
        apiGet('/api/godowns'),
        apiGet('/api/price-lists'),
        apiGet('/api/cost-centres')
      ]);

      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px">
          <!-- Quick Master Sub-Header & Stats -->
          <div class="grid g4" style="gap:10px">
            <div class="card" style="padding:12px;text-align:center;background:#f8fafc">
              <div class="mute sm">📦 Stock Items</div>
              <div style="font-size:1.4rem;font-weight:700;color:#0f172a">${stockItems.length}</div>
            </div>
            <div class="card" style="padding:12px;text-align:center;background:#f8fafc">
              <div class="mute sm">🗂️ Stock Groups</div>
              <div style="font-size:1.4rem;font-weight:700;color:#0f172a">${stockGroups.length}</div>
            </div>
            <div class="card" style="padding:12px;text-align:center;background:#f8fafc">
              <div class="mute sm">📏 Units of Measure</div>
              <div style="font-size:1.4rem;font-weight:700;color:#0f172a">${units.length}</div>
            </div>
            <div class="card" style="padding:12px;text-align:center;background:#f8fafc">
              <div class="mute sm">🏢 Godowns / Hubs</div>
              <div style="font-size:1.4rem;font-weight:700;color:#0f172a">${godowns.length}</div>
            </div>
          </div>

          <!-- Section: Stock Items -->
          <div class="card" style="padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <h4 style="margin:0 0 4px">📦 Inventory Stock Items</h4>
                <div class="mute sm">Track physical materials, profiles, hardware, HSN/SAC, opening stock, and reorder levels.</div>
              </div>
              <button class="btn pri sm" id="btnNewStockItem">+ New Stock Item</button>
            </div>

            <div style="overflow-x:auto">
              <table class="tbl sm" style="width:100%">
                <thead>
                  <tr>
                    <th>Item Name</th>
                    <th>Group</th>
                    <th>HSN</th>
                    <th>Unit</th>
                    <th>GST %</th>
                    <th style="text-align:right">Opening Qty</th>
                    <th style="text-align:right">Opening Value</th>
                    <th style="text-align:right">Reorder Lvl</th>
                  </tr>
                </thead>
                <tbody>
                  ${stockItems.length === 0 ? '<tr><td colspan="8" class="mute" style="text-align:center;padding:16px">No stock items created yet. Click "+ New Stock Item" to add one.</td></tr>' :
                    stockItems.map(it => `
                      <tr>
                        <td><b>${esc(it.name)}</b> ${it.alias ? `<span class="mute sm">(${esc(it.alias)})</span>` : ''}</td>
                        <td>${esc(it.stockGroupId || 'Primary')}</td>
                        <td><code>${esc(it.hsnCode || '-')}</code></td>
                        <td><span class="bd">${esc(it.unitName || 'Nos')}</span></td>
                        <td>${it.taxRate ? it.taxRate + '%' : '0%'}</td>
                        <td style="text-align:right">${it.openingQty || 0}</td>
                        <td style="text-align:right">${rs((it.openingValuePaise || 0) / 100)}</td>
                        <td style="text-align:right">${it.reorderLevel || '-'}</td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Two Column Grid: Stock Groups & Units -->
          <div class="grid g2" style="gap:16px">
            <!-- Stock Groups -->
            <div class="card" style="padding:16px">
              <h4 style="margin:0 0 10px">🗂️ Stock Groups</h4>
              <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px">
                ${stockGroups.map(g => `
                  <li style="display:flex;justify-content:space-between;padding:6px 10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;font-size:0.85rem">
                    <span><b>${esc(g.name)}</b></span>
                    <span class="mute sm">${g.isDefault ? 'Standard' : 'Custom'}</span>
                  </li>
                `).join('')}
              </ul>
            </div>

            <!-- Units of Measure -->
            <div class="card" style="padding:16px">
              <h4 style="margin:0 0 10px">📏 Units of Measure</h4>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${units.map(u => `
                  <span class="bd" style="padding:4px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;font-size:0.8rem">
                    <b>${esc(u.symbol)}</b> <span class="mute sm">(${esc(u.name)})</span>
                  </span>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Opening Balances Check & Reconciliation -->
          <div class="card" style="padding:16px;background:#fafafa;border:1px solid #e2e8f0">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <h4 style="margin:0 0 4px">⚖️ Opening Balance Verification</h4>
                <div class="mute sm">Verify that total Opening Debits equal Opening Credits across all ledgers.</div>
              </div>
              <button class="btn sm" id="btnVerifyOB" style="background:#fff;border:1px solid #cbd5e1">Run Balance Audit</button>
            </div>
            <div id="obVerifyResult" style="margin-top:10px;display:none"></div>
          </div>
        </div>
      `;

      // New Stock Item Modal Action
      const btnNewItem = $('#btnNewStockItem');
      if (btnNewItem) {
        btnNewItem.onclick = () => {
          modal({
            title: '✨ Add New Inventory Stock Item',
            html: `
              <div style="display:flex;flex-direction:column;gap:10px;max-width:540px">
                <div class="fld">
                  <label>Item Name *</label>
                  <input type="text" id="si_name" placeholder="e.g. Aluminium Profile 6063 T5 50x25mm" required>
                </div>
                <div class="grid g2" style="gap:10px">
                  <div class="fld">
                    <label>Stock Group</label>
                    <select id="si_group">
                      ${stockGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="fld">
                    <label>Unit of Measure</label>
                    <select id="si_unit">
                      ${units.map(u => `<option value="${u.symbol}">${esc(u.symbol)} - ${esc(u.name)}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div class="grid g2" style="gap:10px">
                  <div class="fld">
                    <label>HSN / SAC Code</label>
                    <input type="text" id="si_hsn" placeholder="e.g. 7604">
                  </div>
                  <div class="fld">
                    <label>GST Rate %</label>
                    <select id="si_tax">
                      <option value="18">18% GST (Standard)</option>
                      <option value="12">12% GST</option>
                      <option value="28">28% GST</option>
                      <option value="5">5% GST</option>
                      <option value="0">0% Exempt</option>
                    </select>
                  </div>
                </div>
                <div class="grid g3" style="gap:10px">
                  <div class="fld">
                    <label>Opening Qty</label>
                    <input type="number" id="si_op_qty" placeholder="0" min="0" step="any">
                  </div>
                  <div class="fld">
                    <label>Opening Rate (₹)</label>
                    <input type="number" id="si_op_rate" placeholder="0.00" min="0" step="any">
                  </div>
                  <div class="fld">
                    <label>Reorder Level</label>
                    <input type="number" id="si_reorder" placeholder="Min stock" min="0">
                  </div>
                </div>
              </div>
            `,
            okText: 'Save Stock Item',
            onOk: async () => {
              const name = ($('#si_name') && $('#si_name').value.trim()) || '';
              if (!name) { toast('Stock item name is required', 'bad'); return false; }
              const payload = {
                name,
                stockGroupId: $('#si_group').value,
                unitName: $('#si_unit').value,
                hsnCode: $('#si_hsn').value.trim(),
                taxRate: parseFloat($('#si_tax').value) || 0,
                openingQty: parseFloat($('#si_op_qty').value) || 0,
                openingRate: parseFloat($('#si_op_rate').value) || 0,
                reorderLevel: parseFloat($('#si_reorder').value) || 0
              };
              try {
                await apiPost('/api/stock-items', payload);
                toast('✅ Stock item saved successfully.');
                renderMastersTab(area);
                return true;
              } catch (e) {
                toast(e.message, 'bad');
                return false;
              }
            }
          });
        };
      }

      // Opening Balance Audit Button
      const btnVerify = $('#btnVerifyOB');
      if (btnVerify) {
        btnVerify.onclick = async () => {
          const resArea = $('#obVerifyResult');
          if (!resArea) return;
          resArea.style.display = 'block';
          resArea.innerHTML = '<div class="mute sm">Verifying opening balances...</div>';
          try {
            const audit = await apiGet('/api/accounts/opening-balances/verify');
            if (audit.balanced) {
              resArea.innerHTML = `
                <div class="note ok" style="margin:0">
                  <b>✅ Verified Balanced:</b> Total Dr (${rs(audit.totalDr)}) === Total Cr (${rs(audit.totalCr)}). Double-entry opening equilibrium confirmed!
                </div>
              `;
            } else {
              resArea.innerHTML = `
                <div class="note bad" style="margin:0">
                  <b>⚠️ Imbalance Detected:</b> Total Dr: ${rs(audit.totalDr)} vs Total Cr: ${rs(audit.totalCr)}. Net Difference: ${rs(audit.difference)}. Adjust opening balances in Ledgers tab.
                </div>
              `;
            }
          } catch (e) {
            resArea.innerHTML = `<div class="note bad" style="margin:0">${esc(e.message)}</div>`;
          }
        };
      }

    } catch (e) {
      area.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: Create New Double-Entry Voucher
   */
  function openNewVoucherModal() {
    const ledgers = cachedAccounts.ledgers || [];

    const initialEntries = [
      { ledgerId: 'led_bank_default', debit: 0, credit: 0 },
      { ledgerId: 'led_cash', debit: 0, credit: 0 }
    ];

    modal({
      title: '➕ Create Balanced Double-Entry Voucher',
      wide: true,
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="grid g3" style="gap:10px">
            <label class="f">
              <span class="sm">Voucher Type</span>
              <select id="vch_type">
                <option value="receipt">Receipt (Money In)</option>
                <option value="payment">Payment (Money Out)</option>
                <option value="journal" selected>Journal (Adjustment)</option>
                <option value="contra">Contra (Cash &harr; Bank)</option>
                <option value="sales">Sales Invoice</option>
                <option value="purchase">Purchase Bill</option>
              </select>
            </label>
            <label class="f">
              <span class="sm">Date</span>
              <input type="date" id="vch_date" value="${new Date().toISOString().slice(0, 10)}">
            </label>
            <label class="f">
              <span class="sm">Reference / Doc No</span>
              <input type="text" id="vch_docRef" placeholder="e.g. UTR / Inv / Bill No">
            </label>
          </div>

          <label class="f">
            <span class="sm">Narration</span>
            <input type="text" id="vch_narration" placeholder="Details of this accounting entry">
          </label>

          <!-- Collapsible Statutory & Transport Details -->
          <details style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;cursor:pointer">
            <summary style="font-size:0.82rem;font-weight:700;color:#0f172a;outline:none">
              📍 Statutory Parties, Project &amp; Transport Details (Optional)
            </summary>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;cursor:default">
              <div class="grid g2" style="gap:10px">
                <!-- Billed To -->
                <div style="background:#ffffff;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0">
                  <div style="font-size:0.72rem;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:6px">Details of Party / Billed To</div>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <input type="text" id="vch_partyName" placeholder="Party / Company Name">
                    <input type="text" id="vch_partyGstin" placeholder="GSTIN (e.g. 33AAAAA0000A1Z5)">
                    <input type="text" id="vch_partyAddress" placeholder="Billing Address">
                  </div>
                </div>

                <!-- Shipped To -->
                <div style="background:#ffffff;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0">
                  <div style="font-size:0.72rem;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:6px">Consignee / Shipped To (Site)</div>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <input type="text" id="vch_shipName" placeholder="Consignee / Site Receiver">
                    <input type="text" id="vch_shipGstin" placeholder="Shipping GSTIN">
                    <input type="text" id="vch_shipAddress" placeholder="Site / Delivery Address">
                  </div>
                </div>
              </div>

              <!-- Project & Transport Logistics -->
              <div style="background:#ffffff;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0">
                <div style="font-size:0.72rem;font-weight:800;color:#475569;text-transform:uppercase;margin-bottom:6px">Project, Order &amp; Transport Logistics</div>
                <div class="grid g4" style="gap:8px">
                  <input type="text" id="vch_project" placeholder="Project Name">
                  <input type="text" id="vch_projectCode" placeholder="Project Code">
                  <input type="text" id="vch_site" placeholder="Site Location">
                  <input type="text" id="vch_poNo" placeholder="Buyer PO No">

                  <input type="date" id="vch_poDate" title="PO Date">
                  <input type="text" id="vch_vehicleNo" placeholder="Vehicle No">
                  <input type="text" id="vch_ewayBillNo" placeholder="E-Way Bill No">
                  <input type="text" id="vch_transporter" placeholder="Transporter / LR">
                </div>
              </div>
            </div>
          </details>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <h4 style="margin:0">Double-Entry Lines (Debits &amp; Credits)</h4>
            <button class="btn sm pri" id="btnAddVchLine">+ Add Entry Line</button>
          </div>

          <div class="scx" style="max-height:220px">
            <table class="tbl sm" id="vchLinesTbl">
              <thead>
                <tr>
                  <th>Particulars (Ledger)</th>
                  <th class="r" style="width:130px">Debit (₹)</th>
                  <th class="r" style="width:130px">Credit (₹)</th>
                  <th class="r" style="width:50px"></th>
                </tr>
              </thead>
              <tbody id="vchLinesTbody"></tbody>
            </table>
          </div>

          <!-- Live Balance Checker -->
          <div class="card" id="vchBalanceCard" style="padding:12px;background:#f8fafc">
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.9rem">
              <div>Total Debits: <b id="vchTotDr" style="color:#1e3a8a">₹0</b></div>
              <div>Total Credits: <b id="vchTotCr" style="color:#1e3a8a">₹0</b></div>
              <div id="vchBalanceStatus" style="font-weight:700"></div>
            </div>
          </div>
        </div>
      `,
      okText: '💾 Post Voucher',
      onOk: async () => {
        const vtype = $('#vch_type').value;
        const vdate = $('#vch_date').value;
        const vnarration = $('#vch_narration').value.trim();
        const vdocRef = $('#vch_docRef').value.trim();

        const partyName = ($('#vch_partyName') && $('#vch_partyName').value.trim()) || '';
        const partyGstin = ($('#vch_partyGstin') && $('#vch_partyGstin').value.trim()) || '';
        const partyAddress = ($('#vch_partyAddress') && $('#vch_partyAddress').value.trim()) || '';
        const shipName = ($('#vch_shipName') && $('#vch_shipName').value.trim()) || partyName;
        const shipGstin = ($('#vch_shipGstin') && $('#vch_shipGstin').value.trim()) || partyGstin;
        const shipAddress = ($('#vch_shipAddress') && $('#vch_shipAddress').value.trim()) || partyAddress;
        const project = ($('#vch_project') && $('#vch_project').value.trim()) || '';
        const projectCode = ($('#vch_projectCode') && $('#vch_projectCode').value.trim()) || '';
        const site = ($('#vch_site') && $('#vch_site').value.trim()) || '';
        const poNo = ($('#vch_poNo') && $('#vch_poNo').value.trim()) || '';
        const poDate = ($('#vch_poDate') && $('#vch_poDate').value) || '';
        const vehicleNo = ($('#vch_vehicleNo') && $('#vch_vehicleNo').value.trim()) || '';
        const ewayBillNo = ($('#vch_ewayBillNo') && $('#vch_ewayBillNo').value.trim()) || '';
        const transporter = ($('#vch_transporter') && $('#vch_transporter').value.trim()) || '';

        const trs = $('tr[data-vidx]', $('#vchLinesTbody'));
        const entries = trs.map(tr => {
          const sel = $('.v_ledger', tr);
          const opt = (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex] : null;
          const rawText = opt ? opt.text : 'Account';
          return {
            ledgerId: sel ? sel.value : '',
            ledgerName: rawText.replace(/\s*\([^)]*\)$/, ''),
            debit: parseFloat($('.v_dr', tr).value) || 0,
            credit: parseFloat($('.v_cr', tr).value) || 0
          };
        });

        try {
          await apiPost('/api/vouchers', {
            voucherType: vtype,
            date: vdate,
            narration: vnarration,
            docRef: vdocRef,
            partyName,
            billing: { name: partyName, gstin: partyGstin, address: partyAddress },
            shipping: { name: shipName, gstin: shipGstin, address: shipAddress },
            project,
            projectCode,
            site,
            poNo,
            poDate,
            vehicleNo,
            ewayBillNo,
            transporter,
            entries
          });
          toast('✅ Balanced voucher posted successfully!');
          closeModal();
          viewAccounting();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });

    let currentEntries = [
      { ledgerId: ledgers[0] ? ledgers[0].id : '', dr: 1000, cr: 0 },
      { ledgerId: ledgers[1] ? ledgers[1].id : '', dr: 0, cr: 1000 }
    ];

    function drawVchRows() {
      const tbody = $('#vchLinesTbody');
      if (!tbody) return;

      tbody.innerHTML = currentEntries.map((e, idx) => `
        <tr data-vidx="${idx}">
          <td>
            <select class="v_ledger" style="width:100%;font-size:0.85rem">
              ${ledgers.map(l => `<option value="${l.id}" ${l.id === e.ledgerId ? 'selected' : ''}>${esc(l.name)} (${esc(l.groupName)})</option>`).join('')}
            </select>
          </td>
          <td class="r"><input type="number" step="0.01" class="v_dr r" value="${e.dr}" style="width:110px;font-size:0.85rem"></td>
          <td class="r"><input type="number" step="0.01" class="v_cr r" value="${e.cr}" style="width:110px;font-size:0.85rem"></td>
          <td class="r"><button class="btn sm del btnDelVchRow" data-delvidx="${idx}">✕</button></td>
        </tr>
      `).join('');

      $$('.btnDelVchRow', tbody).forEach(b => {
        b.onclick = () => {
          syncEntriesFromDom();
          const i = parseInt(b.dataset.delvidx, 10);
          currentEntries.splice(i, 1);
          drawVchRows();
        };
      });

      $$('.v_dr, .v_cr', tbody).forEach(inp => {
        inp.oninput = syncAndCheckBalance;
      });

      syncAndCheckBalance();
    }

    function syncEntriesFromDom() {
      const tbody = $('#vchLinesTbody');
      if (!tbody) return;
      currentEntries = $$('tr[data-vidx]', tbody).map(tr => ({
        ledgerId: $('.v_ledger', tr).value,
        dr: parseFloat($('.v_dr', tr).value) || 0,
        cr: parseFloat($('.v_cr', tr).value) || 0
      }));
    }

    function syncAndCheckBalance() {
      syncEntriesFromDom();
      let totDr = 0;
      let totCr = 0;
      currentEntries.forEach(e => {
        totDr += e.dr;
        totCr += e.cr;
      });
      totDr = Math.round(totDr * 100) / 100;
      totCr = Math.round(totCr * 100) / 100;

      const diff = Math.abs(totDr - totCr);
      $('#vchTotDr').innerText = '₹' + totDr.toLocaleString('en-IN');
      $('#vchTotCr').innerText = '₹' + totCr.toLocaleString('en-IN');

      const stat = $('#vchBalanceStatus');
      if (diff === 0 && totDr > 0) {
        stat.innerHTML = `<span style="color:#15803d">✅ Balanced (Diff: ₹0)</span>`;
      } else {
        stat.innerHTML = `<span style="color:#dc2626">⚠️ Imbalanced (Diff: ₹${diff.toFixed(2)})</span>`;
      }
    }

    $('#btnAddVchLine').onclick = () => {
      syncEntriesFromDom();
      currentEntries.push({ ledgerId: ledgers[0] ? ledgers[0].id : '', dr: 0, cr: 0 });
      drawVchRows();
    };

    drawVchRows();
  }

  /**
   * Modal: Ledger Statement with Running Balance
   */
  async function openLedgerStatementModal(ledgerId) {
    modal({
      title: '📜 Ledger Account Statement',
      wide: true,
      body: `<div class="mute" style="padding:20px;text-align:center">Fetching account transactions...</div>`
    });

    try {
      const stmt = await apiGet(`/api/reports/ledger/${ledgerId}`);
      const bodyEl = $('.modal-body');
      if (!bodyEl) return;

      bodyEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="card" style="background:#f8fafc;padding:12px">
            <div class="grid g3" style="font-size:0.85rem">
              <div><b>Account:</b> ${esc(stmt.ledger.name)}</div>
              <div><b>Group:</b> ${esc(stmt.ledger.groupName || '-')}</div>
              <div><b>Opening Balance:</b> ${rs(stmt.openingBalance)} ${stmt.openingBalanceType}</div>
            </div>
          </div>

          <div class="scx" style="max-height:280px">
            <table class="tbl sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher No</th>
                  <th>Type</th>
                  <th>Narration</th>
                  <th class="r">Debit (₹)</th>
                  <th class="r">Credit (₹)</th>
                  <th class="r">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                ${stmt.rows.length ? stmt.rows.map(r => `
                  <tr>
                    <td>${fmtDate(r.date)}</td>
                    <td><b>${esc(r.voucherNo)}</b></td>
                    <td>${esc(r.voucherType.toUpperCase())}</td>
                    <td>${esc(r.narration || '-')}</td>
                    <td class="r">${r.debit > 0 ? rs(r.debit) : '—'}</td>
                    <td class="r">${r.credit > 0 ? rs(r.credit) : '—'}</td>
                    <td class="r" style="font-weight:700">${rs(r.runningBalance)} ${r.balanceType}</td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="7" class="mute" style="text-align:center;padding:16px">No transactions recorded for this ledger.</td></tr>
                `}
              </tbody>
              <tfoot>
                <tr style="background:#f8fafc;font-weight:700">
                  <td colspan="4">PERIOD TOTALS / CLOSING:</td>
                  <td class="r" style="color:#1e3a8a">${rs(stmt.totalDebit)}</td>
                  <td class="r" style="color:#1e3a8a">${rs(stmt.totalCredit)}</td>
                  <td class="r" style="color:#15803d;font-weight:900">${rs(stmt.closingBalance)} ${stmt.closingBalanceType}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <button class="btn sm" id="btnPrintStmtSheet">🖨️ Print Statement</button>
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;

      const btnPrint = $('#btnPrintStmtSheet');
      if (btnPrint) {
        btnPrint.onclick = () => {
          closeModal();
          if (window.QuoteDeskPrint) {
            const reportHtml = `
              <div style="border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;padding:10px 14px;margin-bottom:14px;font-size:0.85rem">
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                  <div><b>Account Name:</b> ${esc(stmt.ledger.name)}</div>
                  <div><b>Account Group:</b> ${esc(stmt.ledger.groupName || '-')}</div>
                  <div><b>Opening Balance:</b> ${rs(stmt.openingBalance)} ${stmt.openingBalanceType}</div>
                </div>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:14px">
                <thead>
                  <tr style="background:#0f172a;color:#ffffff;text-align:left">
                    <th style="padding:6px 8px;border:1px solid #0f172a">Date</th>
                    <th style="padding:6px 8px;border:1px solid #0f172a">Voucher No</th>
                    <th style="padding:6px 8px;border:1px solid #0f172a">Type</th>
                    <th style="padding:6px 8px;border:1px solid #0f172a">Particulars / Narration</th>
                    <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Debit (Dr ₹)</th>
                    <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Credit (Cr ₹)</th>
                    <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${stmt.rows.length ? stmt.rows.map((r, idx) => `
                    <tr style="border-bottom:1px solid #e2e8f0;background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                      <td style="padding:6px 8px;border:1px solid #cbd5e1">${fmtDate(r.date)}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1"><b>${esc(r.voucherNo)}</b></td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1">${esc(r.voucherType.toUpperCase())}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1">${esc(r.narration || '-')}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right">${r.debit > 0 ? rs(r.debit) : '-'}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right">${r.credit > 0 ? rs(r.credit) : '-'}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">${rs(r.runningBalance)} ${r.balanceType}</td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="7" style="text-align:center;padding:16px;color:#64748b">No transactions recorded for this ledger.</td></tr>
                  `}
                </tbody>
                <tfoot>
                  <tr style="background:#f1f5f9;font-weight:800;border-top:2px solid #0f172a">
                    <td colspan="4" style="padding:8px;border:1px solid #cbd5e1">PERIOD TOTALS / CLOSING:</td>
                    <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">${rs(stmt.totalDebit)}</td>
                    <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">${rs(stmt.totalCredit)}</td>
                    <td style="padding:8px;border:1px solid #cbd5e1;text-align:right;color:#15803d;font-weight:900">${rs(stmt.closingBalance)} ${stmt.closingBalanceType}</td>
                  </tr>
                </tfoot>
              </table>
            `;
            window.QuoteDeskPrint.previewReport(`Statement of Account: ${stmt.ledger.name}`, reportHtml);
          }
        };
      }
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: View Voucher Detail
   */
  function openVoucherDetailModal(v) {
    const billing = v.billing || (v.partyName ? { name: v.partyName } : null);
    const shipping = v.shipping || null;

    modal({
      title: `👁️ Voucher Details — ${esc(v.voucherNo)}`,
      wide: true,
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:4px 0">
          <div class="card" style="background:#f8fafc;padding:12px">
            <div class="grid g4" style="font-size:0.85rem">
              <div><b>Voucher No:</b> ${esc(v.voucherNo)}</div>
              <div><b>Type:</b> ${esc(v.voucherType.toUpperCase())}</div>
              <div><b>Date:</b> ${fmtDate(v.date)}</div>
              <div><b>Status:</b> ${v.cancelled ? '<span style="color:#dc2626;font-weight:700">CANCELLED</span>' : '<span style="color:#15803d;font-weight:700">Posted</span>'}</div>
            </div>
            <div style="margin-top:8px;font-size:0.85rem">
              <b>Narration:</b> ${esc(v.narration || 'No narration provided')}
            </div>
            ${v.cancelledReason ? `<div style="margin-top:6px;font-size:0.85rem;color:#dc2626"><b>Cancellation Reason:</b> ${esc(v.cancelledReason)}</div>` : ''}
          </div>

          ${(billing || v.project || v.vehicleNo) ? `
            <!-- Statutory Billing & Transport Card in Voucher Detail -->
            <div class="card" style="background:#ffffff;border:1px solid #cbd5e1;padding:12px">
              <div class="grid g2" style="font-size:0.82rem;gap:12px">
                <div>
                  <div style="font-weight:800;color:#475569;text-transform:uppercase;font-size:0.72rem;margin-bottom:4px">Party / Billed To:</div>
                  <div><b>${esc(billing && billing.name || v.partyName || '-')}</b></div>
                  ${billing && billing.address ? `<div style="color:#334155">${esc(billing.address)}</div>` : ''}
                  ${billing && billing.gstin ? `<div><b>GSTIN:</b> <span style="font-family:monospace">${esc(billing.gstin)}</span></div>` : ''}
                </div>
                <div>
                  <div style="font-weight:800;color:#475569;text-transform:uppercase;font-size:0.72rem;margin-bottom:4px">Project &amp; Transport Logistics:</div>
                  ${v.project ? `<div><b>Project:</b> ${esc(v.project)} ${v.projectCode ? '(' + esc(v.projectCode) + ')' : ''}</div>` : ''}
                  ${v.site ? `<div><b>Site:</b> ${esc(v.site)}</div>` : ''}
                  ${v.poNo ? `<div><b>PO No:</b> ${esc(v.poNo)} ${v.poDate ? '(' + fmtDate(v.poDate) + ')' : ''}</div>` : ''}
                  ${v.vehicleNo ? `<div><b>Vehicle No:</b> <span style="font-family:monospace">${esc(v.vehicleNo)}</span></div>` : ''}
                  ${v.ewayBillNo ? `<div><b>E-Way Bill:</b> <span style="font-family:monospace">${esc(v.ewayBillNo)}</span></div>` : ''}
                </div>
              </div>
            </div>
          ` : ''}

          <table class="tbl sm">
            <thead>
              <tr>
                <th>Particulars (Ledger)</th>
                <th class="r">Debit (₹)</th>
                <th class="r">Credit (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${(v.entries || []).map(e => `
                <tr>
                  <td><b>${esc(e.ledgerName)}</b></td>
                  <td class="r">${e.debit > 0 ? rs(e.debit) : '—'}</td>
                  <td class="r">${e.credit > 0 ? rs(e.credit) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="font-weight:900;background:#f8fafc">
                <td>TOTAL:</td>
                <td class="r" style="color:#1e3a8a">${rs(v.totalAmount)}</td>
                <td class="r" style="color:#1e3a8a">${rs(v.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <button class="btn sm" id="btnModalPrintVch" style="background:#f1f5f9;border:1px solid #cbd5e1">🖨️ Print / Preview Voucher</button>
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `
    });

    const btnP = $('#btnModalPrintVch');
    if (btnP && window.QuoteDeskPrint) {
      btnP.onclick = () => {
        closeModal();
        window.QuoteDeskPrint.previewVoucher(v);
      };
    }
  }

  /**
   * Prompt to Cancel Voucher
   */
  function promptCancelVoucher(vchId) {
    modal({
      title: '⚠️ Cancel Accounting Voucher',
      body: `
        <div style="margin:8px 0">
          <p class="mute sm" style="margin-bottom:12px">
            Per statutory accounting regulations, posted vouchers cannot be permanently deleted.
            Cancelling will reverse its ledger effects while preserving the full audit trail.
          </p>
          <label class="f">
            <span>Mandatory Reason for Cancellation <b style="color:#dc2626">*</b></span>
            <input type="text" id="vch_cancel_reason" placeholder="e.g. Posted wrong amount / duplicate entry">
          </label>
        </div>
      `,
      okText: 'Confirm Cancellation',
      onOk: async () => {
        const reason = $('#vch_cancel_reason').value.trim();
        if (!reason) {
          toast('Cancellation reason is strictly mandatory.', 'bad');
          return false;
        }
        try {
          await apiPost(`/api/vouchers/${vchId}/cancel`, { reason });
          toast('✅ Voucher marked as Cancelled.');
          closeModal();
          viewAccounting();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });
  }

  /**
   * Modal: Add Custom Ledger
   */
  function openNewLedgerModal() {
    const groups = cachedAccounts.groups || [];

    modal({
      title: '➕ Add Custom Ledger Account',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;margin:6px 0">
          <label class="f">
            <span>Ledger Name <b style="color:#dc2626">*</b></span>
            <input type="text" id="nl_name" placeholder="e.g. Office Rent / Equipment Repair">
          </label>
          <label class="f">
            <span>Under Group <b style="color:#dc2626">*</b></span>
            <select id="nl_group">
              ${groups.map(g => `<option value="${g.id}">${esc(g.name)} (${esc(g.nature)})</option>`).join('')}
            </select>
          </label>
          <div class="grid g2" style="gap:10px">
            <label class="f">
              <span>Opening Balance (₹)</span>
              <input type="number" id="nl_opBal" value="0" min="0">
            </label>
            <label class="f">
              <span>Balance Type</span>
              <select id="nl_opType">
                <option value="Dr">Debit (Dr)</option>
                <option value="Cr">Credit (Cr)</option>
              </select>
            </label>
          </div>
        </div>
      `,
      okText: 'Create Ledger',
      onOk: async () => {
        const name = $('#nl_name').value.trim();
        const groupId = $('#nl_group').value;
        const openingBalance = parseFloat($('#nl_opBal').value) || 0;
        const openingBalanceType = $('#nl_opType').value;

        if (!name) {
          toast('Ledger name is required.', 'bad');
          return false;
        }

        try {
          await apiPost('/api/accounts', {
            name,
            groupId,
            openingBalance,
            openingBalanceType
          });
          toast('✅ Ledger created successfully!');
          closeModal();
          cachedAccounts = await apiGet('/api/accounts');
          activeTab = 'ledgers';
          viewAccounting();
        } catch (e) {
          toast(e.message, 'bad');
          return false;
        }
      }
    });
  }

  // Export to window
  window.viewAccounting = viewAccounting;
})();
