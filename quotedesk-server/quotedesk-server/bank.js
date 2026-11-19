'use strict';
/**
 * bank.js — Bank Statement Processing, Fuzzy Party Auto-Entry & Suspense Engine
 *
 * Implements:
 *   - CSV & Tabular Statement parser with auto header detection (HDFC, ICICI, SBI, Axis, Kotak, Generic)
 *   - SHA-256 duplicate transaction prevention (bank + date + amount + type + ref)
 *   - Smart party matching against Customers/Vendors names & aliases + custom rule engine
 *   - Automatic posting:
 *       - Matched Credit -> Receipt Voucher (Dr Bank, Cr Customer)
 *       - Matched Debit  -> Payment Voucher (Dr Vendor/Expense, Cr Bank)
 *       - Unmatched      -> Suspense Account with mandatory reason
 *   - Suspense clearing with automatic reclassification voucher & "Remember Rule" learner
 *   - Notification metrics: unread suspense count & total unresolved value
 */

const crypto = require('crypto');
const { getCollection } = require('./db.js');
const { createVoucher } = require('./vouchers.js');

/**
 * Compute unique deterministic hash for duplicate protection
 */
function computeTxnHash(bankAccountId, date, amount, type, ref = '', narration = '') {
  const normDate = String(date || '').trim().slice(0, 10);
  const normAmt = Number(amount || 0).toFixed(2);
  const normType = String(type || '').toLowerCase().trim();
  const normRef = String(ref || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const normNarr = String(narration || '').toLowerCase().trim().slice(0, 40).replace(/[^a-z0-9]/g, '');

  const raw = `${bankAccountId}|${normDate}|${normAmt}|${normType}|${normRef}|${normNarr}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Parse CSV / TSV text rows into normalized bank transaction objects
 */
function parseBankStatement(csvText, bankCode = 'generic') {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Determine separator (comma or tab)
  const sep = lines[0].includes('\t') ? '\t' : ',';

  // Helper to split CSV row handling quoted fields
  const splitRow = (row) => {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === sep && !inQuotes) {
        res.push(cur.trim().replace(/^["']|["']$/g, ''));
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim().replace(/^["']|["']$/g, ''));
    return res;
  };

  // Find header row
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const row = splitRow(lines[i]).map(h => h.toLowerCase());
    if (row.some(h => h.includes('date')) && (row.some(h => h.includes('narration') || h.includes('description') || h.includes('particular')))) {
      headerIdx = i;
      headers = row;
      break;
    }
  }

  if (headerIdx === -1) {
    // Default fallback to first line
    headerIdx = 0;
    headers = splitRow(lines[0]).map(h => h.toLowerCase());
  }

  const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

  const dateCol = findCol(['date', 'txn date', 'value date', 'trans date']);
  const narrCol = findCol(['narration', 'description', 'particulars', 'remarks', 'details']);
  const refCol  = findCol(['chq', 'ref', 'utr', 'cheque', 'reference', 'txn id']);
  const drCol   = findCol(['debit', 'withdrawal', 'dr', 'dr amount']);
  const crCol   = findCol(['credit', 'deposit', 'cr', 'cr amount']);
  const balCol  = findCol(['balance', 'closing balance', 'bal']);

  const parsed = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    if (cols.length < 3) continue;

    const rawDate = dateCol >= 0 ? cols[dateCol] : cols[0];
    const narration = narrCol >= 0 ? cols[narrCol] : (cols[1] || '');
    const ref = refCol >= 0 ? cols[refCol] : '';

    let debit = 0;
    let credit = 0;

    if (drCol >= 0 && cols[drCol]) {
      debit = parseFloat(String(cols[drCol]).replace(/[^0-9.-]/g, '')) || 0;
    }
    if (crCol >= 0 && cols[crCol]) {
      credit = parseFloat(String(cols[crCol]).replace(/[^0-9.-]/g, '')) || 0;
    }

    if (debit === 0 && credit === 0) {
      // Check single amount column with Dr/Cr sign
      const amtCol = findCol(['amount']);
      if (amtCol >= 0 && cols[amtCol]) {
        const val = parseFloat(String(cols[amtCol]).replace(/[^0-9.-]/g, '')) || 0;
        if (cols[amtCol].toLowerCase().includes('cr') || val > 0) credit = Math.abs(val);
        else debit = Math.abs(val);
      }
    }

    if (debit === 0 && credit === 0) continue;

    // Normalize date to YYYY-MM-DD
    let normalizedDate = new Date().toISOString().slice(0, 10);
    try {
      const cleanDate = rawDate.replace(/[^\d/.-]/g, '');
      const parts = cleanDate.split(/[/.-]/);
      if (parts.length === 3) {
        if (parts[2].length === 4) {
          // DD/MM/YYYY
          normalizedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        } else if (parts[0].length === 4) {
          // YYYY-MM-DD
          normalizedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
      }
    } catch (e) { }

    parsed.push({
      date: normalizedDate,
      narration: narration.trim(),
      ref: ref.trim(),
      debit: Math.abs(debit),
      credit: Math.abs(credit),
      type: credit > 0 ? 'credit' : 'debit',
      amount: credit > 0 ? credit : debit,
      balance: balCol >= 0 ? parseFloat(String(cols[balCol]).replace(/[^0-9.-]/g, '')) || 0 : 0
    });
  }

  return parsed;
}

/**
 * Fuzzy party matching against Customers & Vendors
 */
function matchTransactionToParty(txn, customers = [], vendors = [], customRules = []) {
  const narr = String(txn.narration || '').toUpperCase();
  const ref = String(txn.ref || '').toUpperCase();
  const combined = `${narr} ${ref}`;

  // 1. Check custom learned rules first
  for (const rule of customRules) {
    if (rule.keyword && combined.includes(rule.keyword.toUpperCase())) {
      return {
        matched: true,
        matchType: 'rule',
        ruleId: rule.id,
        partyType: rule.partyType || (txn.type === 'credit' ? 'customer' : 'vendor'),
        partyId: rule.partyId,
        partyName: rule.partyName,
        ledgerId: rule.ledgerId,
        ledgerName: rule.ledgerName,
        confidence: 100
      };
    }
  }

  // 2. Target list: if credit, check customers; if debit, check vendors
  const parties = txn.type === 'credit'
    ? customers.map(c => ({ ...c, partyType: 'customer' }))
    : vendors.map(v => ({ ...v, partyType: 'vendor' }));

  let bestMatch = null;
  let highestScore = 0;

  for (const party of parties) {
    const namesToCheck = [party.name, ...(party.aliases || [])].filter(Boolean);

    for (const name of namesToCheck) {
      const cleanName = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
      if (!cleanName || cleanName.length < 3) continue;

      // Exact substring match
      if (combined.includes(cleanName)) {
        return {
          matched: true,
          matchType: 'exact',
          partyType: party.partyType,
          partyId: party.id,
          partyName: party.name,
          ledgerId: party.partyType === 'customer' ? `led_cust_${party.id}` : `led_vend_${party.id}`,
          ledgerName: party.name,
          confidence: 95
        };
      }

      // Word-level token match (e.g. "TECH MAHINDRA LTD" matching "NEFT-TECH-MAHINDRA")
      const words = cleanName.split(' ').filter(w => w.length >= 4 && !['LTD', 'PVT', 'LIMITED', 'CORP', 'AND'].includes(w));
      if (words.length > 0) {
        const matchedWords = words.filter(w => combined.includes(w));
        const score = (matchedWords.length / words.length) * 100;

        if (score >= 70 && score > highestScore) {
          highestScore = score;
          bestMatch = {
            matched: true,
            matchType: 'fuzzy',
            partyType: party.partyType,
            partyId: party.id,
            partyName: party.name,
            ledgerId: party.partyType === 'customer' ? `led_cust_${party.id}` : `led_vend_${party.id}`,
            ledgerName: party.name,
            confidence: Math.round(score)
          };
        }
      }
    }
  }

  if (bestMatch && highestScore >= 70) {
    return bestMatch;
  }

  // Unmatched: send to Suspense
  return {
    matched: false,
    matchType: 'none',
    partyType: null,
    partyId: null,
    partyName: null,
    ledgerId: 'led_suspense',
    ledgerName: 'Suspense Account (Unallocated Bank / Audit)',
    confidence: 0,
    suspenseReason: txn.type === 'credit'
      ? 'Unmatched bank deposit (Receipt): Customer could not be identified from narration'
      : 'Unmatched bank withdrawal (Payment): Vendor or expense ledger could not be identified'
  };
}

/**
 * Process and post an entire bank statement
 */
async function processBankStatement({
  companyId = 'default',
  bankAccountId = 'led_bank_default',
  rawCsv = '',
  customers = [],
  vendors = [],
  user = {}
}) {
  const rows = parseBankStatement(rawCsv);
  if (!rows.length) {
    throw new Error('No valid transaction rows found in the provided bank statement.');
  }

  const txnCol = await getCollection('bank_txns');
  const rulesCol = await getCollection('bank_rules');
  const customRules = await rulesCol.find({ companyId }).toArray();

  let postedCount = 0;
  let duplicateCount = 0;
  let suspenseCount = 0;
  let suspenseAmount = 0;

  for (const row of rows) {
    const hash = computeTxnHash(bankAccountId, row.date, row.amount, row.type, row.ref, row.narration);

    // Check duplicate
    const existing = await txnCol.findOne({ hash });
    if (existing) {
      duplicateCount++;
      continue;
    }

    const match = matchTransactionToParty(row, customers, vendors, customRules);
    const isSuspense = !match.matched;

    if (isSuspense) {
      suspenseCount++;
      suspenseAmount += row.amount;
    }

    let voucher = null;

    if (row.type === 'credit') {
      // Receipt: Dr Bank, Cr Party/Suspense
      voucher = await createVoucher({
        companyId,
        voucherType: 'receipt',
        date: row.date,
        narration: `Bank Auto-Entry: ${row.narration}`,
        partyId: match.partyId,
        partyName: match.partyName,
        docRef: row.ref || 'BANK-TXN',
        entries: [
          { ledgerId: bankAccountId, ledgerName: 'Bank Account', debit: row.amount, credit: 0 },
          { ledgerId: match.ledgerId, ledgerName: match.ledgerName, debit: 0, credit: row.amount }
        ]
      }, user);
    } else {
      // Payment: Dr Party/Expense/Suspense, Cr Bank
      voucher = await createVoucher({
        companyId,
        voucherType: 'payment',
        date: row.date,
        narration: `Bank Auto-Entry: ${row.narration}`,
        partyId: match.partyId,
        partyName: match.partyName,
        docRef: row.ref || 'BANK-TXN',
        entries: [
          { ledgerId: match.ledgerId, ledgerName: match.ledgerName, debit: row.amount, credit: 0 },
          { ledgerId: bankAccountId, ledgerName: 'Bank Account', debit: 0, credit: row.amount }
        ]
      }, user);
    }

    const txnRecord = {
      id: 'btxn_' + Math.random().toString(36).slice(2, 10),
      hash,
      companyId,
      bankAccountId,
      date: row.date,
      narration: row.narration,
      ref: row.ref,
      type: row.type,
      amount: row.amount,
      balance: row.balance,
      matched: match.matched,
      matchType: match.matchType,
      confidence: match.confidence,
      partyId: match.partyId,
      partyName: match.partyName,
      ledgerId: match.ledgerId,
      ledgerName: match.ledgerName,
      isSuspense,
      suspenseReason: match.suspenseReason || '',
      voucherId: voucher.id,
      voucherNo: voucher.voucherNo,
      createdAt: Date.now(),
      createdBy: user.name || 'System'
    };

    await txnCol.insertOne(txnRecord);
    postedCount++;
  }

  return {
    totalRows: rows.length,
    postedCount,
    duplicateCount,
    suspenseCount,
    suspenseAmount: Math.round(suspenseAmount * 100) / 100
  };
}

/**
 * Resolve a suspense transaction by creating a reclassification journal voucher
 */
async function resolveSuspenseTransaction(txnId, resolution, user = {}) {
  const { targetLedgerId, targetLedgerName, targetPartyId, targetPartyName, rememberRule, keyword } = resolution;

  const txnCol = await getCollection('bank_txns');
  const txn = await txnCol.findOne({ id: txnId });
  if (!txn) throw new Error('Bank transaction not found');
  if (!txn.isSuspense) throw new Error('Transaction is not in Suspense');

  // Reclassification voucher:
  // If original was credit (Receipt into Bank, credited Suspense):
  //   Dr Suspense, Cr Target Ledger
  // If original was debit (Payment from Bank, debited Suspense):
  //   Dr Target Ledger, Cr Suspense
  const entries = txn.type === 'credit' ? [
    { ledgerId: 'led_suspense', ledgerName: 'Suspense Account', debit: txn.amount, credit: 0 },
    { ledgerId: targetLedgerId, ledgerName: targetLedgerName, debit: 0, credit: txn.amount }
  ] : [
    { ledgerId: targetLedgerId, ledgerName: targetLedgerName, debit: txn.amount, credit: 0 },
    { ledgerId: 'led_suspense', ledgerName: 'Suspense Account', debit: 0, credit: txn.amount }
  ];

  const reclassVch = await createVoucher({
    companyId: txn.companyId,
    voucherType: 'journal',
    date: new Date().toISOString().slice(0, 10),
    narration: `Suspense resolution for Bank Txn ${txn.voucherNo}: Reclassified to ${targetLedgerName}`,
    partyId: targetPartyId,
    partyName: targetPartyName,
    docRef: txn.voucherNo,
    entries
  }, user);

  txn.isSuspense = false;
  txn.resolvedAt = Date.now();
  txn.resolvedBy = user.name || 'User';
  txn.resolvedLedgerId = targetLedgerId;
  txn.resolvedLedgerName = targetLedgerName;
  txn.reclassVoucherId = reclassVch.id;
  txn.reclassVoucherNo = reclassVch.voucherNo;

  await txnCol.replaceOne({ id: txnId }, txn);

  // If user requested to remember this rule, learn it!
  if (rememberRule && keyword && keyword.trim()) {
    const rulesCol = await getCollection('bank_rules');
    await rulesCol.insertOne({
      id: 'rule_' + Math.random().toString(36).slice(2, 8),
      companyId: txn.companyId,
      keyword: keyword.trim().toUpperCase(),
      ledgerId: targetLedgerId,
      ledgerName: targetLedgerName,
      partyId: targetPartyId || null,
      partyName: targetPartyName || null,
      partyType: txn.type === 'credit' ? 'customer' : 'vendor',
      createdAt: Date.now(),
      createdBy: user.name || 'User'
    });
  }

  return { ok: true, reclassVoucherNo: reclassVch.voucherNo };
}

/**
 * Get Suspense metrics for notification bell and dashboard badge
 */
async function getSuspenseSummary(companyId) {
  const txnCol = await getCollection('bank_txns');
  const items = await txnCol.find({ companyId, isSuspense: true }).toArray();

  const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return {
    count: items.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    items: items.sort((a, b) => b.createdAt - a.createdAt)
  };
}

module.exports = {
  computeTxnHash,
  parseBankStatement,
  matchTransactionToParty,
  processBankStatement,
  resolveSuspenseTransaction,
  getSuspenseSummary
};

