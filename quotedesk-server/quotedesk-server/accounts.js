'use strict';
/**
 * accounts.js — Chart of Accounts, Groups & Ledger Master for MR_Quoter
 *
 * Implements standard Tally-compatible groups and system ledgers:
 * - Groups: Capital, Current Assets, Bank Accounts, Cash-in-hand, Sundry Debtors,
 *           Current Liabilities, Sundry Creditors, Duties & Taxes, Direct/Indirect Income & Expense,
 *           Suspense A/c, Fixed Assets.
 * - Multi-tenant by companyId.
 * - Links existing Customers & Vendors dynamically without duplicating master records.
 * - Opening balance tracking (Dr / Cr).
 */

const { getCollection } = require('./db.js');

const STANDARD_GROUPS = [
  { id: 'grp_capital', name: 'Capital Account', nature: 'liabilities', isPrimary: true },
  { id: 'grp_loans_liab', name: 'Loans (Liability)', nature: 'liabilities', isPrimary: true },
  { id: 'grp_curr_liab', name: 'Current Liabilities', nature: 'liabilities', isPrimary: true },
  { id: 'grp_creditors', name: 'Sundry Creditors', nature: 'liabilities', parent: 'grp_curr_liab' },
  { id: 'grp_taxes', name: 'Duties & Taxes', nature: 'liabilities', parent: 'grp_curr_liab' },
  { id: 'grp_provisions', name: 'Provisions', nature: 'liabilities', parent: 'grp_curr_liab' },

  { id: 'grp_fixed_assets', name: 'Fixed Assets', nature: 'assets', isPrimary: true },
  { id: 'grp_curr_assets', name: 'Current Assets', nature: 'assets', isPrimary: true },
  { id: 'grp_debtors', name: 'Sundry Debtors', nature: 'assets', parent: 'grp_curr_assets' },
  { id: 'grp_bank', name: 'Bank Accounts', nature: 'assets', parent: 'grp_curr_assets' },
  { id: 'grp_cash', name: 'Cash-in-Hand', nature: 'assets', parent: 'grp_curr_assets' },
  { id: 'grp_stock', name: 'Stock-in-Hand', nature: 'assets', parent: 'grp_curr_assets' },
  { id: 'grp_advances', name: 'Loans & Advances (Asset)', nature: 'assets', parent: 'grp_curr_assets' },

  { id: 'grp_sales', name: 'Sales Accounts / Direct Income', nature: 'income', isPrimary: true },
  { id: 'grp_indir_income', name: 'Indirect Income', nature: 'income', isPrimary: true },

  { id: 'grp_purchases', name: 'Purchase Accounts / Direct Expenses', nature: 'expenses', isPrimary: true },
  { id: 'grp_indir_expenses', name: 'Indirect Expenses', nature: 'expenses', isPrimary: true },

  { id: 'grp_suspense', name: 'Suspense A/c', nature: 'liabilities', isPrimary: true }
];

const DEFAULT_SYSTEM_LEDGERS = [
  { id: 'led_cash', name: 'Cash in Hand', code: 'CASH', groupId: 'grp_cash', groupName: 'Cash-in-Hand', nature: 'assets', isSystem: true },
  { id: 'led_bank_default', name: 'Primary Bank Account', code: 'BANK', groupId: 'grp_bank', groupName: 'Bank Accounts', nature: 'assets', isSystem: true },

  { id: 'led_sales_goods', name: 'Sales of Materials / Goods', code: 'SALES_G', groupId: 'grp_sales', groupName: 'Sales Accounts', nature: 'income', isSystem: true },
  { id: 'led_sales_services', name: 'Works Contract / Fabrication Services', code: 'SALES_S', groupId: 'grp_sales', groupName: 'Sales Accounts', nature: 'income', isSystem: true },

  { id: 'led_purchases_raw', name: 'Raw Material Purchases', code: 'PURCH_RAW', groupId: 'grp_purchases', groupName: 'Purchase Accounts', nature: 'expenses', isSystem: true },
  { id: 'led_contractor_charges', name: 'Subcontractor / Labour Charges', code: 'EXP_LABOUR', groupId: 'grp_purchases', groupName: 'Purchase Accounts', nature: 'expenses', isSystem: true },

  // GST Output Taxes (Liability)
  { id: 'led_cgst_out', name: 'Output CGST', code: 'CGST_OUT', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'liabilities', isSystem: true },
  { id: 'led_sgst_out', name: 'Output SGST', code: 'SGST_OUT', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'liabilities', isSystem: true },
  { id: 'led_igst_out', name: 'Output IGST', code: 'IGST_OUT', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'liabilities', isSystem: true },

  // GST Input Taxes (Current Assets / ITC)
  { id: 'led_cgst_in', name: 'Input CGST', code: 'CGST_IN', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'assets', isSystem: true },
  { id: 'led_sgst_in', name: 'Input SGST', code: 'SGST_IN', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'assets', isSystem: true },
  { id: 'led_igst_in', name: 'Input IGST', code: 'IGST_IN', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'assets', isSystem: true },

  // Contractor Statutory Deductions
  { id: 'led_tds_pay_194c', name: 'TDS Payable u/s 194C', code: 'TDS_194C', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'liabilities', isSystem: true },
  { id: 'led_tds_rec', name: 'TDS Receivable (Tax Deducted by Clients)', code: 'TDS_REC', groupId: 'grp_curr_assets', groupName: 'Current Assets', nature: 'assets', isSystem: true },
  { id: 'led_labour_cess_pay', name: 'Labour Welfare Cess Payable (1%)', code: 'CESS_PAY', groupId: 'grp_taxes', groupName: 'Duties & Taxes', nature: 'liabilities', isSystem: true },
  { id: 'led_retention_rec', name: 'Retention Money Receivable (Security Deposit)', code: 'RET_REC', groupId: 'grp_curr_assets', groupName: 'Current Assets', nature: 'assets', isSystem: true },
  { id: 'led_adv_liability', name: 'Mobilisation Advance Received', code: 'ADV_LIAB', groupId: 'grp_curr_liab', groupName: 'Current Liabilities', nature: 'liabilities', isSystem: true },

  // General & Adjustments
  { id: 'led_round_off', name: 'Round Off Adjustment', code: 'ROUND_OFF', groupId: 'grp_indir_expenses', groupName: 'Indirect Expenses', nature: 'expenses', isSystem: true },
  { id: 'led_suspense', name: 'Suspense Account (Unallocated Bank / Audit)', code: 'SUSPENSE', groupId: 'grp_suspense', groupName: 'Suspense A/c', nature: 'liabilities', isSystem: true },
  { id: 'led_capital_main', name: 'Proprietor / Partner Capital Account', code: 'CAPITAL', groupId: 'grp_capital', groupName: 'Capital Account', nature: 'liabilities', isSystem: true }
];

/**
 * Initialize chart of accounts for a given company
 */
async function initCompanyAccounts(companyId) {
  const col = await getCollection('accounts');
  const existing = await col.find({ companyId }).toArray();

  if (existing.length === 0) {
    const toInsert = DEFAULT_SYSTEM_LEDGERS.map(l => ({
      ...l,
      companyId,
      openingBalance: 0,
      openingBalanceType: l.nature === 'assets' || l.nature === 'expenses' ? 'Dr' : 'Cr',
      createdAt: Date.now()
    }));

    for (const doc of toInsert) {
      await col.insertOne(doc);
    }
    return toInsert;
  }
  return existing;
}

/**
 * Get all ledgers for a company (including linked customer/vendor virtual ledgers)
 */
async function getCompanyLedgers(companyId, rawCustomers = [], rawVendors = []) {
  const col = await getCollection('accounts');
  let ledgers = await col.find({ companyId }).toArray();

  if (ledgers.length === 0) {
    ledgers = await initCompanyAccounts(companyId);
  }

  // Map existing customers to Sundry Debtors
  const customerLedgers = rawCustomers.map(c => ({
    id: `led_cust_${c.id}`,
    name: c.name,
    code: c.code || '',
    groupId: 'grp_debtors',
    groupName: 'Sundry Debtors',
    nature: 'assets',
    isParty: true,
    partyType: 'customer',
    partyId: c.id,
    gstin: c.gstin || '',
    phone: c.phone || '',
    companyId,
    openingBalance: Number(c.openingBalance) || 0,
    openingBalanceType: 'Dr'
  }));

  // Map existing vendors to Sundry Creditors
  const vendorLedgers = rawVendors.map(v => ({
    id: `led_vend_${v.id}`,
    name: v.name,
    code: v.code || '',
    groupId: 'grp_creditors',
    groupName: 'Sundry Creditors',
    nature: 'liabilities',
    isParty: true,
    partyType: 'vendor',
    partyId: v.id,
    gstin: v.gstin || '',
    phone: v.phone || '',
    companyId,
    openingBalance: Number(v.openingBalance) || 0,
    openingBalanceType: 'Cr'
  }));

  return [...ledgers, ...customerLedgers, ...vendorLedgers];
}

/**
 * Create a custom user ledger
 */
async function createLedger(companyId, data) {
  const col = await getCollection('accounts');
  const group = STANDARD_GROUPS.find(g => g.id === data.groupId) || STANDARD_GROUPS[1];

  const ledger = {
    id: 'led_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    code: String(data.code || '').trim().toUpperCase(),
    groupId: group.id,
    groupName: group.name,
    nature: group.nature,
    companyId,
    openingBalance: Number(data.openingBalance) || 0,
    openingBalanceType: data.openingBalanceType || (group.nature === 'assets' || group.nature === 'expenses' ? 'Dr' : 'Cr'),
    isSystem: false,
    createdAt: Date.now()
  };

  if (!ledger.name) {
    throw new Error('Ledger name is required');
  }

  await col.insertOne(ledger);
  return ledger;
}

module.exports = {
  STANDARD_GROUPS,
  DEFAULT_SYSTEM_LEDGERS,
  initCompanyAccounts,
  getCompanyLedgers,
  createLedger
};

