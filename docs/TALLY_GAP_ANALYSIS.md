# TALLY GAP ANALYSIS — MR Quoter (QuoteDesk Enterprise)

> **Generated:** 2026-11-24  
> **Analyst:** Automated Phase 2 — Cross-referenced against FEATURE_AUDIT.md  
> **Legend:** ✅ Exists | ⚠️ Partial | ❌ Missing

---

## 1. MASTERS

| # | Tally Feature | Status | Notes / Affected Files |
|---|---------------|--------|------------------------|
| 1.1 | **Company** (financial year, books-from date, GST details) | ⚠️ Partial | `settings.js`, `companies.js` — company record exists; no formal `financialYear.start`, `financialYear.end`, `booksFrom` fields; no year-end locking |
| 1.2 | **Ledger Groups** (28 Tally default groups) | ✅ Exists | `quotedesk-server/accounts.js` — 28 groups seeded in `initDefaultGroups()`; hierarchy encoded |
| 1.3 | **Ledgers** (create / alter / delete with group mapping) | ✅ Exists | `accounts.js` + `data/accounts.json`; CRUD routes `/api/accounts`; opening balance field present |
| 1.4 | **Stock Groups / Stock Categories** | ❌ Missing | No `stockGroups` or `stockCategories` model anywhere |
| 1.5 | **Stock Items** (linked to group, unit, HSN) | ❌ Missing | Materials exist in `costing-engine.js` as inline arrays; no independent `StockItem` model or CRUD |
| 1.6 | **Units of Measure** (simple & compound, e.g. 12 Nos = 1 Box) | ❌ Missing | No units model; free-text `unit` string on line items only |
| 1.7 | **Godowns / Locations** | ❌ Missing | Single implicit location; no godown model or stock-by-location tracking |
| 1.8 | **Cost Centres / Cost Categories** | ⚠️ Partial | `projects.js` acts as a cost centre proxy; no formal `CostCentre` model; no allocation % split across vouchers |
| 1.9 | **Currencies** (multi-currency with exchange rate history) | ❌ Missing | INR only; no `currencies` model; no exchange rate table |
| 1.10 | **Price Lists** (customer/date-range tiered pricing) | ❌ Missing | No price list model; manual unit price entry only |
| 1.11 | **Voucher Types** (custom numbering, default ledgers) | ⚠️ Partial | `vouchers.js` — 6 types (receipt, payment, journal, contra, sales, purchase); missing 10+ Tally types; no per-type configuration UI |
| 1.12 | **Parties** — Customer / Supplier with GSTIN, credit limit, credit period, bill-wise | ⚠️ Partial | `customers.js`, `suppliers.js` — GSTIN present; `creditLimit` / `creditPeriod` fields **missing**; no `outstandingBalance` real-time calc |

---

## 2. VOUCHERS

| # | Voucher Type | Status | Notes / Affected Files |
|---|--------------|--------|------------------------|
| 2.1 | **Payment** | ✅ Exists | `vouchers.js` — full Dr=Cr; routes `/api/vouchers`; numbered |
| 2.2 | **Receipt** | ✅ Exists | Same as above |
| 2.3 | **Contra** (cash↔bank) | ✅ Exists | Handled via journal type with contra flag |
| 2.3 | **Journal** | ✅ Exists | `vouchers.js` — multi-leg journal |
| 2.4 | **Sales Voucher** (auto-posts from invoice) | ✅ Exists | `server.js` `/api/invoices` → auto-posts to `vouchers` |
| 2.5 | **Purchase Voucher** (auto-posts from bill) | ✅ Exists | `server.js` `/api/bills` → auto-posts |
| 2.6 | **Debit Note** | ❌ Missing | `docType: 'dn'` defined in documents but no voucher posting flow; no Dr=Cr enforcement |
| 2.7 | **Credit Note** | ❌ Missing | `docType: 'cn'` defined but same gap as DN |
| 2.8 | **Sales Order** | ❌ Missing | No `salesOrder` model or route; CPO is customer-facing quotation, not an SO |
| 2.9 | **Purchase Order** | ❌ Missing | `cpo.js` is *Customer* PO; no Supplier PO / `purchaseOrder` model |
| 2.10 | **Delivery Note** (inventory impact on dispatch) | ⚠️ Partial | `challan.js` — DC exists as a document; **does not post stock movement** to any inventory ledger |
| 2.11 | **Receipt Note / GRN** (goods receipt note) | ❌ Missing | No GRN model or route |
| 2.12 | **Stock Journal** (inter-godown transfer, manufacturing) | ❌ Missing | No stock journal; `costing-engine.js` has BOM logic but no double-entry stock posting |
| 2.13 | **Memorandum Voucher** | ❌ Missing | No implementation |
| 2.14 | **Reversing Journal** | ❌ Missing | No auto-reversal on a future date |
| 2.15 | **Rejection In / Rejection Out** | ❌ Missing | No rejection note vouchers |

---

## 3. CORE ACCOUNTING ENGINE

| # | Feature | Status | Notes / Affected Files |
|---|---------|--------|------------------------|
| 3.1 | **Double-entry (Dr = Cr validation)** | ✅ Exists | `vouchers.js` `createVoucher()` — enforces balance before commit |
| 3.2 | **Voucher numbering series** | ✅ Exists | `numbering.js` — per-type sequential; FY-aware prefix |
| 3.3 | **Voucher alteration with audit trail** | ⚠️ Partial | `PUT /api/vouchers/:id` exists; no field-level diff log; no "last altered by / at" fields stored |
| 3.4 | **Voucher cancel** | ✅ Exists | `DELETE /api/vouchers/:id` sets `status:'cancelled'`; reverses ledger entries |
| 3.5 | **Voucher delete** | ⚠️ Partial | Cancel exists; hard delete not prevented after posting; no "narration on cancel" enforced |
| 3.6 | **Bill-by-bill allocation** (Agst Ref / On Account) | ❌ Missing | No `billAllocations` table; payments not linked to specific invoices |
| 3.7 | **Opening balances** (bulk import) | ⚠️ Partial | `openingBalance` field on ledger; no bulk-import UI/API; no verification that OB Dr = OB Cr |
| 3.8 | **Year-end closing & carry-forward** | ❌ Missing | No `yearClose()` process; no retained-earnings transfer; no new-year ledger reset |

---

## 4. GST & TAX (India)

| # | Feature | Status | Notes / Affected Files |
|---|---------|--------|------------------------|
| 4.1 | **CGST / SGST / IGST calculation** | ✅ Exists | `server.js` quote/invoice routes; `gst.js` rate tables |
| 4.2 | **HSN / SAC codes** | ✅ Exists | Stored on line items; `gst.js` lookup |
| 4.3 | **GSTR-1** (outward supplies return) | ❌ Missing | No GSTR-1 formatted export or B2B/B2C/HSN summary |
| 4.4 | **GSTR-3B** (monthly summary return) | ❌ Missing | No GSTR-3B report |
| 4.5 | **GSTR-2A / 2B reconciliation** | ❌ Missing | No purchase register matching against 2A/2B |
| 4.6 | **e-Invoice** (IRN / QR Code — IRP integration) | ❌ Missing | No IRN generation; no QR embedding on invoices |
| 4.7 | **e-Way Bill** | ✅ Exists | `ewaybill.js` — JSON generator for Part A & B |
| 4.8 | **TDS** (Tax Deducted at Source) | ❌ Missing | No TDS section codes, deduction on payment, TDS payable ledger |
| 4.9 | **TCS** (Tax Collected at Source) | ❌ Missing | No TCS implementation |
| 4.10 | **Reverse Charge Mechanism (RCM)** | ❌ Missing | No RCM flag on purchase vouchers; no RCM GST posting |
| 4.11 | **ITC Tracking Register** | ❌ Missing | No Input Tax Credit register; no ITC vs liability netting |
| 4.12 | **Composition Scheme** | ❌ Missing | No composition turnover limit or alternate tax rate |

---

## 5. INVENTORY

| # | Feature | Status | Notes / Affected Files |
|---|---------|--------|------------------------|
| 5.1 | **Stock Summary** (opening + in - out = closing) | ❌ Missing | No stock ledger; `costing-engine.js` has BOM but no movement tracking |
| 5.2 | **Batch / Lot tracking** | ❌ Missing | No batch model |
| 5.3 | **Expiry date tracking** | ❌ Missing | No expiry fields |
| 5.4 | **Serial number tracking** | ❌ Missing | No serial/IMEI model |
| 5.5 | **BOM / Manufacturing Journal** | ⚠️ Partial | `costing-engine.js` — BOM for aluminium products; not linked to double-entry stock posting |
| 5.6 | **Valuation methods** (FIFO / LIFO / Weighted Avg) | ❌ Missing | No valuation engine |
| 5.7 | **Reorder level alerts** | ❌ Missing | No reorder level field; no alert trigger |
| 5.8 | **Stock ageing analysis** | ❌ Missing | No stock age report |
| 5.9 | **Negative stock control** | ❌ Missing | No stock-on-hand check before dispatch |
| 5.10 | **Unit conversion** (e.g. kg ↔ g) | ❌ Missing | No compound unit or conversion factor model |

---

## 6. BANKING

| # | Feature | Status | Notes / Affected Files |
|---|---------|--------|------------------------|
| 6.1 | **Bank Reconciliation (BRS)** | ✅ Exists | `bank.js` — statement import, unreconciled list, mark reconciled |
| 6.2 | **Bank Statement Import** (CSV/OFX) | ✅ Exists | `bank.js` `/api/bank/import` |
| 6.3 | **Cheque printing** | ❌ Missing | No cheque print template or layout |
| 6.4 | **Post-dated cheques (PDC)** | ❌ Missing | No PDC register or future-date hold |
| 6.5 | **Payment advice** | ❌ Missing | No payment advice PDF generation |

---

## 7. REPORTS

| # | Report | Status | Notes / Affected Files |
|---|--------|--------|------------------------|
| 7.1 | **Balance Sheet** | ✅ Exists | `reports.js` — full BS with group hierarchy |
| 7.2 | **Profit & Loss** | ✅ Exists | `reports.js` |
| 7.3 | **Trial Balance** | ✅ Exists | `reports.js` |
| 7.4 | **Day Book** | ✅ Exists | `reports.js` — all vouchers by date |
| 7.5 | **Cash Book** | ⚠️ Partial | Can filter Day Book by cash ledger; no dedicated Cash Book view/route |
| 7.6 | **Bank Book** | ⚠️ Partial | Same — filter only; no dedicated view |
| 7.7 | **Ledger Vouchers** (statement with running balance) | ✅ Exists | `reports.js` `/api/reports/ledger-statement` |
| 7.8 | **Group Summary** | ⚠️ Partial | Trial Balance shows group totals; no drill-down group summary screen |
| 7.9 | **Cash Flow Statement** | ❌ Missing | No cash flow (operating/investing/financing) |
| 7.10 | **Fund Flow Statement** | ❌ Missing | No fund flow |
| 7.11 | **Ratio Analysis** | ❌ Missing | No liquidity/profitability ratios |
| 7.12 | **Outstanding Receivables** | ❌ Missing | No AR ageing or outstanding list |
| 7.13 | **Outstanding Payables** | ❌ Missing | No AP ageing or outstanding list |
| 7.14 | **Ageing Analysis** (AR/AP buckets: 0-30, 31-60, 61-90, 90+) | ❌ Missing | No ageing engine |
| 7.15 | **Sales Register** | ❌ Missing | No dedicated sales voucher register |
| 7.16 | **Purchase Register** | ❌ Missing | No dedicated purchase register |
| 7.17 | **GST Reports** (GSTR-1 / GSTR-3B formatted) | ⚠️ Partial | `reports.js` `/api/reports/gst-summary` — summary only; no GSTR-1 B2B/B2C/HSN breakdown |
| 7.18 | **Stock Reports** (stock summary, movement, ageing) | ❌ Missing | No inventory reports |
| 7.19 | **Cost Centre Reports** | ⚠️ Partial | `projects.js` financial view; no cost centre P&L across multiple projects |
| 7.20 | **Budget vs Actual** | ❌ Missing | No budget model or variance report |

---

## 8. OTHER FEATURES

| # | Feature | Status | Notes / Affected Files |
|---|---------|--------|------------------------|
| 8.1 | **Budgets and controls** | ❌ Missing | No budget model; no over-budget alerts |
| 8.2 | **Payroll** (employees, attendance, salary, PF/ESI/PT) | ❌ Missing | No payroll module |
| 8.3 | **Interest calculation** (on overdue bills) | ❌ Missing | No interest accrual engine |
| 8.4 | **Multi-currency** | ❌ Missing | INR only; `currencies.js` does not exist |
| 8.5 | **Multi-user roles and security** | ✅ Exists | `auth.js`, `users.js` — role-based access; admin / regular roles |
| 8.6 | **Multi-company** | ✅ Exists | `companies.js` — company switching in session |
| 8.7 | **Backup / Restore** | ❌ Missing | No export-all or restore-from-backup API |
| 8.8 | **Excel / CSV import** | ⚠️ Partial | Export: Zoho CSV + Tally XML; **import**: bank CSV only; no ledger/voucher bulk import |
| 8.9 | **PDF / Print — Invoice templates** | ✅ Exists | `print-templates.js` — quote, invoice, challan, CPO PDF |
| 8.10 | **Keyboard-first navigation & shortcuts** | ❌ Missing | No keyboard shortcuts; mouse-only UI |
| 8.11 | **Search and drill-down** | ⚠️ Partial | Global search exists; no Ctrl+Enter voucher drill-down |
| 8.12 | **Data validation** | ⚠️ Partial | Server-side validation on key routes; no cross-field GST validation; no duplicate-voucher guard |
| 8.13 | **Audit log** | ⚠️ Partial | `data/audit_logs.json` for logins; voucher cancel logged; no field-level diff log on edit |

---

## 9. SUMMARY SCORECARD

| Category | Total Items | Exists | Partial | Missing |
|----------|------------|--------|---------|---------|
| Masters | 12 | 2 | 5 | 5 |
| Vouchers | 15 | 6 | 2 | 7 |
| Core Engine | 8 | 3 | 3 | 2 |
| GST & Tax | 12 | 3 | 0 | 9 |
| Inventory | 10 | 0 | 1 | 9 |
| Banking | 5 | 2 | 0 | 3 |
| Reports | 20 | 5 | 5 | 10 |
| Other | 13 | 3 | 4 | 6 |
| **TOTAL** | **95** | **24 (25%)** | **20 (21%)** | **51 (54%)** |

---

## 10. PRIORITY RISK REGISTER

| Risk | Impact | Mitigation |
|------|--------|------------|
| Floating-point money arithmetic in legacy quote/invoice code | Silent rounding errors on large invoices | Convert to integer-paise in M1 |
| No bill-by-bill allocation → reconciliation impossible | Cannot clear outstanding invoices | Critical — build in M2 |
| No stock ledger → inventory values invisible in BS | Balance sheet understated | Build in M4 |
| No GSTR-1/3B → compliance gap | Penalty risk | Build in M5 |
| No year-end closing → carry-forward manual | Error-prone | Build in M2 |
| Opening balance Dr ≠ Cr unchecked | Trial Balance starts wrong | Validation in M1 |

---

*End of Gap Analysis — Phase 3 Implementation Plan follows next.*
