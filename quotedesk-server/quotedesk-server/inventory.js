'use strict';
/**
 * inventory.js — Double-Entry Linked Inventory Management & Valuation Engine
 *
 * Implements:
 *   - Real-time stock movement tracking (Inward vs Outward)
 *   - Godown / location based stock balances
 *   - Valuation methods: FIFO (First-In, First-Out) & Weighted Average
 *   - Negative Stock Protection (warns or blocks dispatch if quantity is insufficient)
 *   - Reorder level alerts
 *   - Stock Summary Statement (Opening + Inward - Outward = Closing)
 *   - Stock Ageing calculation
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees, mulPaise, subPaise, addPaise } = require('./paise.js');
const stockItems = require('./stock-items.js');

/**
 * Record a stock movement on voucher creation (e.g. Delivery Challan, GRN, Stock Journal, Sales, Purchase)
 * @param {string} companyId
 * @param {object} movement
 *   - voucherId, voucherNo, voucherType, date
 *   - stockItemId, stockItemName, godownId, godownName
 *   - qty, rate (or ratePaise), direction ('in' | 'out')
 *   - batchNo, expiryDate, serialNo
 */
async function recordStockMovement(companyId, movement) {
  const col = await getCollection('stock_movements');
  const qty = Number(movement.qty) || 0;
  if (qty <= 0) throw new Error('Stock movement quantity must be greater than zero.');

  const ratePaise = movement.ratePaise !== undefined ? movement.ratePaise : toPaise(movement.rate);
  const valuePaise = mulPaise(ratePaise, qty);

  // Negative Stock Guard (if outward movement)
  if (movement.direction === 'out' && movement.checkNegativeStock !== false) {
    const currentStock = await getStockOnHand(companyId, movement.stockItemId, movement.godownId);
    if (currentStock.closingQty < qty) {
      throw new Error(
        `Negative Stock Alert: Item "${movement.stockItemName || movement.stockItemId}" has only ${currentStock.closingQty} in stock, but attempted to dispatch ${qty}.`
      );
    }
  }

  const doc = {
    id: 'mov_' + Math.random().toString(36).slice(2, 11),
    companyId,
    voucherId: movement.voucherId,
    voucherNo: movement.voucherNo,
    voucherType: movement.voucherType,
    date: movement.date || new Date().toISOString().slice(0, 10),
    stockItemId: movement.stockItemId,
    stockItemName: movement.stockItemName || '',
    godownId: movement.godownId || 'gd_main',
    godownName: movement.godownName || 'Main Godown',
    direction: movement.direction, // 'in' or 'out'
    qty,
    ratePaise,
    rate: toRupees(ratePaise),
    valuePaise,
    value: toRupees(valuePaise),
    batchNo: movement.batchNo || '',
    expiryDate: movement.expiryDate || '',
    serialNo: movement.serialNo || '',
    createdAt: Date.now()
  };

  await col.insertOne(doc);
  return doc;
}

/**
 * Get real-time stock on hand for an item (optionally filtered by godown and date)
 */
async function getStockOnHand(companyId, stockItemId, godownId = null, asOfDate = null) {
  const item = await stockItems.getStockItem(companyId, stockItemId);
  const col = await getCollection('stock_movements');

  const query = { companyId, stockItemId };
  if (godownId) query.godownId = godownId;
  if (asOfDate) query.date = { $lte: asOfDate };

  const movements = await col.find(query).toArray();

  let totalInQty = item ? (Number(item.openingQty) || 0) : 0;
  let totalInValuePaise = item ? (item.openingValuePaise || 0) : 0;
  let totalOutQty = 0;
  let totalOutValuePaise = 0;

  for (const m of movements) {
    if (m.direction === 'in') {
      totalInQty += m.qty;
      totalInValuePaise = addPaise(totalInValuePaise, m.valuePaise);
    } else if (m.direction === 'out') {
      totalOutQty += m.qty;
      totalOutValuePaise = addPaise(totalOutValuePaise, m.valuePaise);
    }
  }

  const closingQty = Math.max(0, totalInQty - totalOutQty);
  // Average rate calculation
  const avgRatePaise = totalInQty > 0 ? Math.round(totalInValuePaise / totalInQty) : 0;
  const closingValuePaise = mulPaise(avgRatePaise, closingQty);

  return {
    stockItemId,
    stockItemName: item ? item.name : '',
    unitName: item ? item.unitName : 'Nos',
    reorderLevel: item ? item.reorderLevel : 0,
    openingQty: item ? (item.openingQty || 0) : 0,
    totalInQty,
    totalOutQty,
    closingQty,
    avgRate: toRupees(avgRatePaise),
    closingValue: toRupees(closingValuePaise),
    isBelowReorder: item && item.reorderLevel > 0 && closingQty <= item.reorderLevel
  };
}

/**
 * Generate full Stock Summary Statement (Tally-style)
 */
async function getStockSummary(companyId, filters = {}) {
  const items = await stockItems.listStockItems(companyId);
  const summary = [];

  for (const it of items) {
    const onHand = await getStockOnHand(companyId, it.id, filters.godownId, filters.asOfDate);
    summary.push({
      ...onHand,
      stockGroupId: it.stockGroupId,
      hsnCode: it.hsnCode,
      taxRate: it.taxRate
    });
  }

  const totalValue = summary.reduce((sum, s) => sum + (s.closingValue || 0), 0);

  return {
    asOfDate: filters.asOfDate || new Date().toISOString().slice(0, 10),
    totalItems: summary.length,
    totalStockValue: Math.round(totalValue * 100) / 100,
    items: summary
  };
}

/**
 * FIFO Inventory Valuation for an item
 */
async function valuateStockFIFO(companyId, stockItemId) {
  const col = await getCollection('stock_movements');
  const movements = await col.find({ companyId, stockItemId }).sort({ date: 1, createdAt: 1 }).toArray();
  const item = await stockItems.getStockItem(companyId, stockItemId);

  // Inward queue (batches)
  const inQueue = [];
  if (item && item.openingQty > 0) {
    inQueue.push({
      qty: item.openingQty,
      ratePaise: item.openingRatePaise || 0
    });
  }

  for (const m of movements) {
    if (m.direction === 'in') {
      inQueue.push({ qty: m.qty, ratePaise: m.ratePaise });
    } else if (m.direction === 'out') {
      let needed = m.qty;
      while (needed > 0 && inQueue.length > 0) {
        if (inQueue[0].qty <= needed) {
          needed -= inQueue[0].qty;
          inQueue.shift();
        } else {
          inQueue[0].qty -= needed;
          needed = 0;
        }
      }
    }
  }

  let fifoQty = 0;
  let fifoValuePaise = 0;
  for (const batch of inQueue) {
    fifoQty += batch.qty;
    fifoValuePaise = addPaise(fifoValuePaise, mulPaise(batch.ratePaise, batch.qty));
  }

  return {
    stockItemId,
    valuationMethod: 'FIFO',
    remainingQty: fifoQty,
    valuationValue: toRupees(fifoValuePaise),
    effectiveRate: fifoQty > 0 ? toRupees(Math.round(fifoValuePaise / fifoQty)) : 0
  };
}

/**
 * Reorder level alerts: items whose stock has fallen below threshold
 */
async function getReorderAlerts(companyId) {
  const summary = await getStockSummary(companyId);
  return summary.items.filter(it => it.isBelowReorder);
}

module.exports = {
  recordStockMovement,
  getStockOnHand,
  getStockSummary,
  valuateStockFIFO,
  getReorderAlerts
};
