'use strict';
/**
 * bill-allocations.js — Bill-by-Bill Allocation Engine
 *
 * Implements Tally-style bill settlement methods:
 *   - Agst Ref: Adjust payment/receipt against an existing invoice/bill
 *   - New Ref: New invoice creating a receivable/payable reference
 *   - Advance: Advance payment/receipt before invoice generation
 *   - On Account: General payment without specific invoice allocation
 *
 * Tracks open balances, settled amounts, and outstanding items per party.
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees, subPaise, addPaise } = require('./paise.js');

/**
 * Record a bill allocation on voucher posting
 * @param {string} companyId
 * @param {object} alloc
 *   - voucherId, voucherNo, voucherType, date, partyId, partyName,
 *   - type ('Agst Ref' | 'New Ref' | 'Advance' | 'On Account')
 *   - refNo (invoice / bill number)
 *   - againstVoucherId (optional target voucher)
 *   - amount (in rupees or paise)
 */
async function recordAllocation(companyId, alloc) {
  const col = await getCollection('bill_allocations');
  const amountPaise = alloc.amountPaise !== undefined ? alloc.amountPaise : toPaise(alloc.amount);

  const doc = {
    id: 'alloc_' + Math.random().toString(36).slice(2, 11),
    companyId,
    voucherId: alloc.voucherId,
    voucherNo: alloc.voucherNo,
    voucherType: alloc.voucherType,
    date: alloc.date || new Date().toISOString().slice(0, 10),
    partyId: alloc.partyId,
    partyName: alloc.partyName || '',
    type: alloc.type || 'Agst Ref',
    refNo: alloc.refNo || alloc.voucherNo,
    againstVoucherId: alloc.againstVoucherId || null,
    amountPaise,
    amount: toRupees(amountPaise),
    createdAt: Date.now()
  };

  await col.insertOne(doc);
  return doc;
}

/**
 * Get all open / outstanding bills for a party (Customer or Supplier)
 * Compares New Ref debits/credits against Agst Ref settlements.
 */
async function getPartyOutstanding(companyId, partyId) {
  const col = await getCollection('bill_allocations');
  const allocs = await col.find({ companyId, partyId }).toArray();

  const billsMap = new Map();

  for (const a of allocs) {
    const key = a.refNo || a.voucherNo;
    if (!billsMap.has(key)) {
      billsMap.set(key, {
        refNo: key,
        partyId: a.partyId,
        partyName: a.partyName,
        initialDate: a.date,
        voucherType: a.voucherType,
        totalPaise: 0,
        settledPaise: 0,
        pendingPaise: 0,
        allocations: []
      });
    }

    const item = billsMap.get(key);
    item.allocations.push(a);

    if (a.type === 'New Ref' || (!a.againstVoucherId && (a.voucherType === 'sales' || a.voucherType === 'purchase'))) {
      item.totalPaise = addPaise(item.totalPaise, a.amountPaise);
    } else if (a.type === 'Agst Ref' || a.againstVoucherId) {
      item.settledPaise = addPaise(item.settledPaise, a.amountPaise);
    }
  }

  // Calculate pending amounts and convert to presentation rupees
  const results = [];
  for (const b of billsMap.values()) {
    b.pendingPaise = subPaise(b.totalPaise, b.settledPaise);
    b.totalAmount = toRupees(b.totalPaise);
    b.settledAmount = toRupees(b.settledPaise);
    b.pendingAmount = toRupees(b.pendingPaise);
    b.isSettled = b.pendingPaise <= 0;
    results.push(b);
  }

  return results;
}

/**
 * Get total outstanding receivables (Debtors) or payables (Creditors) summary
 */
async function getOutstandingSummary(companyId, partyType = 'all') {
  const col = await getCollection('bill_allocations');
  const allocs = await col.find({ companyId }).toArray();

  const partySummary = new Map();

  for (const a of allocs) {
    if (!a.partyId) continue;
    if (!partySummary.has(a.partyId)) {
      partySummary.set(a.partyId, {
        partyId: a.partyId,
        partyName: a.partyName,
        totalInvoicedPaise: 0,
        totalSettledPaise: 0,
        netPendingPaise: 0
      });
    }

    const s = partySummary.get(a.partyId);
    if (a.type === 'New Ref' || (!a.againstVoucherId && (a.voucherType === 'sales' || a.voucherType === 'purchase'))) {
      s.totalInvoicedPaise = addPaise(s.totalInvoicedPaise, a.amountPaise);
    } else if (a.type === 'Agst Ref' || a.againstVoucherId) {
      s.totalSettledPaise = addPaise(s.totalSettledPaise, a.amountPaise);
    }
  }

  const list = [];
  for (const s of partySummary.values()) {
    s.netPendingPaise = subPaise(s.totalInvoicedPaise, s.totalSettledPaise);
    s.totalInvoiced = toRupees(s.totalInvoicedPaise);
    s.totalSettled = toRupees(s.totalSettledPaise);
    s.netPending = toRupees(s.netPendingPaise);
    list.push(s);
  }

  return list;
}

module.exports = {
  recordAllocation,
  getPartyOutstanding,
  getOutstandingSummary
};
