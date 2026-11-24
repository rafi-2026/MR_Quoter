'use strict';
/**
 * stock-items.js — Stock Item Master for Tally-compatible Inventory
 *
 * Each stock item has: name, group, unit, HSN/SAC, tax rate, opening qty/rate,
 * reorder level, valuation method.
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees } = require('./paise.js');

/**
 * List all stock items for a company.
 */
async function listStockItems(companyId, filters = {}) {
  const col = await getCollection('stockItems');
  const query = { companyId };
  if (filters.stockGroupId) query.stockGroupId = filters.stockGroupId;
  if (filters.search) {
    // Simple name search (case-insensitive via lowered field)
    query.nameLower = { $in: [filters.search.toLowerCase()] };
  }
  return await col.find(query).sort({ name: 1 }).toArray();
}

/**
 * Get a single stock item.
 */
async function getStockItem(companyId, itemId) {
  const col = await getCollection('stockItems');
  return await col.findOne({ id: itemId, companyId });
}

/**
 * Create a stock item.
 */
async function createStockItem(companyId, data) {
  const col = await getCollection('stockItems');

  const item = {
    id: 'si_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    nameLower: String(data.name || '').trim().toLowerCase(),
    alias: String(data.alias || '').trim(),
    stockGroupId: data.stockGroupId || 'sg_primary',
    unitId: data.unitId || null,
    unitName: String(data.unitName || 'Nos').trim(),
    hsnCode: String(data.hsnCode || '').trim(),
    sacCode: String(data.sacCode || '').trim(),
    taxRate: Number(data.taxRate) || 0,
    openingQty: Number(data.openingQty) || 0,
    openingRatePaise: toPaise(data.openingRate || 0),
    openingValuePaise: toPaise(data.openingValue || 0),
    reorderLevel: Number(data.reorderLevel) || 0,
    valuationMethod: data.valuationMethod || 'weighted_average', // fifo | lifo | weighted_average
    batchTracking: !!data.batchTracking,
    serialTracking: !!data.serialTracking,
    description: String(data.description || '').trim(),
    companyId,
    isActive: true,
    createdAt: Date.now()
  };

  if (!item.name) throw new Error('Stock item name is required');

  // Calculate opening value if not provided
  if (item.openingQty > 0 && item.openingRatePaise > 0 && !item.openingValuePaise) {
    item.openingValuePaise = Math.round(item.openingQty * item.openingRatePaise);
  }

  await col.insertOne(item);
  return item;
}

/**
 * Update a stock item.
 */
async function updateStockItem(companyId, itemId, data) {
  const col = await getCollection('stockItems');
  const existing = await col.findOne({ id: itemId, companyId });
  if (!existing) throw new Error('Stock item not found');

  const updated = { ...existing };

  if (data.name !== undefined) {
    updated.name = String(data.name).trim();
    updated.nameLower = updated.name.toLowerCase();
  }
  if (data.alias !== undefined) updated.alias = String(data.alias).trim();
  if (data.stockGroupId !== undefined) updated.stockGroupId = data.stockGroupId;
  if (data.unitId !== undefined) updated.unitId = data.unitId;
  if (data.unitName !== undefined) updated.unitName = String(data.unitName).trim();
  if (data.hsnCode !== undefined) updated.hsnCode = String(data.hsnCode).trim();
  if (data.sacCode !== undefined) updated.sacCode = String(data.sacCode).trim();
  if (data.taxRate !== undefined) updated.taxRate = Number(data.taxRate) || 0;
  if (data.openingQty !== undefined) updated.openingQty = Number(data.openingQty) || 0;
  if (data.openingRate !== undefined) updated.openingRatePaise = toPaise(data.openingRate);
  if (data.openingValue !== undefined) updated.openingValuePaise = toPaise(data.openingValue);
  if (data.reorderLevel !== undefined) updated.reorderLevel = Number(data.reorderLevel) || 0;
  if (data.valuationMethod !== undefined) updated.valuationMethod = data.valuationMethod;
  if (data.batchTracking !== undefined) updated.batchTracking = !!data.batchTracking;
  if (data.serialTracking !== undefined) updated.serialTracking = !!data.serialTracking;
  if (data.description !== undefined) updated.description = String(data.description).trim();
  if (data.isActive !== undefined) updated.isActive = !!data.isActive;

  updated.updatedAt = Date.now();
  await col.replaceOne({ id: itemId, companyId }, updated);
  return updated;
}

/**
 * Delete a stock item (soft-delete by setting isActive = false).
 */
async function deleteStockItem(companyId, itemId) {
  const col = await getCollection('stockItems');
  const existing = await col.findOne({ id: itemId, companyId });
  if (!existing) throw new Error('Stock item not found');

  existing.isActive = false;
  existing.deletedAt = Date.now();
  await col.replaceOne({ id: itemId, companyId }, existing);
  return { deleted: true, id: itemId };
}

module.exports = {
  listStockItems,
  getStockItem,
  createStockItem,
  updateStockItem,
  deleteStockItem
};
