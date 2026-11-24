'use strict';
/**
 * stock-groups.js — Stock Group Master for Tally-compatible Inventory
 *
 * Hierarchical stock grouping (e.g. Raw Materials > Aluminium > 6063-T5).
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');

const DEFAULT_STOCK_GROUPS = [
  { id: 'sg_primary', name: 'Primary', parent: null, isDefault: true },
  { id: 'sg_raw_materials', name: 'Raw Materials', parent: 'sg_primary', isDefault: true },
  { id: 'sg_finished_goods', name: 'Finished Goods', parent: 'sg_primary', isDefault: true },
  { id: 'sg_semi_finished', name: 'Semi-Finished Goods', parent: 'sg_primary', isDefault: true },
  { id: 'sg_consumables', name: 'Consumables', parent: 'sg_primary', isDefault: true },
  { id: 'sg_packing', name: 'Packing Materials', parent: 'sg_primary', isDefault: true },
  { id: 'sg_scrap', name: 'Scrap / Waste', parent: 'sg_primary', isDefault: true }
];

/**
 * Seed default stock groups for a company (idempotent).
 */
async function initDefaultStockGroups(companyId) {
  const col = await getCollection('stockGroups');
  const existing = await col.find({ companyId }).toArray();
  if (existing.length > 0) return existing;

  const docs = DEFAULT_STOCK_GROUPS.map(g => ({
    ...g,
    companyId,
    createdAt: Date.now()
  }));
  for (const doc of docs) await col.insertOne(doc);
  return docs;
}

/**
 * List all stock groups for a company.
 */
async function listStockGroups(companyId) {
  const col = await getCollection('stockGroups');
  let groups = await col.find({ companyId }).toArray();
  if (groups.length === 0) groups = await initDefaultStockGroups(companyId);
  return groups;
}

/**
 * Create a custom stock group.
 */
async function createStockGroup(companyId, data) {
  const col = await getCollection('stockGroups');
  const group = {
    id: 'sg_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    parent: data.parent || 'sg_primary',
    companyId,
    isDefault: false,
    createdAt: Date.now()
  };
  if (!group.name) throw new Error('Stock group name is required');
  await col.insertOne(group);
  return group;
}

/**
 * Update a stock group.
 */
async function updateStockGroup(companyId, groupId, data) {
  const col = await getCollection('stockGroups');
  const existing = await col.findOne({ id: groupId, companyId });
  if (!existing) throw new Error('Stock group not found');
  if (existing.isDefault) throw new Error('Cannot modify default stock groups');

  const updated = {
    ...existing,
    name: data.name !== undefined ? String(data.name).trim() : existing.name,
    parent: data.parent !== undefined ? data.parent : existing.parent,
    updatedAt: Date.now()
  };
  await col.replaceOne({ id: groupId, companyId }, updated);
  return updated;
}

/**
 * Delete a stock group (only non-default, only if no items use it).
 */
async function deleteStockGroup(companyId, groupId) {
  const col = await getCollection('stockGroups');
  const existing = await col.findOne({ id: groupId, companyId });
  if (!existing) throw new Error('Stock group not found');
  if (existing.isDefault) throw new Error('Cannot delete default stock groups');

  // Check if any stock items reference this group
  const itemCol = await getCollection('stockItems');
  const usedBy = await itemCol.find({ companyId, stockGroupId: groupId }).toArray();
  if (usedBy.length > 0) throw new Error(`Cannot delete: ${usedBy.length} stock item(s) use this group`);

  // Check if any child groups exist
  const children = await col.find({ companyId, parent: groupId }).toArray();
  if (children.length > 0) throw new Error(`Cannot delete: ${children.length} child group(s) exist`);

  await col.deleteOne({ id: groupId, companyId });
  return { deleted: true };
}

module.exports = {
  DEFAULT_STOCK_GROUPS,
  initDefaultStockGroups,
  listStockGroups,
  createStockGroup,
  updateStockGroup,
  deleteStockGroup
};
