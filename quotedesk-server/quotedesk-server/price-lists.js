'use strict';
/**
 * price-lists.js — Price List Master for tiered / date-ranged pricing
 *
 * Each price list has a validity period and item-level rates.
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');
const { toPaise, toRupees } = require('./paise.js');

/**
 * List all price lists for a company.
 */
async function listPriceLists(companyId) {
  const col = await getCollection('priceLists');
  return await col.find({ companyId }).sort({ name: 1 }).toArray();
}

/**
 * Get a single price list by ID.
 */
async function getPriceList(companyId, listId) {
  const col = await getCollection('priceLists');
  return await col.findOne({ id: listId, companyId });
}

/**
 * Create a price list.
 * data.items = [{ stockItemId, ratePaise }]
 */
async function createPriceList(companyId, data) {
  const col = await getCollection('priceLists');
  const priceList = {
    id: 'pl_' + Math.random().toString(36).slice(2, 10),
    name: String(data.name || '').trim(),
    description: String(data.description || '').trim(),
    applicableFrom: data.applicableFrom || null,
    applicableTo: data.applicableTo || null,
    items: (data.items || []).map(it => ({
      stockItemId: it.stockItemId,
      ratePaise: toPaise(it.rate || it.ratePaise || 0)
    })),
    companyId,
    isActive: true,
    createdAt: Date.now()
  };
  if (!priceList.name) throw new Error('Price list name is required');
  await col.insertOne(priceList);
  return priceList;
}

/**
 * Update a price list.
 */
async function updatePriceList(companyId, listId, data) {
  const col = await getCollection('priceLists');
  const existing = await col.findOne({ id: listId, companyId });
  if (!existing) throw new Error('Price list not found');

  const updated = { ...existing };
  if (data.name !== undefined) updated.name = String(data.name).trim();
  if (data.description !== undefined) updated.description = String(data.description).trim();
  if (data.applicableFrom !== undefined) updated.applicableFrom = data.applicableFrom;
  if (data.applicableTo !== undefined) updated.applicableTo = data.applicableTo;
  if (data.items !== undefined) {
    updated.items = data.items.map(it => ({
      stockItemId: it.stockItemId,
      ratePaise: toPaise(it.rate || it.ratePaise || 0)
    }));
  }
  if (data.isActive !== undefined) updated.isActive = !!data.isActive;
  updated.updatedAt = Date.now();

  await col.replaceOne({ id: listId, companyId }, updated);
  return updated;
}

/**
 * Delete a price list.
 */
async function deletePriceList(companyId, listId) {
  const col = await getCollection('priceLists');
  const existing = await col.findOne({ id: listId, companyId });
  if (!existing) throw new Error('Price list not found');
  await col.deleteOne({ id: listId, companyId });
  return { deleted: true };
}

/**
 * Get the applicable rate for a stock item from a price list on a given date.
 * Returns rate in paise, or null if not found.
 */
async function getItemRate(companyId, stockItemId, priceListId, date) {
  const pl = await getPriceList(companyId, priceListId);
  if (!pl || !pl.isActive) return null;

  // Check date validity
  if (pl.applicableFrom && date < pl.applicableFrom) return null;
  if (pl.applicableTo && date > pl.applicableTo) return null;

  const item = pl.items.find(it => it.stockItemId === stockItemId);
  return item ? item.ratePaise : null;
}

module.exports = {
  listPriceLists,
  getPriceList,
  createPriceList,
  updatePriceList,
  deletePriceList,
  getItemRate
};
