'use strict';
/**
 * payroll.js — Employee Master, Salary Processing & Statutory Deductions (PF / ESI / PT)
 *
 * Implements:
 *   - Employee Master with designation, department, PAN, UAN, Bank details
 *   - Salary Structure (Basic, HRA, Conveyance, Allowances)
 *   - Statutory Deductions:
 *       * Provident Fund (PF): 12% of Basic (capped at statutory limits)
 *       * Employee State Insurance (ESI): 0.75% Employee + 3.25% Employer (if gross <= 21,000)
 *       * Professional Tax (PT): Standard slab deduction
 *   - Monthly Salary Processing with automated double-entry ledger posting
 *     (Dr: Salary Expenses / Cr: Bank / Cash + PF Payable + ESI Payable + PT Payable)
 *   - Payslip generation
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees, addPaise, subPaise } = require('./paise.js');
const vouchers = require('./vouchers.js');

function round(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Create or Update Employee
 */
async function saveEmployee(companyId, empData) {
  const col = await getCollection('employees');
  const id = empData.id || ('emp_' + Math.random().toString(36).slice(2, 10));

  const doc = {
    id,
    companyId,
    empCode: String(empData.empCode || '').trim().toUpperCase(),
    name: String(empData.name || '').trim(),
    designation: String(empData.designation || 'Staff').trim(),
    department: String(empData.department || 'Operations').trim(),
    pan: String(empData.pan || '').trim().toUpperCase(),
    uan: String(empData.uan || '').trim(),
    bankAccount: String(empData.bankAccount || '').trim(),
    ifsc: String(empData.ifsc || '').trim().toUpperCase(),
    basicSalary: Number(empData.basicSalary) || 0,
    hra: Number(empData.hra) || 0,
    allowances: Number(empData.allowances) || 0,
    pfApplicable: empData.pfApplicable !== false,
    esiApplicable: !!empData.esiApplicable,
    isActive: empData.isActive !== false,
    updatedAt: Date.now()
  };

  if (!doc.name) throw new Error('Employee name is required');
  await col.replaceOne({ id, companyId }, doc, { upsert: true });
  return doc;
}

async function listEmployees(companyId) {
  const col = await getCollection('employees');
  return await col.find({ companyId, isActive: true }).toArray();
}

/**
 * Process Monthly Payroll for an Employee
 */
function calculateSalarySlip(employee, daysWorked = 30, totalDays = 30) {
  const factor = totalDays > 0 ? (daysWorked / totalDays) : 1;
  const basic = round((employee.basicSalary || 0) * factor);
  const hra = round((employee.hra || 0) * factor);
  const allowances = round((employee.allowances || 0) * factor);
  const grossSalary = round(basic + hra + allowances);

  // Deductions
  let pfDeduction = 0;
  if (employee.pfApplicable) {
    const pfBase = Math.min(basic, 15000); // statutory limit 15,000 for standard PF
    pfDeduction = round(pfBase * 0.12);
  }

  let esiDeduction = 0;
  if (employee.esiApplicable && grossSalary <= 21000) {
    esiDeduction = round(grossSalary * 0.0075);
  }

  let ptDeduction = 0;
  if (grossSalary > 15000) ptDeduction = 200; // standard slab

  const totalDeductions = round(pfDeduction + esiDeduction + ptDeduction);
  const netSalary = round(grossSalary - totalDeductions);

  return {
    employeeId: employee.id,
    empCode: employee.empCode,
    name: employee.name,
    designation: employee.designation,
    daysWorked,
    totalDays,
    earnings: { basic, hra, allowances, grossSalary },
    deductions: { pf: pfDeduction, esi: esiDeduction, pt: ptDeduction, total: totalDeductions },
    netSalary
  };
}

/**
 * Post Monthly Payroll to Double-Entry Accounts
 */
async function processMonthlyPayroll(companyId, params = {}) {
  const { month, year, date = new Date().toISOString().slice(0, 10), user = {} } = params;
  const employees = await listEmployees(companyId);
  if (employees.length === 0) throw new Error('No active employees found to process payroll.');

  const slips = [];
  let totalGross = 0;
  let totalPf = 0;
  let totalEsi = 0;
  let totalPt = 0;
  let totalNet = 0;

  for (const emp of employees) {
    const slip = calculateSalarySlip(emp);
    slips.push(slip);
    totalGross += slip.earnings.grossSalary;
    totalPf += slip.deductions.pf;
    totalEsi += slip.deductions.esi;
    totalPt += slip.deductions.pt;
    totalNet += slip.netSalary;
  }

  totalGross = round(totalGross);
  totalPf = round(totalPf);
  totalEsi = round(totalEsi);
  totalPt = round(totalPt);
  totalNet = round(totalNet);

  // Double-entry balancing entries:
  // Dr: Salary Expenses (totalGross)
  // Cr: Primary Bank Account (totalNet)
  // Cr: PF Payable (totalPf)
  // Cr: Labour Cess / Statutory Deductions Payable (totalEsi + totalPt)
  const entries = [
    {
      ledgerId: 'led_contractor_charges', // Or dedicated Salary Ledger
      ledgerName: 'Staff & Labour Salary Expenses',
      debit: totalGross,
      credit: 0
    },
    {
      ledgerId: 'led_bank_default',
      ledgerName: 'Primary Bank Account (Salary Disbursement)',
      debit: 0,
      credit: totalNet
    }
  ];

  if (totalPf > 0) {
    entries.push({
      ledgerId: 'led_tds_pay_194c',
      ledgerName: 'Employee PF / Statutory Payable',
      debit: 0,
      credit: totalPf
    });
  }

  const statBal = round(totalEsi + totalPt);
  if (statBal > 0) {
    entries.push({
      ledgerId: 'led_labour_cess_pay',
      ledgerName: 'Labour Welfare / PT Payable',
      debit: 0,
      credit: statBal
    });
  }

  // Adjust any sub-paise round-off
  const currentTotalCr = entries.reduce((sum, e) => sum + (e.credit || 0), 0);
  const diff = round(totalGross - currentTotalCr);
  if (diff !== 0) {
    entries[1].credit = round(entries[1].credit + diff);
  }

  const voucher = await vouchers.createVoucher({
    companyId,
    voucherType: 'payment',
    date,
    narration: `Monthly Salary & Statutory Disbursement for ${month || ''} ${year || ''} (${employees.length} employees)`,
    entries
  }, user);

  // Store payroll summary record
  const payrollCol = await getCollection('payroll_runs');
  const record = {
    id: 'pay_' + Math.random().toString(36).slice(2, 10),
    companyId,
    month,
    year,
    date,
    employeeCount: employees.length,
    totalGross,
    totalNet,
    totalPf,
    totalEsi,
    totalPt,
    voucherId: voucher.id,
    voucherNo: voucher.voucherNo,
    slips,
    processedAt: Date.now()
  };
  await payrollCol.insertOne(record);

  return record;
}

module.exports = {
  saveEmployee,
  listEmployees,
  calculateSalarySlip,
  processMonthlyPayroll
};
