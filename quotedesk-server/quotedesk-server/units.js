'use strict';
/**
 * units.js — Unit of Measure Master (Simple & Compound)
 *
 * Simple units: Nos, Kg, Mtr, Ltr, Sqm, Sqft, Rmt, Pcs, Box, Set, Bag
 * Compound units: 1 Box = 12 Nos, 1 Kg = 1000 Gm, etc.
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');

const DEFAULT_UNITS = [
  { id: 'uom_nos', name: 'Numbers', symbol: 'Nos', decimalPlaces: 0, isCompound: false, isDefault: true },
  { id: 'uom_kg', name: 'Kilograms', symbol: 'Kg', decimalPlaces: 3, isCompound: false, isDefault: true },
  { id: 'uom_gm', name: 'Grams', symbol: 'Gm', decimalPlaces: 0, isCompound: false, isDefault: true },
  { id: 'uom_mtr', name: 'Metres', symbol: 'Mtr', decimalPlaces: 2, isCompound: false, isDefault: true },
  { id: 'uom_rmt', name: 'Running Metres', symbol: 'Rmt', decimalPlaces: 2, isCompound: false, isDefault: true },
  { id: 'uom_sqm', name: 'Square Metres', symbol: 'Sqm', decimalPlaces: 2, isCompound: false, isDefault: true },
  { id: 'uom_sqft', name: 'Square Feet', symbol: 'Sqft', decimalPlaces: 2, isCompound: false, isDefault: true },
  { id: 'uom_ltr', name: 'Litres', symbol: 'Ltr', decimalPlaces: 2, isCompound: false, isDefault: true },
  { id: 'uom_pcs', name: 'Pieces', symbol: 'Pcs', decimalPlaces: 0, isCompound: false, isDefault: true },
  { id: 'uom_box', name: 'Box', symbol: 'Box', decimalPlaces: 0, isCompound: false, isDefault: true },
  { id: 'uom_set', name: 'Set', symbol: 'Set', decimalPlaces: 0, isCompound: false, isDefault: true },
  { id: 'uom_bag', name: 'Bag', symbol: 'Bag', decimalPlaces: 0, isCompound: false, isDefault: true },
  { id: 'uom_ton', name: 'Metric Tonnes', symbol: 'MT', decimalPlaces: 3, isCompound: false, isDefault: true },
  { id: 'uom_bndl', name: 'Bundle', symbol: 'Bndl', decimalPlaces: 0, isCompound: false, isDefault: true }
];

/**
 * Seed default units for a company.
 */
async function initDefaultUnits(companyId) {
  const col = await getCollection('units');
  const existing = await col.find({ companyId }).toArray();
  if (existing.length > 0) return existing;

  const docs = DEFAULT_UNITS.map(u => ({
    ...u,
    companyId,
    conversions: [],
    createdAt: Date.now()
  }));
  for (const doc of docs) await col.insertOne(doc);
  return docs;
}

/**
 * List all units for a company.
 */
async function listUnits(companyId) {
  const col = await getCollection('units');
  let units = await col.find({ companyId }).toArray();
  if (units.length === 0) units = await initDefaultUnits(companyId);
  return units;
}

/**
 * Create a unit (simple or compound).
 * For compound: provide baseUnitId, baseUnitQty, and conversion factor.
 * Example: 1 Box = 12 Nos → { name: 'Box of 12', symbol: 'Box12', isCompound: true,
 *   baseUnitId: 'uom_nos', conversionFactor: 12 }
 */
async function createUnit(companyId, data) {
  const col = await getCollection('units');
  const unit = {
    id: 'uom_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    symbol: String(data.symbol || '').trim(),
    decimalPlaces: Number(data.decimalPlaces) || 0,
    isCompound: !!data.isCompound,
    baseUnitId: data.baseUnitId || null,
    conversionFactor: Number(data.conversionFactor) || 1,
    companyId,
    isDefault: false,
    conversions: data.conversions || [],
    createdAt: Date.now()
  };
  if (!unit.name) throw new Error('Unit name is required');
  if (!unit.symbol) throw new Error('Unit symbol is required');
  await col.insertOne(unit);
  return unit;
}

/**
 * Update a unit.
 */
async function updateUnit(companyId, unitId, data) {
  const col = await getCollection('units');
  const existing = await col.findOne({ id: unitId, companyId });
  if (!existing) throw new Error('Unit not found');

  const updated = { ...existing };
  if (data.name !== undefined) updated.name = String(data.name).trim();
  if (data.symbol !== undefined) updated.symbol = String(data.symbol).trim();
  if (data.decimalPlaces !== undefined) updated.decimalPlaces = Number(data.decimalPlaces) || 0;
  if (data.isCompound !== undefined) updated.isCompound = !!data.isCompound;
  if (data.baseUnitId !== undefined) updated.baseUnitId = data.baseUnitId;
  if (data.conversionFactor !== undefined) updated.conversionFactor = Number(data.conversionFactor) || 1;
  if (data.conversions !== undefined) updated.conversions = data.conversions;
  updated.updatedAt = Date.now();

  await col.replaceOne({ id: unitId, companyId }, updated);
  return updated;
}

/**
 * Delete a unit (only non-default).
 */
async function deleteUnit(companyId, unitId) {
  const col = await getCollection('units');
  const existing = await col.findOne({ id: unitId, companyId });
  if (!existing) throw new Error('Unit not found');
  if (existing.isDefault) throw new Error('Cannot delete default units');

  // Check if any stock items use this unit
  const itemCol = await getCollection('stockItems');
  const usedBy = await itemCol.find({ companyId, unitId }).toArray();
  if (usedBy.length > 0) throw new Error(`Cannot delete: ${usedBy.length} stock item(s) use this unit`);

  await col.deleteOne({ id: unitId, companyId });
  return { deleted: true };
}

/**
 * Convert quantity between units using conversion factor.
 * @param {number} qty - Quantity in source unit
 * @param {string} fromUnitId - Source unit ID
 * @param {string} toUnitId - Target unit ID
 * @param {string} companyId
 * @returns {number} Converted quantity
 */
async function convertUnit(companyId, qty, fromUnitId, toUnitId) {
  if (fromUnitId === toUnitId) return qty;

  const col = await getCollection('units');
  const from = await col.findOne({ id: fromUnitId, companyId });
  const to = await col.findOne({ id: toUnitId, companyId });
  if (!from || !to) throw new Error('Unit not found for conversion');

  // Both must share a common base or be directly related
  if (from.isCompound && from.baseUnitId === toUnitId) {
    return qty * from.conversionFactor;
  }
  if (to.isCompound && to.baseUnitId === fromUnitId) {
    return qty / to.conversionFactor;
  }
  throw new Error(`No conversion path between ${from.symbol} and ${to.symbol}`);
}

module.exports = {
  DEFAULT_UNITS,
  initDefaultUnits,
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  convertUnit
};
