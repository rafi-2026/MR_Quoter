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
      <div class="top-bar">
        <div>
          <h2>📖 Accounting &amp; Financial Ledgers</h2>
          <p class="mute sm">Tally-compatible double-entry books, verified trial balance, and statutory reports.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn pri sm" id="btnNewVoucher">+ Create Voucher</button>
          <button class="btn ghost sm" id="btnNewLedger">+ New Ledger</button>
        </div>
      </div>

      <!-- Accounting Sub-Navigation Tabs -->
      <div style="display:flex;gap:6px;margin:12px 0 16px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;overflow-x:auto">
        <button class="btn sm ${activeTab === 'vouchers' ? 'pri' : 'ghost'}" data-acctab="vouchers">📋 Vouchers</button>
        <button class="btn sm ${activeTab === 'ledgers' ? 'pri' : 'ghost'}" data-acctab="ledgers">📒 Ledgers</button>
        <button class="btn sm ${activeTab === 'projects' ? 'pri' : 'ghost'}" data-acctab="projects">🏗️ Projects &amp; P&amp;L</button>
        <button class="btn sm ${activeTab === 'pettycash' ? 'pri' : 'ghost'}" data-acctab="pettycash">💵 Petty Cash</button>
        <button class="btn sm ${activeTab === 'bank' ? 'pri' : 'ghost'}" data-acctab="bank">🏦 Bank Statements</button>
        <button class="btn sm ${activeTab === 'suspense' ? 'pri' : 'ghost'}" data-acctab="suspense" id="tabBtnSuspense">
          🔔 Suspense <span id="suspenseBadge" class="bd" style="background:#fee2e2;color:#b91c1c;font-size:0.75rem;display:none;margin-left:4px">0</span>
        </button>
        <button class="btn sm ${activeTab === 'daybook' ? 'pri' : 'ghost'}" data-acctab="daybook">📅 Day Book</button>
        <button class="btn sm ${activeTab === 'trialbalance' ? 'pri' : 'ghost'}" data-acctab="trialbalance">⚖️ Trial Balance</button>
        <button class="btn sm ${activeTab === 'pnl' ? 'pri' : 'ghost'}" data-acctab="pnl">📈 Profit &amp; Loss</button>
        <button class="btn sm ${activeTab === 'balancesheet' ? 'pri' : 'ghost'}" data-acctab="balancesheet">🏦 Balance Sheet</button>
        <button class="btn sm ${activeTab === 'gst' ? 'pri' : 'ghost'}" data-acctab="gst">📑 GST Working Sheet</button>
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
      if (badge && suspSummary.count > 0) {
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
    else if (activeTab === 'gst') renderGstTab(area);
  }

  // 1. Vouchers Tab
  async function renderVouchersTab(area) {
    try {
      const vouchers = await apiGet('/api/vouchers');
      cachedVouchers = vouchers;

      if (!vouchers.length) {
        area.innerHTML = `
          <div class="card" style="padding:32px;text-align:center">
            <p class="mute">No accounting vouchers recorded yet.</p>
            <button class="btn pri sm" id="btnEmptyVch">+ Create First Voucher</button>
          </div>
        `;
        $('#btnEmptyVch').onclick = openNewVoucherModal;
        return;
      }

      area.innerHTML = `
        <div class="card">
          <div class="scx">
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
                  <th class="r">Action</th>
                </tr>
              </thead>
              <tbody>
                ${vouchers.map(v => {
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
                      <td class="r">
                        <button class="btn sm ghost btnViewVch" data-vid="${v.id}" title="View Details">👁️</button>
                        ${!v.cancelled ? `<button class="btn sm ghost btnCancelVch" data-vid="${v.id}" style="color:#dc2626" title="Cancel Voucher">✕</button>` : ''}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      $$('.btnViewVch', area).forEach(b => {
        b.onclick = () => {
          const v = cachedVouchers.find(x => x.id === b.dataset.vid);
          if (v) openVoucherDetailModal(v);
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
    if (!ledgers.length) {
      area.innerHTML = `<div class="card mute" style="padding:24px;text-align:center">No ledgers found.</div>`;
      return;
    }

    area.innerHTML = `
      <div class="card">
        <div class="scx">
          <table class="tbl sm">
            <thead>
              <tr>
                <th>Ledger Name</th>
                <th>Under Group</th>
                <th>Nature</th>
                <th class="r">Opening Balance</th>
                <th class="r">Action</th>
              </tr>
            </thead>
            <tbody>
              ${ledgers.map(l => `
                <tr>
                  <td><b>${esc(l.name)}</b> ${l.isSystem ? '<span class="mute sm" style="font-size:0.75rem">(System)</span>' : ''}</td>
                  <td>${esc(l.groupName)}</td>
                  <td><span class="bd" style="text-transform:capitalize">${esc(l.nature)}</span></td>
                  <td class="r">${rs(l.openingBalance || 0)} ${l.openingBalanceType || 'Dr'}</td>
                  <td class="r">
                    <button class="btn sm ghost btnOpenStmt" data-lid="${l.id}">📜 Statement</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

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
          <button class="btn sm pri" id="btnLoadDaybook">Fetch Day Book</button>
        </div>
      </div>
      <div id="daybookResults"></div>
    `;

    const loadDaybook = async () => {
      const d = $('#db_date').value;
      const resEl = $('#daybookResults');
      resEl.innerHTML = `<div class="mute" style="padding:20px;text-align:center">Loading day book for ${d}...</div>`;
      try {
        const vouchers = await apiGet(`/api/reports/daybook?from=${d}`);
        if (!vouchers.length) {
          resEl.innerHTML = `<div class="card mute" style="padding:20px;text-align:center">No vouchers recorded on ${fmtDate(d)}.</div>`;
          return;
        }

        resEl.innerHTML = `
          <div class="card">
            <div class="scx">
              <table class="tbl sm">
                <thead>
                  <tr>
                    <th>Voucher No</th>
                    <th>Type</th>
                    <th>Narration</th>
                    <th class="r">Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${vouchers.map(v => `
                    <tr>
                      <td><b>${esc(v.voucherNo)}</b></td>
                      <td>${esc(v.voucherType.toUpperCase())}</td>
                      <td>${esc(v.narration || '-')}</td>
                      <td class="r" style="font-weight:700">${rs(v.totalAmount)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      } catch (e) {
        resEl.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
      }
    };

    $('#btnLoadDaybook').onclick = loadDaybook;
    loadDaybook();
  }

  // 4. Trial Balance Tab
  async function renderTrialBalanceTab(area) {
    area.innerHTML = `<div class="mute" style="padding:24px;text-align:center">Computing trial balance...</div>`;
    try {
      const tb = await apiGet('/api/reports/trialbalance');
      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
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

          <div class="card">
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
                  <td class="r" style="font-weight:700;color:#1e3a8a">${rs(gst.gstr1.totalTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- GSTR-3B Tax Liability & ITC -->
          <div class="card" style="background:#f8fafc">
            <h4 style="margin:0 0 10px;color:#0f172a">GSTR-3B: Monthly Tax Liability &amp; Input Tax Credit (ITC)</h4>
            <div class="grid g3" style="gap:12px;margin-top:10px">
              <div class="card" style="padding:12px">
                <span class="mute sm">Total Outward Tax Liability:</span>
                <div style="font-size:1.25rem;font-weight:900;color:#dc2626;margin-top:4px">${rs(gst.gstr3b.outwardTax)}</div>
              </div>
              <div class="card" style="padding:12px">
                <span class="mute sm">Eligible Input Tax Credit (ITC):</span>
                <div style="font-size:1.25rem;font-weight:900;color:#15803d;margin-top:4px">${rs(gst.gstr3b.eligibleItc)}</div>
              </div>
              <div class="card" style="padding:12px;background:#f0fdf4;border-color:#bbf7d0">
                <span class="mute sm" style="color:#166534">Net Tax Payable in Cash:</span>
                <div style="font-size:1.25rem;font-weight:900;color:#166534;margin-top:4px">${rs(gst.gstr3b.netTaxPayableCash)}</div>
              </div>
            </div>
          </div>
        </div>
      `;
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

        const trs = $$('tr[data-vidx]', $('#vchLinesTbody'));
        const entries = trs.map(tr => ({
          ledgerId: $('.v_ledger', tr).value,
          ledgerName: $('.v_ledger option:checked', tr).text,
          debit: parseFloat($('.v_dr', tr).value) || 0,
          credit: parseFloat($('.v_cr', tr).value) || 0
        }));

        try {
          await apiPost('/api/vouchers', {
            voucherType: vtype,
            date: vdate,
            narration: vnarration,
            docRef: vdocRef,
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

          <div style="display:flex;justify-content:flex-end;margin-top:10px">
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;
    } catch (e) {
      $('.modal-body').innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  /**
   * Modal: View Voucher Detail
   */
  function openVoucherDetailModal(v) {
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
          <div style="text-align:right;margin-top:10px">
            <button class="btn sm pri" onclick="closeModal()">Close</button>
          </div>
        </div>
      `
    });
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
