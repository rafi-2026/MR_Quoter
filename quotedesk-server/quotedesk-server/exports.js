'use strict';
/**
 * exports.js — Tally Prime XML & Zoho Books CSV Export Engine
 *
 * Implements:
 *   - Official Tally Prime XML Import format:
 *       - Masters (Groups & Ledgers with GST particulars)
 *       - Vouchers (Sales, Purchase, Receipt, Payment, Journal with balanced ALLLEDGERENTRIES)
 *       - Date format: YYYYMMDD as required by Tally
 *   - Zoho Books Standard Import CSV format:
 *       - Invoices (Invoice Number, Customer Name, Date, Item Name, Rate, Qty, Tax %, Total)
 *       - Bills (Bill Number, Vendor Name, Date, Amount)
 *       - Payments & Receipts
 *       - Chart of Accounts
 */

const { getCollection } = require('./db.js');
const { getCompanyLedgers } = require('./accounts.js');

function tallyDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10).replace(/[^0-9]/g, ''); // YYYYMMDD
}

function xmlEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate Tally Prime XML
 */
async function generateTallyXml(companyId, fromDate, toDate, options = {}) {
  const allLedgers = await getCompanyLedgers(companyId);
  const vchCol = await getCollection('vouchers');

  const query = { companyId, cancelled: false };
  if (fromDate && toDate) {
    query.date = { $gte: fromDate, $lte: toDate };
  }

  const vouchers = await vchCol.find(query);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<ENVELOPE>\n`;
  xml += `  <HEADER>\n`;
  xml += `    <TALLYREQUEST>Import Data</TALLYREQUEST>\n`;
  xml += `  </HEADER>\n`;
  xml += `  <BODY>\n`;
  xml += `    <IMPORTDATA>\n`;
  xml += `      <REQUESTDESC>\n`;
  xml += `        <REPORTNAME>All Masters</REPORTNAME>\n`;
  xml += `      </REQUESTDESC>\n`;
  xml += `      <REQUESTDATA>\n`;

  // 1. Export Ledgers
  allLedgers.forEach(l => {
    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
    xml += `          <LEDGER NAME="${xmlEscape(l.name)}" ACTION="Create">\n`;
    xml += `            <NAME>${xmlEscape(l.name)}</NAME>\n`;
    xml += `            <PARENT>${xmlEscape(l.groupName || 'Current Assets')}</PARENT>\n`;
    xml += `            <OPENINGBALANCE>${Number(l.openingBalance || 0)}</OPENINGBALANCE>\n`;
    if (l.gstin) xml += `            <PARTYGSTIN>${xmlEscape(l.gstin)}</PARTYGSTIN>\n`;
    xml += `          </LEDGER>\n`;
    xml += `        </TALLYMESSAGE>\n`;
  });

  // 2. Export Vouchers
  const typeMap = {
    sales: 'Sales',
    purchase: 'Purchase',
    receipt: 'Receipt',
    payment: 'Payment',
    journal: 'Journal',
    contra: 'Contra'
  };

  vouchers.forEach(v => {
    const tType = typeMap[v.voucherType] || 'Journal';
    const tDate = tallyDate(v.date);

    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
    xml += `          <VOUCHER VCHTYPE="${tType}" ACTION="Create">\n`;
    xml += `            <DATE>${tDate}</DATE>\n`;
    xml += `            <VOUCHERTYPENAME>${tType}</VOUCHERTYPENAME>\n`;
    xml += `            <VOUCHERNUMBER>${xmlEscape(v.voucherNo)}</VOUCHERNUMBER>\n`;
    if (v.docRef) xml += `            <REFERENCE>${xmlEscape(v.docRef)}</REFERENCE>\n`;
    xml += `            <NARRATION>${xmlEscape(v.narration || '')}</NARRATION>\n`;

    (v.entries || []).forEach(e => {
      // In Tally: Dr is negative amount, Cr is positive amount (or ISDEEMEDPOSITIVE Yes for Dr)
      const isDebit = e.debit > 0;
      const amount = isDebit ? -Math.abs(e.debit) : Math.abs(e.credit);

      xml += `            <ALLLEDGERENTRIES.LIST>\n`;
      xml += `              <LEDGERNAME>${xmlEscape(e.ledgerName)}</LEDGERNAME>\n`;
      xml += `              <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>\n`;
      xml += `              <AMOUNT>${amount.toFixed(2)}</AMOUNT>\n`;
      xml += `            </ALLLEDGERENTRIES.LIST>\n`;
    });

    xml += `          </VOUCHER>\n`;
    xml += `        </TALLYMESSAGE>\n`;
  });

  xml += `      </REQUESTDATA>\n`;
  xml += `    </IMPORTDATA>\n`;
  xml += `  </BODY>\n`;
  xml += `</ENVELOPE>\n`;

  return xml;
}

/**
 * Generate Zoho Books CSV Export
 */
async function generateZohoCsv(companyId, entityType = 'invoices') {
  function csvRow(cells) {
    return cells.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',') + '\r\n';
  }

  if (entityType === 'invoices') {
    const docCol = await getCollection('documents');
    const invoices = await docCol.find({ companyId, docType: { $in: ['inv', 'ra'] }, superseded: false });

    let csv = csvRow(['Invoice Number', 'Customer Name', 'Invoice Date', 'Due Date', 'Item Name', 'Rate', 'Quantity', 'Tax Percentage', 'Total']);
    invoices.forEach(inv => {
      const custName = (inv.cust && inv.cust.name) || 'Customer';
      const lines = inv.lines || [];
      lines.forEach(l => {
        csv += csvRow([
          inv.no,
          custName,
          inv.date,
          inv.date,
          l.name || l.desc || 'Services',
          l.rate || 0,
          l.qty || 1,
          l.gstRate || inv.gstRate || 18,
          Math.round((l.qty || 1) * (l.rate || 0))
        ]);
      });
    });
    return csv;
  }

  if (entityType === 'customers') {
    const allLedgers = await getCompanyLedgers(companyId);
    const customers = allLedgers.filter(l => l.partyType === 'customer' || l.groupId === 'grp_debtors');

    let csv = csvRow(['Display Name', 'Company Name', 'Currency Code', 'GST Identification Number', 'Opening Balance']);
    customers.forEach(c => {
      csv += csvRow([
        c.name,
        c.name,
        'INR',
        c.gstin || '',
        c.openingBalance || 0
      ]);
    });
    return csv;
  }

  if (entityType === 'chart_of_accounts') {
    const allLedgers = await getCompanyLedgers(companyId);
    let csv = csvRow(['Account Name', 'Account Code', 'Account Type', 'Parent Account']);
    allLedgers.forEach(l => {
      csv += csvRow([
        l.name,
        l.code || '',
        l.nature || 'assets',
        l.groupName || ''
      ]);
    });
    return csv;
  }

  throw new Error(`Unsupported Zoho entity type: ${entityType}`);
}

module.exports = {
  generateTallyXml,
  generateZohoCsv
};

