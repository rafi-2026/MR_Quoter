'use strict';
/**
 * paise.js — Integer-paise arithmetic for safe money calculations
 *
 * All monetary values stored as integer paise (1 rupee = 100 paise).
 * Display-only conversion: divide by 100 at the presentation layer.
 *
 * Golden Rule: Never use floating-point for money calculations in new code.
 */

/**
 * Convert a rupee amount (number or string) to integer paise.
 * @param {number|string} rupees - Amount in rupees (e.g. 1234.56)
 * @returns {number} Integer paise (e.g. 123456)
 */
function toPaise(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') return 0;
  const n = typeof rupees === 'string' ? parseFloat(rupees) : Number(rupees);
  if (isNaN(n)) return 0;
  // Round to avoid floating-point multiplication artifacts
  return Math.round(n * 100);
}

/**
 * Convert integer paise back to rupees for display.
 * @param {number} paise - Integer paise
 * @returns {number} Rupee amount with 2 decimal places
 */
function toRupees(paise) {
  if (!paise && paise !== 0) return 0;
  return Math.round(Number(paise) || 0) / 100;
}

/**
 * Format paise as a currency string (e.g. "₹1,234.56")
 * @param {number} paise - Integer paise
 * @returns {string}
 */
function formatINR(paise) {
  const rupees = toRupees(paise);
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Add multiple paise values safely.
 * @param  {...number} values - Paise amounts
 * @returns {number} Sum in paise
 */
function addPaise(...values) {
  return values.reduce((sum, v) => sum + (Math.round(Number(v) || 0)), 0);
}

/**
 * Subtract b from a in paise.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function subPaise(a, b) {
  return Math.round(Number(a) || 0) - Math.round(Number(b) || 0);
}

/**
 * Multiply paise by a quantity (returns paise).
 * @param {number} paise - Unit price in paise
 * @param {number} qty - Quantity
 * @returns {number} Total paise
 */
function mulPaise(paise, qty) {
  return Math.round((Math.round(Number(paise) || 0)) * (Number(qty) || 0));
}

/**
 * Calculate percentage of a paise amount (returns paise).
 * @param {number} paise - Base amount in paise
 * @param {number} percent - Percentage (e.g. 18 for 18%)
 * @returns {number} Result in paise
 */
function percentPaise(paise, percent) {
  return Math.round((Math.round(Number(paise) || 0)) * (Number(percent) || 0) / 100);
}

/**
 * Round paise to nearest rupee (for grand total rounding).
 * @param {number} paise
 * @returns {number} Rounded paise (always a multiple of 100)
 */
function roundToRupee(paise) {
  const p = Math.round(Number(paise) || 0);
  return Math.round(p / 100) * 100;
}

/**
 * Compute rounding difference (for round-off ledger posting).
 * @param {number} paise - Original paise
 * @returns {number} Difference in paise (positive = round up, negative = round down)
 */
function roundOffDiff(paise) {
  const p = Math.round(Number(paise) || 0);
  return roundToRupee(p) - p;
}

module.exports = {
  toPaise,
  toRupees,
  formatINR,
  addPaise,
  subPaise,
  mulPaise,
  percentPaise,
  roundToRupee,
  roundOffDiff
};
