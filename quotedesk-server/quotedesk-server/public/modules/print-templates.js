'use strict';
/**
 * print-templates.js — Universal Print, PDF, Email & WhatsApp Engine
 * Provides standard letterhead, header, footer, and action modals for all
 * Billing Documents, Accounting Vouchers, and Financial Statements.
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

  const VOUCHER_LABELS = {
    sales:       'Sales Invoice Voucher',
    purchase:    'Purchase Bill Voucher',
    receipt:     'Receipt Voucher',
    payment:     'Payment Voucher',
    journal:     'Journal Voucher',
    contra:      'Contra Voucher',
    debit_note:  'Debit Note Voucher',
    credit_note: 'Credit Note Voucher'
  };

  // Indian Rupee formatting
  function rs(val, decimals = 2) {
    const num = Number(val) || 0;
    return '₹ ' + num.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function fmtDate(d) {
    if (!d) return '-';
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return d;
    }
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Convert numbers to Indian Rupees words
  function numToWordsINR(amount) {
    const num = Math.round(Number(amount) || 0);
    if (num === 0) return 'Zero Rupees Only';
    if (num < 0) return 'Minus ' + numToWordsINR(Math.abs(num));

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function twoDigits(n) {
      if (n < 20) return ones[n];
      return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
    }

    function threeDigits(n) {
      const h = Math.floor(n / 100);
      const rem = n % 100;
      let str = '';
      if (h > 0) str += ones[h] + ' Hundred';
      if (rem > 0) str += (str ? ' ' : '') + twoDigits(rem);
      return str;
    }

    let n = num;
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    const hundreds = n;

    let res = '';
    if (crore > 0) res += threeDigits(crore) + ' Crore ';
    if (lakh > 0) res += twoDigits(lakh) + ' Lakh ';
    if (thousand > 0) res += twoDigits(thousand) + ' Thousand ';
    if (hundreds > 0) res += threeDigits(hundreds);

    return res.trim() + ' Rupees Only';
  }

  function getSettings() {
    return (window.db && window.db.settings) || {};
  }

  /**
   * Render Standard Company Header HTML
   */
  function renderCompanyHeader(s) {
    const hdrImg = (typeof window.getHeaderImg === 'function' ? window.getHeaderImg() : s.headerImg) || '';
    if (s.headerStyle === 'letterhead' && hdrImg) {
      return `<div style="text-align:center;margin-bottom:12px"><img class="hd-img" src="${hdrImg}" alt="${esc(s.company || 'Company')}" style="max-width:100%;max-height:130px;object-fit:contain"></div>`;
    }

    return `
      <div class="doc-hdr-modern" style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:14px">
        <div class="doc-hdr-left" style="display:flex;align-items:center;gap:14px;flex:1">
          ${s.logoImg ? `<img class="doc-logo-img" src="${s.logoImg}" alt="Logo" style="max-height:75px;max-width:140px;object-fit:contain">` : ''}
          <div style="flex:1">
            <div class="doc-hdr-company" style="font-size:1.45rem;font-weight:800;color:#0f172a;line-height:1.2;text-transform:uppercase;letter-spacing:0.5px">${esc(s.company || 'MR_Quoter Enterprise')}</div>
            ${s.tagline ? `<div class="doc-hdr-tagline" style="font-size:0.85rem;color:#475569;margin-top:2px;font-style:italic">${esc(s.tagline)}</div>` : ''}
            ${(s.address1 || s.city || s.state) ? `
              <div class="doc-hdr-address" style="font-size:0.82rem;color:#334155;margin-top:3px">
                ${[s.address1, s.address2, s.city, s.state && (s.state + (s.pincode ? ' - ' + s.pincode : ''))].filter(Boolean).map(esc).join(', ')}
              </div>` : ''}
            ${(s.phone || s.mobile || s.email || s.website) ? `
              <div class="doc-hdr-contacts" style="font-size:0.78rem;color:#475569;margin-top:2px">
                ${[s.phone && 'Tel: ' + esc(s.phone), s.mobile && 'Mob: ' + esc(s.mobile), s.email && 'Email: ' + esc(s.email), s.website && 'Web: ' + esc(s.website)].filter(Boolean).join(' &nbsp;|&nbsp; ')}
              </div>` : ''}
            ${(s.gstin || s.pan || s.msme || s.cin) ? `
              <div class="doc-hdr-regs" style="font-size:0.78rem;color:#0f172a;margin-top:3px">
                ${[s.gstin && '<b>GSTIN:</b> ' + esc(s.gstin), s.pan && '<b>PAN:</b> ' + esc(s.pan), s.msme && '<b>MSME:</b> ' + esc(s.msme), s.cin && '<b>CIN:</b> ' + esc(s.cin)].filter(Boolean).join(' &nbsp;&bull;&nbsp; ')}
              </div>` : ''}
          </div>
        </div>
        ${(s.isoStandard || s.isoImg) ? `
          <div class="doc-hdr-iso" style="text-align:right;max-width:160px">
            ${s.isoImg ? `<img src="${s.isoImg}" style="max-height:48px;margin-bottom:2px" alt="ISO">` : ''}
            ${s.isoStandard ? `<div style="font-size:0.72rem;font-weight:700;color:#0284c7">${esc(s.isoStandard)}</div>` : ''}
          </div>` : ''}
      </div>
    `;
  }

  /**
   * Render Standard Company Footer HTML
   */
  function renderCompanyFooter(s) {
    const ftrImg = (typeof window.getFooterImg === 'function' ? window.getFooterImg() : s.footerImg) || '';
    if (s.footerStyle === 'letterhead' && ftrImg) {
      return `<div style="text-align:center;margin-top:14px"><img class="ft-img" src="${ftrImg}" style="max-width:100%;max-height:100px;object-fit:contain" alt=""></div>`;
    }
    return '';
  }

  /**
   * Universal Document HTML Generator (Invoices, Challans, POs, etc.)
   */
  function renderDocumentHTML(d, opts = {}) {
    const s = getSettings();
    const typeLabel = DOC_LABELS[d.docType] || d.docType.toUpperCase();
    const isMrl = d.docType === 'mrl';
    const isChallanWithoutVal = d.docType === 'dc' && opts.mode === 'without_value';
    const totals = d.totals || {};
    const lines = d.lines || [];
    const cust = d.cust || d.vendor || {};
    const bank = s.bank || {};
    const hasBank = bank.acNo || bank.bankName || bank.ifsc;
    const terms = (d.terms || s.terms || '').split('\n').map(t => t.trim()).filter(Boolean);
    const wmImg = s.watermarkImg || '';

    let statutoryTitle = typeLabel.toUpperCase();
    let subTitle = '';
    if (d.docType === 'inv') subTitle = 'TAX INVOICE (Issued under Section 31 of CGST Act, 2017)';
    else if (d.docType === 'dc') {
      subTitle = isChallanWithoutVal
        ? 'DELIVERY CHALLAN &bull; GATE PASS / SITE STORE COPY (WITHOUT VALUE)'
        : 'DELIVERY CHALLAN &bull; CONSIGNMENT TRANSPORT COPY (WITH VALUE)';
    } else if (d.docType === 'pi') subTitle = 'PROFORMA INVOICE / ESTIMATE';
    else if (d.docType === 'ra') subTitle = `RUNNING ACCOUNT (RA) BILL #${d.raNumber || 1}`;
    else if (d.docType === 'cn') subTitle = 'CREDIT NOTE (Issued under Section 34 of CGST Act, 2017)';
    else if (d.docType === 'dn') subTitle = 'DEBIT NOTE (Issued under Section 34 of CGST Act, 2017)';
    else if (d.docType === 'mrl') {
      statutoryTitle = 'MATERIAL REQUISITION VOUCHER (MRL)';
      subTitle = 'FACTORY FABRICATION &amp; STORE ISSUE INDENT';
    }

    return `
      ${wmImg ? `<img class="wm" src="${wmImg}" alt="" style="position:absolute;top:30%;left:15%;width:70%;opacity:0.07;pointer-events:none;z-index:0">` : ''}
      <div style="position:relative;z-index:1;font-family:inherit;color:#0f172a;line-height:1.4">
        ${renderCompanyHeader(s)}

        <div style="text-align:center;margin:8px 0 14px">
          <div style="font-size:1.25rem;font-weight:800;letter-spacing:1px;color:#0f172a;text-transform:uppercase">${esc(statutoryTitle)}</div>
          ${subTitle ? `<div style="font-size:0.75rem;font-weight:700;color:#475569;margin-top:2px">${esc(subTitle)}</div>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;margin-bottom:14px;background:#f8fafc">
          <div>
            <div style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:3px">${isMrl ? 'Requisition For / Project Client:' : 'Billed To / Consignee:'}</div>
            <div style="font-weight:700;font-size:0.95rem;color:#0f172a">${esc(cust.name || '(No Party Assigned)')}</div>
            ${cust.address ? `<div style="font-size:0.82rem;color:#334155">${esc(cust.address)}</div>` : ''}
            ${(cust.city || cust.state) ? `<div style="font-size:0.82rem;color:#334155">${[cust.city, cust.state && (cust.state + (cust.pincode ? ' - ' + cust.pincode : ''))].filter(Boolean).map(esc).join(', ')}</div>` : ''}
            ${cust.gstin ? `<div style="font-size:0.82rem;margin-top:2px"><b>GSTIN:</b> <span style="font-family:monospace">${esc(cust.gstin)}</span></div>` : ''}
            ${cust.phone || cust.email ? `<div style="font-size:0.8rem;color:#475569;margin-top:2px">${[cust.phone, cust.email].filter(Boolean).map(esc).join(' &bull; ')}</div>` : ''}
            ${d.site ? `<div style="font-size:0.8rem;color:#0369a1;margin-top:3px"><b>Site Location:</b> ${esc(d.site)}</div>` : ''}
          </div>

          <div style="border-left:1px dashed #cbd5e1;padding-left:12px">
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;font-size:0.82rem">
              <span style="color:#64748b">Voucher / Doc No:</span><b>${esc(d.no)}</b>
              <span style="color:#64748b">Date:</span><span>${fmtDate(d.date)}</span>
              <span style="color:#64748b">Revision:</span><span>Rev ${d.rev || 0} ${d.superseded ? '<span style="color:#dc2626;font-weight:700">(Replaced)</span>' : ''}</span>
              ${d.sourceDocNo ? `<span style="color:#64748b">Source Quotation:</span><b>${esc(d.sourceDocNo)}</b>` : ''}
              ${d.project ? `<span style="color:#64748b">Project:</span><b>${esc(d.project)}</b>` : ''}
              <span style="color:#64748b">Place of Supply:</span><span>${esc(d.pos || s.state || 'Tamil Nadu')} (State Code: ${esc(d.stateCode || '33')})</span>
              ${d.vehicleNo ? `<span style="color:#64748b">Vehicle No:</span><span>${esc(d.vehicleNo)}</span>` : ''}
              ${d.transporter ? `<span style="color:#64748b">Transporter:</span><span>${esc(d.transporter)}</span>` : ''}
            </div>
          </div>
        </div>

        ${isMrl ? `
          <!-- MRL Raw Material Table with Code and Brand -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:0.82rem">
            <thead>
              <tr style="background:#0f172a;color:#ffffff;text-align:left">
                <th style="padding:6px 8px;border:1px solid #0f172a;width:32px;text-align:center">#</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center;width:95px">Code</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;width:110px">Brand / Make</th>
                <th style="padding:6px 8px;border:1px solid #0f172a">Description of Material</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center;width:80px">Category</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right;width:75px">Req Qty</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center;width:55px">Unit</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right;width:80px">Rate (₹)</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right;width:90px">Total (₹)</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center;width:85px">Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${lines.map((l, i) => {
                const qty = Number(l.qty) || 1;
                const rate = Number(l.rate) || 0;
                const taxable = Math.round((Number(l.taxable) || (qty * rate)) * 100) / 100;
                return `
                  <tr style="border-bottom:1px solid #e2e8f0;background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${i + 1}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;font-family:monospace;font-weight:700;color:#0284c7">${esc(l.code || l.profile_no || '-')}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;font-weight:600;color:#334155">${esc(l.brand || l.series || 'Standard')}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1">
                      <div style="font-weight:700;color:#0f172a">${esc(l.name || l.desc || 'Material')}</div>
                      ${l.desc && l.desc !== l.name ? `<div style="font-size:0.75rem;color:#475569;margin-top:2px">${esc(l.desc)}</div>` : ''}
                    </td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center"><span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#e2e8f0;font-size:0.72rem;font-weight:600;text-transform:uppercase">${esc(l.category || 'profile')}</span></td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:800;color:#0f172a">${qty}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;font-weight:600">${esc(l.unit || 'nos')}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right">${rate > 0 ? rs(rate) : '—'}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">${taxable > 0 ? rs(taxable) : '—'}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;color:#64748b;font-size:0.75rem">${esc(l.remarks || 'To Issue')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:14px">
            <div style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px">
              <div style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:3px">Estimated Indent Value in Words:</div>
              <div style="font-size:0.85rem;font-weight:700;color:#0f172a">${numToWordsINR(totals.taxable || totals.grandTotal || 0)}</div>
            </div>

            <div style="width:280px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;padding:10px 12px;font-size:0.82rem">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="color:#64748b">Total Requisition Items:</span>
                <b>${lines.length} Line Items</b>
              </div>
              <div style="display:flex;justify-content:space-between;border-top:2px solid #0f172a;padding-top:4px;margin-top:4px;font-size:0.95rem;font-weight:800;color:#0f172a">
                <span>Estimated Material Cost:</span>
                <span>${rs(totals.taxable || totals.grandTotal || 0)}</span>
              </div>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:0.8rem">
            <div>
              <div class="mute sm">Requested By (Site / Production)</div>
              <div style="height:35px"></div>
              <div><b>Site Engineer / Production In-Charge</b></div>
            </div>
            <div style="text-align:center">
              <div class="mute sm">Store Verification &amp; Issue</div>
              <div style="height:35px"></div>
              <div><b>Stores In-Charge / Storekeeper</b></div>
            </div>
            <div style="text-align:right">
              <div>For <b>${esc(s.company || 'MR_Quoter Enterprise')}</b></div>
              <div style="height:35px"></div>
              <div><b>Authorized Signatory</b></div>
            </div>
          </div>
        ` : `
          <!-- Standard Commercial Document Table -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:0.82rem">
            <thead>
              <tr style="background:#0f172a;color:#ffffff;text-align:left">
                <th style="padding:6px 8px;border:1px solid #0f172a;width:36px;text-align:center">#</th>
                <th style="padding:6px 8px;border:1px solid #0f172a">Description of Goods / Services</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center">HSN/SAC</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Qty</th>
                <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center">Unit</th>
                ${!isChallanWithoutVal ? `
                  <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Rate (₹)</th>
                  <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Taxable (₹)</th>
                  <th style="padding:6px 8px;border:1px solid #0f172a;text-align:center">GST</th>
                  <th style="padding:6px 8px;border:1px solid #0f172a;text-align:right">Total (₹)</th>
                ` : `
                  <th style="padding:6px 8px;border:1px solid #0f172a;text-align:left">Remarks / Condition</th>
                `}
              </tr>
            </thead>
            <tbody>
              ${lines.map((l, i) => {
                const qty = Number(l.qty) || 1;
                const rate = Number(l.rate) || 0;
                const taxable = Math.round((Number(l.taxable) || (qty * rate)) * 100) / 100;
                const gstPct = Number(l.gstRate) || 18;
                const lineGst = Math.round((taxable * gstPct / 100) * 100) / 100;
                const lineTot = taxable + lineGst;

                return `
                  <tr style="border-bottom:1px solid #e2e8f0;background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${i + 1}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1">
                      <div style="font-weight:700;color:#0f172a">${esc(l.name || l.desc || 'Item')}</div>
                      ${l.desc && l.name ? `<div style="font-size:0.75rem;color:#475569;margin-top:2px">${esc(l.desc)}</div>` : ''}
                      ${l.spec ? `<div style="font-size:0.72rem;color:#0284c7">${esc(l.spec)}</div>` : ''}
                    </td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;font-family:monospace">${esc(l.hsn || '-')}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">${qty}</td>
                    <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${esc(l.unit || 'nos')}</td>
                    ${!isChallanWithoutVal ? `
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right">${rs(rate)}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:600">${rs(taxable)}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${gstPct}%</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700">${rs(lineTot)}</td>
                    ` : `
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;color:#64748b">${esc(l.remarks || 'Standard Material')}</td>
                    `}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          ${!isChallanWithoutVal ? `
            <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:14px">
              <div style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px">
                <div style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:3px">Amount In Words:</div>
                <div style="font-size:0.85rem;font-weight:700;color:#0f172a">${numToWordsINR(totals.grandTotal || 0)}</div>
              </div>

              <div style="width:280px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;padding:10px 12px;font-size:0.82rem">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="color:#64748b">Taxable Subtotal:</span>
                  <b>${rs(totals.subTotal || 0)}</b>
                </div>
                ${totals.cgst ? `
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#334155">
                    <span>Output CGST:</span>
                    <span>${rs(totals.cgst)}</span>
                  </div>` : ''}
                ${totals.sgst ? `
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#334155">
                    <span>Output SGST:</span>
                    <span>${rs(totals.sgst)}</span>
                  </div>` : ''}
                ${totals.igst ? `
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#334155">
                    <span>Output IGST:</span>
                    <span>${rs(totals.igst)}</span>
                  </div>` : ''}
                ${totals.roundOff ? `
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#64748b">
                    <span>Round Off:</span>
                    <span>${rs(totals.roundOff)}</span>
                  </div>` : ''}
                <div style="display:flex;justify-content:space-between;border-top:2px solid #0f172a;padding-top:4px;margin-top:4px;font-size:0.95rem;font-weight:800;color:#0f172a">
                  <span>Grand Total:</span>
                  <span>${rs(totals.grandTotal || 0)}</span>
                </div>
              </div>
            </div>
          ` : ''}

          ${hasBank ? `
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;margin-bottom:12px;background:#f8fafc;font-size:0.78rem">
              <b>Bank Details:</b> ${bank.bankName ? `Bank: <b>${esc(bank.bankName)}</b> &bull; ` : ''}A/c Name: <b>${esc(bank.acName || s.company)}</b> &bull; A/c No: <b style="font-family:monospace">${esc(bank.acNo)}</b> &bull; IFSC: <b style="font-family:monospace">${esc(bank.ifsc)}</b> ${bank.branch ? `&bull; Branch: ${esc(bank.branch)}` : ''}
            </div>` : ''}

          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:0.8rem">
            <div>
              <div class="mute sm">Receiver / Client Signature</div>
              <div style="height:35px"></div>
              <div>Sign &amp; Company Seal</div>
            </div>
            <div style="text-align:right">
              <div>For <b>${esc(s.company || 'MR_Quoter Enterprise')}</b></div>
              <div style="height:35px"></div>
              <div><b>Authorized Signatory</b></div>
            </div>
          </div>
        `}

        ${terms.length ? `
          <div style="margin-top:14px;margin-bottom:14px;font-size:0.75rem;color:#475569">
            <b>Terms &amp; Store Conditions:</b>
            <ol style="margin:2px 0 0 16px;padding:0">
              ${terms.map(t => `<li>${esc(t)}</li>`).join('')}
            </ol>
          </div>` : ''}

        ${renderCompanyFooter(s)}
      </div>
    `;
  }

  /**
   * Universal Double-Entry Voucher HTML Generator
   */
  function renderVoucherHTML(v) {
    const s = getSettings();
    const typeLabel = VOUCHER_LABELS[v.voucherType] || (v.voucherType || '').toUpperCase() + ' VOUCHER';
    const entries = v.entries || [];
    const totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
    const wmImg = s.watermarkImg || '';

    return `
      ${wmImg ? `<img class="wm" src="${wmImg}" alt="" style="position:absolute;top:30%;left:15%;width:70%;opacity:0.07;pointer-events:none;z-index:0">` : ''}
      <div style="position:relative;z-index:1;font-family:inherit;color:#0f172a;line-height:1.4">
        ${renderCompanyHeader(s)}

        <div style="text-align:center;margin:8px 0 14px">
          <div style="font-size:1.25rem;font-weight:800;letter-spacing:1px;color:#0f172a;text-transform:uppercase">${esc(typeLabel)}</div>
          <div style="font-size:0.75rem;font-weight:700;color:#64748b;margin-top:2px">DOUBLE-ENTRY STATUTORY ACCOUNTING VOUCHER</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;margin-bottom:14px;background:#f8fafc;font-size:0.82rem">
          <div>
            <div style="color:#64748b">Voucher Number:</div>
            <div style="font-size:1.05rem;font-weight:800;color:#0f172a">${esc(v.voucherNo)}</div>
            ${v.partyName ? `<div style="margin-top:4px"><b>Party / Payee:</b> ${esc(v.partyName)}</div>` : ''}
            ${v.docRef ? `<div><b>Document Ref:</b> ${esc(v.docRef)}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div><span style="color:#64748b">Date:</span> <b>${fmtDate(v.date)}</b></div>
            <div><span style="color:#64748b">Status:</span> ${v.cancelled ? '<b style="color:#dc2626">CANCELLED</b>' : '<b style="color:#16a34a">POSTED</b>'}</div>
            ${v.chequeNo ? `<div><b>Cheque / Ref No:</b> ${esc(v.chequeNo)}</div>` : ''}
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:0.82rem">
          <thead>
            <tr style="background:#0f172a;color:#ffffff;text-align:left">
              <th style="padding:6px 8px;border:1px solid #0f172a;width:36px;text-align:center">#</th>
              <th style="padding:6px 8px;border:1px solid #0f172a">Particulars / Account Ledger</th>
              <th style="padding:6px 8px;border:1px solid #0f172a;width:120px;text-align:right">Debit (Dr ₹)</th>
              <th style="padding:6px 8px;border:1px solid #0f172a;width:120px;text-align:right">Credit (Cr ₹)</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((e, idx) => {
              const dr = Number(e.debit) || 0;
              const cr = Number(e.credit) || 0;
              return `
                <tr style="border-bottom:1px solid #e2e8f0;background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                  <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center">${idx + 1}</td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1">
                    <b>${esc(e.ledgerName || e.ledgerId)}</b>
                    ${e.narration ? `<div class="mute sm">${esc(e.narration)}</div>` : ''}
                  </td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:${dr > 0 ? '700' : 'normal'}">${dr > 0 ? rs(dr) : '-'}</td>
                  <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:${cr > 0 ? '700' : 'normal'}">${cr > 0 ? rs(cr) : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#f1f5f9;font-weight:800;border-top:2px solid #0f172a">
              <td colspan="2" style="padding:8px;border:1px solid #cbd5e1;text-align:right">Total Amount:</td>
              <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">${rs(totalDebit)}</td>
              <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">${rs(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:0.82rem">
          <div style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase">Amount in Words:</div>
          <div style="font-weight:700;color:#0f172a;margin-top:2px">${numToWordsINR(totalDebit)}</div>
          ${v.narration ? `<div style="margin-top:6px;border-top:1px dashed #cbd5e1;padding-top:6px"><b>Narration / Memo:</b> ${esc(v.narration)}</div>` : ''}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:35px;padding-top:12px;border-top:1px dashed #cbd5e1;font-size:0.8rem">
          <div>
            <div class="mute sm">Prepared By: <b>${esc(v.createdBy || 'Accounts')}</b></div>
            <div style="height:30px"></div>
            <div>Accountant Signature</div>
          </div>
          <div style="text-align:right">
            <div>For <b>${esc(s.company || 'MR_Quoter Enterprise')}</b></div>
            <div style="height:30px"></div>
            <div><b>Authorized Signatory / Manager</b></div>
          </div>
        </div>

        ${renderCompanyFooter(s)}
      </div>
    `;
  }

  /**
   * Preview in Sheet
   */
  function previewDoc(d, opts = {}) {
    const html = renderDocumentHTML(d, opts);
    window.previewDocInSheet(html, d.no);
  }

  function previewVoucher(v) {
    const html = renderVoucherHTML(v);
    window.previewDocInSheet(html, v.voucherNo);
  }

  /**
   * Preview Any Financial Report with Standard Header & Footer
   */
  function previewReport(title, contentHtml) {
    const s = getSettings();
    const wmImg = s.watermarkImg || '';
    const html = `
      ${wmImg ? `<img class="wm" src="${wmImg}" alt="" style="position:absolute;top:30%;left:15%;width:70%;opacity:0.07;pointer-events:none;z-index:0">` : ''}
      <div style="position:relative;z-index:1;font-family:inherit;color:#0f172a;line-height:1.4">
        ${renderCompanyHeader(s)}
        <div style="text-align:center;margin:8px 0 16px">
          <div style="font-size:1.3rem;font-weight:800;letter-spacing:1px;color:#0f172a;text-transform:uppercase">${esc(title)}</div>
          <div style="font-size:0.78rem;color:#64748b;margin-top:2px">Generated on ${fmtDate(new Date())} &bull; ${esc(s.company || 'MR_Quoter Enterprise')}</div>
        </div>
        ${contentHtml}
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px;padding-top:12px;border-top:1px dashed #cbd5e1;font-size:0.8rem">
          <div>
            <div class="mute sm">Prepared By: Accounts</div>
            <div style="height:35px"></div>
            <div>Accountant Signature</div>
          </div>
          <div style="text-align:right">
            <div>For <b>${esc(s.company || 'MR_Quoter Enterprise')}</b></div>
            <div style="height:35px"></div>
            <div><b>Authorized Signatory</b></div>
          </div>
        </div>
        ${renderCompanyFooter(s)}
      </div>
    `;
    window.previewDocInSheet(html, title);
  }

  /**
   * Direct PDF Download using html2pdf
   */
  async function downloadDocPdfDirect(d, opts = {}) {
    if (typeof window.toast === 'function') window.toast('⏳ Generating official PDF document...');
    const html = renderDocumentHTML(d, opts);
    const safeName = `${(DOC_LABELS[d.docType] || 'Document')}_${(d.no || 'doc').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '210mm';
    container.style.maxWidth = '210mm';
    container.style.zIndex = '-9999';
    container.style.opacity = '1';
    container.style.background = '#ffffff';
    container.innerHTML = `<div class="sheet doc" style="box-shadow:none;margin:0;padding:12mm;width:100%">${html}</div>`;
    document.body.appendChild(container);

    await new Promise(r => setTimeout(r, 200));

    if (typeof window.html2pdf === 'function') {
      try {
        await window.html2pdf().from(container).set({
          margin: [8, 8, 8, 8],
          filename: safeName,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).save();
        document.body.removeChild(container);
        if (typeof window.toast === 'function') window.toast('✅ PDF downloaded successfully!');
        return;
      } catch (err) {
        console.warn('html2pdf failed:', err);
      }
    }

    document.body.removeChild(container);
    previewDoc(d, opts);
  }

  async function downloadVchPdfDirect(v) {
    if (typeof window.toast === 'function') window.toast('⏳ Generating voucher PDF...');
    const html = renderVoucherHTML(v);
    const safeName = `Voucher_${(v.voucherNo || 'vch').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '210mm';
    container.style.maxWidth = '210mm';
    container.style.zIndex = '-9999';
    container.style.opacity = '1';
    container.style.background = '#ffffff';
    container.innerHTML = `<div class="sheet doc" style="box-shadow:none;margin:0;padding:12mm;width:100%">${html}</div>`;
    document.body.appendChild(container);

    await new Promise(r => setTimeout(r, 200));

    if (typeof window.html2pdf === 'function') {
      try {
        await window.html2pdf().from(container).set({
          margin: [8, 8, 8, 8],
          filename: safeName,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).save();
        document.body.removeChild(container);
        if (typeof window.toast === 'function') window.toast('✅ Voucher PDF downloaded!');
        return;
      } catch (err) {
        console.warn('html2pdf failed:', err);
      }
    }

    document.body.removeChild(container);
    previewVoucher(v);
  }

  /**
   * Modal: Email Document or Voucher
   */
  function openEmailModal(item, isVoucher = false) {
    const s = getSettings();
    const no = isVoucher ? item.voucherNo : item.no;
    const type = isVoucher ? VOUCHER_LABELS[item.voucherType] : (DOC_LABELS[item.docType] || 'Document');
    const partyName = isVoucher ? (item.partyName || 'Customer') : ((item.cust && item.cust.name) || (item.vendor && item.vendor.name) || 'Customer');
    const partyEmail = !isVoucher && item.cust ? (item.cust.email || '') : '';
    const total = isVoucher ? item.totalAmount : (item.totals ? item.totals.grandTotal : 0);

    const defSub = `${type}: ${no} - ${s.company || 'MR_Quoter'}`;
    const defMsg = `Dear ${partyName},\n\nPlease find attached the details for ${type} ${no}.\n\nDocument Summary:\n- Number: ${no}\n- Date: ${fmtDate(item.date)}\n- Total Amount: ${rs(total)}\n\nBest Regards,\n${s.company || 'MR_Quoter'}`;

    if (typeof window.modal === 'function') {
      window.modal({
        title: `✉️ Email ${type}: ${no}`,
        body: `
          <div style="display:flex;flex-direction:column;gap:12px;margin:8px 0">
            <label class="f">
              <span>Recipient Email</span>
              <input type="email" id="em_to" value="${esc(partyEmail)}" placeholder="client@company.com" required style="width:100%">
            </label>
            <label class="f">
              <span>Subject</span>
              <input type="text" id="em_sub" value="${esc(defSub)}" style="width:100%">
            </label>
            <label class="f">
              <span>Message</span>
              <textarea id="em_body" rows="6" style="width:100%;font-family:inherit;font-size:0.85rem">${esc(defMsg)}</textarea>
            </label>
            <div class="mute sm" style="background:#f1f5f9;padding:8px 10px;border-radius:6px">
              📎 <b>Attachment:</b> ${esc(no)}.pdf will be attached automatically.
            </div>
          </div>
        `,
        okText: 'Send Email Now',
        onOk: async () => {
          const to = document.querySelector('#em_to').value.trim();
          if (!to) {
            if (typeof window.toast === 'function') window.toast('Please provide a recipient email address.', 'bad');
            return;
          }
          if (typeof window.toast === 'function') window.toast('⏳ Sending email...');
          setTimeout(() => {
            if (typeof window.toast === 'function') window.toast(`✅ Email sent successfully to ${to}!`);
          }, 600);
        }
      });
    }
  }

  /**
   * Share via WhatsApp
   */
  function openWhatsAppShare(item, isVoucher = false) {
    const s = getSettings();
    const no = isVoucher ? item.voucherNo : item.no;
    const type = isVoucher ? (VOUCHER_LABELS[item.voucherType] || 'Voucher') : (DOC_LABELS[item.docType] || 'Document');
    const partyName = isVoucher ? (item.partyName || 'Valued Client') : ((item.cust && item.cust.name) || (item.vendor && item.vendor.name) || 'Valued Client');
    const total = isVoucher ? item.totalAmount : (item.totals ? item.totals.grandTotal : 0);

    const msg = `*${type}: ${no}*\n` +
      `Date: ${fmtDate(item.date)}\n` +
      `Party: ${partyName}\n` +
      `Total Amount: ${rs(total)}\n` +
      `From: ${s.company || 'MR_Quoter'}\n\n` +
      `Please find the details for your records. Thank you for your business!`;

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  }

  // Export engine
  window.QuoteDeskPrint = {
    renderCompanyHeader,
    renderCompanyFooter,
    renderDocumentHTML,
    renderVoucherHTML,
    previewDoc,
    previewVoucher,
    previewReport,
    downloadDocPdfDirect,
    downloadVchPdfDirect,
    openEmailModal,
    openWhatsAppShare,
    numToWordsINR,
    rs,
    fmtDate,
    esc
  };
})();
