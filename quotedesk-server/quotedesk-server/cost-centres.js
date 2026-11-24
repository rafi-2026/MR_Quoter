'use strict';
/**
 * cost-centres.js — Cost Centre / Cost Category Master
 *
 * Extends the existing projects.js (which acts as a cost-centre proxy) with
 * a formal cost centre model for allocation % splits on vouchers.
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');

/**
 * List all cost centres for a company.
 */
async function listCostCentres(companyId) {
  const col = await getCollection('costCentres');
  return await col.find({ companyId }).sort({ name: 1 }).toArray();
}

/**
 * Get a single cost centre.
 */
async function getCostCentre(companyId, ccId) {
  const col = await getCollection('costCentres');
  return await col.findOne({ id: ccId, companyId });
}

/**
 * Create a cost centre.
 */
async function createCostCentre(companyId, data) {
  const col = await getCollection('costCentres');
  const cc = {
    id: 'cc_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    parent: data.parent || null,
    category: String(data.category || '').trim(),
    projectId: data.projectId || null,  // Link to existing project if applicable
    companyId,
    isActive: true,
    createdAt: Date.now()
  };
  if (!cc.name) throw new Error('Cost centre name is required');
  await col.insertOne(cc);
  return cc;
}

/**
 * Update a cost centre.
 */
async function updateCostCentre(companyId, ccId, data) {
  const col = await getCollection('costCentres');
  const existing = await col.findOne({ id: ccId, companyId });
  if (!existing) throw new Error('Cost centre not found');

  const updated = { ...existing };
  if (data.name !== undefined) updated.name = String(data.name).trim();
  if (data.parent !== undefined) updated.parent = data.parent;
  if (data.category !== undefined) updated.category = String(data.category).trim();
  if (data.projectId !== undefined) updated.projectId = data.projectId;
  if (data.isActive !== undefined) updated.isActive = !!data.isActive;
  updated.updatedAt = Date.now();

  await col.replaceOne({ id: ccId, companyId }, updated);
  return updated;
}

/**
 * Delete a cost centre.
 */
async function deleteCostCentre(companyId, ccId) {
  const col = await getCollection('costCentres');
  const existing = await col.findOne({ id: ccId, companyId });
  if (!existing) throw new Error('Cost centre not found');

  // Check for children
  const children = await col.find({ companyId, parent: ccId }).toArray();
  if (children.length > 0) throw new Error(`Cannot delete: ${children.length} child cost centre(s) exist`);

  await col.deleteOne({ id: ccId, companyId });
  return { deleted: true };
}

module.exports = {
  listCostCentres,
  getCostCentre,
  createCostCentre,
  updateCostCentre,
  deleteCostCentre
};
