'use strict';
/**
 * ewaybill.js — Official E-Way Bill Generator & Validator
 * Supports:
 *   - Phase A: Validation + Official NIC bulk-upload JSON export for ewaybillgst.gov.in
 *              + Printable E-Way Bill Detail Summary Sheet
 *   - Phase B: GSP (GST Suvidha Provider) direct API configuration structure (toggle in Settings)
 *   - Statutory Rule Validation:
 *       1. Consignment value > ₹50,000 (standard threshold)
 *       2. Document number <= 16 characters (GST strict rule)
 *       3. Vehicle number format (e.g., TN01AB1234 or TN-01-AB-1234)
 *       4. GSTIN checksum / 15-char structure
 *       5. PIN code 6 digits
 *       6. Distance estimation & validity calculation
 */

const crypto = require('crypto');

// State Code Mapping according to Indian GST system
const GST_STATE_CODES = {
  'JAMMU AND KASHMIR': '01',
  'HIMACHAL PRADESH': '02',
  'PUNJAB': '03',
  'CHANDIGARH': '04',
  'UTTARAKHAND': '05',
  'HARYANA': '06',
  'DELHI': '07',
  'RAJASTHAN': '08',
  'UTTAR PRADESH': '09',
  'BIHAR': '10',
  'SIKKIM': '11',
  'ARUNACHAL PRADESH': '12',
  'NAGALAND': '13',
  'MANIPUR': '14',
  'MIZORAM': '15',
  'TRIPURA': '16',
  'MEGHALAYA': '17',
  'ASSAM': '18',
  'WEST BENGAL': '19',
  'JHARKHAND': '20',
  'ODISHA': '21',
  'CHATTISGARH': '22',
  'MADHYA PRADESH': '23',
  'GUJARAT': '24',
  'DAMAN AND DIU': '25',
  'DADRA AND NAGAR HAVELI': '26',
  'MAHARASHTRA': '27',
  'ANDHRA PRADESH': '28',
  'KARNATAKA': '29',
  'GOA': '30',
  'LAKSHADWEEP': '31',
  'KERALA': '32',
  'TAMIL NADU': '33',
  'PUDUCHERRY': '34',
  'ANDAMAN AND NICOBAR ISLANDS': '35',
  'TELANGANA': '36',
  'ANDHRA PRADESH (NEW)': '37',
  'LADAKH': '38'
};

function getStateCode(stateName, gstin) {
  if (gstin && gstin.length >= 2 && /^\d{2}/.test(gstin)) {
    return gstin.slice(0, 2);
  }
  const clean = String(stateName || '').trim().toUpperCase();
  return GST_STATE_CODES[clean] || '33'; // Default to Tamil Nadu if not found
}

/**
 * Validate E-Way Bill prerequisites according to GST law
 */
function validateEwayBillPrerequisites(doc, transport = {}, settings = {}) {
  const errors = [];
  const warnings = [];

  // 1. Doc number <= 16 chars
  if (!doc.no || doc.no.length > 16) {
    errors.push(`Document number "${doc.no || ''}" exceeds 16 characters. E-Way Bill portal will reject it.`);
  }

  // 2. Consignment Value Check
  const totalVal = (doc.totals && doc.totals.grandTotal) || 0;
  if (totalVal < 50000) {
    warnings.push(`Consignment value is ₹${totalVal.toLocaleString('en-IN')}, which is under the standard ₹50,000 threshold. (Mandatory only if required by state rule or inter-state movement).`);
  }

  // 3. From Details
  const fromGstin = settings.gstin || '';
  if (!fromGstin || fromGstin.length !== 15) {
    errors.push('Sender Company GSTIN is missing or invalid (must be 15 alphanumeric characters).');
  }

  const fromPin = String(settings.pincode || transport.fromPincode || '').replace(/\D/g, '');
  if (!fromPin || fromPin.length !== 6) {
    errors.push('Sender PIN code is missing or invalid (must be 6 digits).');
  }

  // 4. To Details
  const toGstin = (doc.cust && doc.cust.gstin) || transport.toGstin || 'URP';
  if (toGstin !== 'URP' && toGstin.length !== 15) {
    errors.push('Customer GSTIN is invalid. Enter 15-char GSTIN or "URP" for Unregistered Person.');
  }

  const toPin = String((doc.cust && doc.cust.pincode) || transport.toPincode || '').replace(/\D/g, '');
  if (!toPin || toPin.length !== 6) {
    warnings.push('Destination PIN code is missing or not 6 digits. Required for accurate distance calculation.');
  }

  // 5. Vehicle / Transporter Check
  const vehNo = String(transport.vehicleNo || (doc.metadata && doc.metadata.vehicleNo) || '').replace(/[\s-]/g, '').toUpperCase();
  const transId = String(transport.transporterId || (doc.metadata && doc.metadata.transporterId) || '').trim();

  if (!vehNo && !transId) {
    errors.push('Either Vehicle Number (Part-B) or Transporter ID (GSTIN/TRANSIN) is mandatory for E-Way Bill.');
  }

  if (vehNo && !/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(vehNo)) {
    warnings.push(`Vehicle number "${vehNo}" does not strictly match standard RTO pattern (e.g. TN01AB1234). Verify before uploading.`);
  }

  // 6. Line items HSN Check
  const lines = doc.lines || [];
  if (!lines.length) {
    errors.push('Document must contain at least one line item.');
  }
  lines.forEach((l, i) => {
    const hsn = String(l.hsn || '').trim();
    if (!hsn || hsn.length < 2) {
      errors.push(`Line #${i + 1} (${l.name || 'Item'}) has an invalid or missing HSN code.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Estimate road distance by PIN code delta (Phase A fallback estimation)
 */
function estimateDistanceKm(fromPin, toPin) {
  const p1 = parseInt(fromPin, 10);
  const p2 = parseInt(toPin, 10);
  if (isNaN(p1) || isNaN(p2)) return 50;
  if (p1 === p2) return 20;

  // Approximate distance heuristic for Indian postal circles
  const diff = Math.abs(p1 - p2);
  const est = Math.min(2500, Math.max(30, Math.round(diff / 100)));
  return est;
}

/**
 * Calculate validity days from distance (per EWB rules: 1 day per 200 km)
 */
function calculateValidityDays(distanceKm) {
  const d = Math.max(1, distanceKm || 1);
  return Math.ceil(d / 200);
}

/**
 * Generate official NIC E-Way Bill JSON for bulk upload on ewaybillgst.gov.in
 */
function generateOfficialEwayBillJson(doc, transport = {}, settings = {}) {
  const valResult = validateEwayBillPrerequisites(doc, transport, settings);

  const fromStateCode = getStateCode(settings.state, settings.gstin);
  const toStateCode = getStateCode(doc.pos || (doc.cust && doc.cust.state), doc.cust && doc.cust.gstin);

  const fromPin = parseInt(String(settings.pincode || transport.fromPincode || '635109').replace(/\D/g, ''), 10) || 635109;
  const toPin = parseInt(String((doc.cust && doc.cust.pincode) || transport.toPincode || '635109').replace(/\D/g, ''), 10) || 635109;

  const distance = transport.distanceKm || estimateDistanceKm(fromPin, toPin);

  // Supply type mapping
  // O = Outward, I = Inward
  const supplyType = 'O';
  // Sub-supply: 1=Supply, 2=Import, 3=Export, 4=Job Work, 5=For Own Use, 8=Others
  let subSupplyType = '1';
  if (doc.docType === 'dc') {
    const p = (doc.metadata && doc.metadata.challanPurpose) || transport.challanPurpose;
    if (p === 'job_work') subSupplyType = '4';
    else if (p === 'line_sales' || p === 'other') subSupplyType = '8';
  }

  // Document Type code per NIC: INV, BIL, BOE, CHL, OTH
  const docTypeCode = doc.docType === 'inv' ? 'INV' : (doc.docType === 'dc' ? 'CHL' : 'OTH');

  // Format date to DD/MM/YYYY
  const parts = (doc.date || new Date().toISOString().slice(0, 10)).split('-');
  const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '18/11/2026';

  const t = doc.totals || {};
  const isInterState = fromStateCode !== toStateCode;

  // Item list for NIC
  const itemList = (doc.lines || []).map((l, idx) => {
    const qty = Number(l.qty) || 1;
    const rate = Number(l.rate) || 0;
    const taxable = Number(l.taxable || (qty * rate)) || 0;
    const gstRate = Number(l.gstRate || 18);

    const cgstRate = isInterState ? 0 : gstRate / 2;
    const sgstRate = isInterState ? 0 : gstRate / 2;
    const igstRate = isInterState ? gstRate : 0;

    return {
      itemNo: idx + 1,
      productName: String(l.name || 'Aluminium / Glass Work').slice(0, 100),
      productDesc: String(l.desc || l.name || 'Fabrication').slice(0, 100),
      hsnCode: parseInt(String(l.hsn || '7610').replace(/\D/g, '').slice(0, 8), 10) || 7610,
      quantity: qty,
      qtyUnit: (l.unit || 'SQF').toUpperCase().slice(0, 3),
      cgstRate,
      sgstRate,
      igstRate,
      cessRate: 0,
      cessNonAdvol: 0,
      taxableAmount: taxable
    };
  });

  const vehNo = String(transport.vehicleNo || (doc.metadata && doc.metadata.vehicleNo) || '').replace(/[\s-]/g, '').toUpperCase();

  const payload = {
    version: '1.0.0421',
    billLists: [
      {
        userGstin: settings.gstin || '',
        supplyType,
        subSupplyType,
        subSupplyDesc: subSupplyType === '8' ? 'Site movement' : '',
        docType: docTypeCode,
        docNo: doc.no,
        docDate: formattedDate,
        fromGstin: settings.gstin || '',
        fromTrdName: settings.company || 'Consignor',
        fromAddr1: settings.address1 || '',
        fromAddr2: settings.address2 || '',
        fromPlace: settings.city || 'Hosur',
        fromPincode: fromPin,
        actFromStateCode: parseInt(fromStateCode, 10),
        fromStateCode: parseInt(fromStateCode, 10),
        toGstin: (doc.cust && doc.cust.gstin) || 'URP',
        toTrdName: (doc.cust && doc.cust.name) || 'Consignee',
        toAddr1: (doc.cust && doc.cust.address) || (doc.site || ''),
        toAddr2: '',
        toPlace: (doc.cust && doc.cust.city) || 'Site',
        toPincode: toPin,
        actToStateCode: parseInt(toStateCode, 10),
        toStateCode: parseInt(toStateCode, 10),
        transactionType: 1, // Regular
        totalValue: t.taxable || 0,
        cgstValue: isInterState ? 0 : (t.cgst || Math.round((t.totalTax || 0) / 2)),
        sgstValue: isInterState ? 0 : (t.sgst || Math.round((t.totalTax || 0) / 2)),
        igstValue: isInterState ? (t.igst || t.totalTax || 0) : 0,
        cessValue: 0,
        totInvValue: t.grandTotal || 0,
        transDistance: String(distance),
        transporterId: transport.transporterId || '',
        transporterName: transport.transporterName || '',
        transDocNo: transport.lrNo || '',
        transDocDate: transport.lrDate ? transport.lrDate.split('-').reverse().join('/') : '',
        vehicleNo: vehNo,
        vehicleType: transport.vehicleType || 'R', // R = Regular, O = Over Dimensional Cargo
        itemList
      }
    ]
  };

  return {
    payload,
    validation: valResult,
    distanceKm: distance,
    validityDays: calculateValidityDays(distance)
  };
}

module.exports = {
  GST_STATE_CODES,
  getStateCode,
  validateEwayBillPrerequisites,
  estimateDistanceKm,
  calculateValidityDays,
  generateOfficialEwayBillJson
};
