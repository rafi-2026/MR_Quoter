'use strict';
/**
 * godowns.js — Godown / Warehouse Location Master
 *
 * Tracks physical storage locations for inventory.
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');

const DEFAULT_GODOWNS = [
  { id: 'gd_main', name: 'Main Godown', address: '', isDefault: true }
];

/**
 * Seed default godown for a company.
 */
async function initDefaultGodowns(companyId) {
  const col = await getCollection('godowns');
  const existing = await col.find({ companyId }).toArray();
  if (existing.length > 0) return existing;

  const docs = DEFAULT_GODOWNS.map(g => ({
    ...g,
    companyId,
    createdAt: Date.now()
  }));
  for (const doc of docs) await col.insertOne(doc);
  return docs;
}

async function listGodowns(companyId) {
  const col = await getCollection('godowns');
  let godowns = await col.find({ companyId }).toArray();
  if (godowns.length === 0) godowns = await initDefaultGodowns(companyId);
  return godowns;
}

async function createGodown(companyId, data) {
  const col = await getCollection('godowns');
  const godown = {
    id: 'gd_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    address: String(data.address || '').trim(),
    contactPerson: String(data.contactPerson || '').trim(),
    phone: String(data.phone || '').trim(),
    companyId,
    isDefault: false,
    createdAt: Date.now()
  };
  if (!godown.name) throw new Error('Godown name is required');
  await col.insertOne(godown);
  return godown;
}

async function updateGodown(companyId, godownId, data) {
  const col = await getCollection('godowns');
  const existing = await col.findOne({ id: godownId, companyId });
  if (!existing) throw new Error('Godown not found');

  const updated = { ...existing };
  if (data.name !== undefined) updated.name = String(data.name).trim();
  if (data.address !== undefined) updated.address = String(data.address).trim();
  if (data.contactPerson !== undefined) updated.contactPerson = String(data.contactPerson).trim();
  if (data.phone !== undefined) updated.phone = String(data.phone).trim();
  updated.updatedAt = Date.now();

  await col.replaceOne({ id: godownId, companyId }, updated);
  return updated;
}

async function deleteGodown(companyId, godownId) {
  const col = await getCollection('godowns');
  const existing = await col.findOne({ id: godownId, companyId });
  if (!existing) throw new Error('Godown not found');
  if (existing.isDefault) throw new Error('Cannot delete default godown');

  await col.deleteOne({ id: godownId, companyId });
  return { deleted: true };
}

module.exports = {
  DEFAULT_GODOWNS,
  initDefaultGodowns,
  listGodowns,
  createGodown,
  updateGodown,
  deleteGodown
};
