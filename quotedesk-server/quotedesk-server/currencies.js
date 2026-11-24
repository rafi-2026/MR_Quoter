'use strict';
/**
 * currencies.js — Multi-Currency Master with Exchange Rate History
 *
 * Currently INR-only; this module lays the foundation for future multi-currency.
 * Multi-tenant by companyId.
 */

const { getCollection } = require('./db.js');

const DEFAULT_CURRENCIES = [
  { id: 'cur_inr', code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2, isBase: true, isDefault: true }
];

/**
 * Seed default currency for a company.
 */
async function initDefaultCurrencies(companyId) {
  const col = await getCollection('currencies');
  const existing = await col.find({ companyId }).toArray();
  if (existing.length > 0) return existing;

  const docs = DEFAULT_CURRENCIES.map(c => ({
    ...c,
    companyId,
    exchangeRate: 1,
    createdAt: Date.now()
  }));
  for (const doc of docs) await col.insertOne(doc);
  return docs;
}

async function listCurrencies(companyId) {
  const col = await getCollection('currencies');
  let currencies = await col.find({ companyId }).toArray();
  if (currencies.length === 0) currencies = await initDefaultCurrencies(companyId);
  return currencies;
}

async function createCurrency(companyId, data) {
  const col = await getCollection('currencies');
  const currency = {
    id: 'cur_' + String(data.code || '').toLowerCase().trim(),
    code: String(data.code || '').toUpperCase().trim(),
    name: String(data.name || '').trim(),
    symbol: String(data.symbol || '').trim(),
    decimalPlaces: Number(data.decimalPlaces) || 2,
    isBase: false,
    exchangeRate: Number(data.exchangeRate) || 1,
    companyId,
    isDefault: false,
    createdAt: Date.now()
  };
  if (!currency.code || currency.code.length !== 3) throw new Error('Currency code must be 3 letters (e.g. USD)');
  if (!currency.name) throw new Error('Currency name is required');

  // Check for duplicates
  const existing = await col.findOne({ code: currency.code, companyId });
  if (existing) throw new Error(`Currency ${currency.code} already exists`);

  await col.insertOne(currency);
  return currency;
}

async function updateCurrency(companyId, currencyId, data) {
  const col = await getCollection('currencies');
  const existing = await col.findOne({ id: currencyId, companyId });
  if (!existing) throw new Error('Currency not found');

  const updated = { ...existing };
  if (data.name !== undefined) updated.name = String(data.name).trim();
  if (data.symbol !== undefined) updated.symbol = String(data.symbol).trim();
  if (data.exchangeRate !== undefined) updated.exchangeRate = Number(data.exchangeRate) || 1;
  if (data.decimalPlaces !== undefined) updated.decimalPlaces = Number(data.decimalPlaces) || 2;
  updated.updatedAt = Date.now();

  await col.replaceOne({ id: currencyId, companyId }, updated);

  // Log exchange rate history
  if (data.exchangeRate !== undefined && data.exchangeRate !== existing.exchangeRate) {
    const histCol = await getCollection('exchangeRateHistory');
    await histCol.insertOne({
      currencyId,
      code: existing.code,
      rate: Number(data.exchangeRate),
      effectiveDate: data.effectiveDate || new Date().toISOString().slice(0, 10),
      companyId,
      createdAt: Date.now()
    });
  }

  return updated;
}

async function deleteCurrency(companyId, currencyId) {
  const col = await getCollection('currencies');
  const existing = await col.findOne({ id: currencyId, companyId });
  if (!existing) throw new Error('Currency not found');
  if (existing.isBase) throw new Error('Cannot delete the base currency');
  if (existing.isDefault) throw new Error('Cannot delete default currencies');

  await col.deleteOne({ id: currencyId, companyId });
  return { deleted: true };
}

module.exports = {
  DEFAULT_CURRENCIES,
  initDefaultCurrencies,
  listCurrencies,
  createCurrency,
  updateCurrency,
  deleteCurrency
};
