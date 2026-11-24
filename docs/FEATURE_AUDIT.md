# Comprehensive Feature & Architecture Audit (Phase 1)
**Project:** MR_Quoter (QuoteDesk Enterprise Platform)  
**Date of Audit:** November 24, 2026  
**Auditor:** Senior Full-Stack Engineer & Accounting Software Architect  
**Audit Scope:** Full repository scan (Read-Only) in preparation for TallyPrime-style accounting expansion.

---

## 1. Technology Stack Summary

| Layer | Technology | Details / Version |
|---|---|---|
| **Runtime Environment** | Node.js | v18.0.0+ (Tested on v24.19.0) |
| **Backend Framework** | Express.js | `^4.18.3` / `^4.19.2`, CommonJS modules |
| **Database** | MongoDB Atlas / Local JSON | Dual-mode: MongoDB Atlas via driver `^7.7.0` with transparent local disk fallback in `./data/*.json` |
| **ORM / Data Access** | Custom MongoDB-Compatible Abstraction | Layered in `db.js` providing `find()`, `findOne()`, `insertOne()`, `updateOne()`, `deleteMany()`, `countDocuments()` |
| **Authentication & Session** | Cookies & Salted SHA-256 | Cookie-based session tokens with `cookie-parser ^1.4.6`, salted SHA-256 password hashing, Master Admin 2FA (TOTP RFC 6238) |
| **Security & Rate Limiting** | Express-Rate-Limit | `^8.7.5` guarding auth, registrations, and general API endpoints |
| **Email Transports** | Nodemailer & HTTP APIs | Multi-tier: Resend API (HTTPS 443), Brevo API (HTTPS 443), and fallback to SMTP (`nodemailer ^10.2.0`) |
| **PDF Generation** | PDFKit & html2pdf.js | Backend: `pdfkit ^0.20.2` with custom TrueType fonts (`bold.ttf`, `regular.ttf`); Frontend: `html2pdf.js 0.10.1` |
| **Barcode / QR Engine** | QRCode | `qrcode ^1.5.4` for statutory invoice and quotation UPI payments |
| **Spreadsheet Engine** | SheetJS (xlsx) | Frontend client-side `xlsx.full.min.js 0.18.5` |
| **Frontend Framework** | Vanilla JS / Web Components | Lightweight, zero-build client SPA with dynamic hash routing (`#/*`), DOM manipulation, and Framer Motion (`motion.js`) |
| **Test Suite** | Vitest & Playwright | `vitest ^5.0.5` (13 test suites, 87 unit tests), `playwright ^1.64.1` for end-to-end automation |
| **Linter & Code Quality** | ESLint & TypeScript | `eslint ^10.14.0`, TypeScript `^7.0.2` (`tsc --noEmit`) |

---

## 2. Folder Map & Architecture

### High-Level Directory Layout
```
MR_Quoter/
├── docs/                                 # Architectural specifications & audits
│   └── FEATURE_AUDIT.md                 # This document
├── modules/                             # Client-side module mirror for root HTML access
│   ├── accounting-ui.js                 # Accounting hub, vouchers, COA, reports UI
│   ├── documents-ui.js                  # Document editor, lines, M-sheet, E-way bill UI
│   └── print-templates.js               # Universal statutory print/PDF HTML generators
├── QuoteDesk (3).html                   # Standalone single-file distribution (byte-for-byte synced)
├── quotedesk-server/quotedesk-server/   # Primary server application root
│   ├── accounts.js                      # Chart of Accounts & 28 standard Tally groups
│   ├── bank.js                          # Bank statement ingestion, BRS & suspense allocation
│   ├── challan.js                       # Delivery Challan engine (dual-mode Rule 55 PDF)
│   ├── costing-engine.js                # Aluminum fabrication BOM & cutting-list engine
│   ├── db.js                            # Dual MongoDB / JSON file database manager
│   ├── documents.js                     # Phase 1 Universal Document Engine (PI, CPO, DC, INV, etc.)
│   ├── ewaybill.js                      # NIC statutory E-Way Bill JSON generator
│   ├── exports.js                       # Tally Prime XML & Zoho Books CSV export service
│   ├── measurement.js                   # M-Sheet & billable variation tracking
│   ├── numbering.js                     # Statutory numbering allocator (<= 16 chars)
│   ├── pettycash.js                     # Imprest petty cash vouchers & reconciliation
│   ├── pricing-engine.js                # Legacy quote formula pricing calculator
│   ├── procurement.js                   # 3-way matching engine (PO vs DC/GRN vs Invoice)
│   ├── projects.js                      # Project master, cost center & budget tracking
│   ├── rabill.js                        # Running Account (RA) progress billing engine
│   ├── reports.js                       # Financial reports (Trial Balance, P&L, Balance Sheet)
│   ├── server-pdf.js                    # Quotation PDF generator with UPI QR code
│   ├── server.js                        # Main Express server entry point (91 API routes)
│   ├── vouchers.js                      # Double-entry voucher engine (Dr = Cr validation)
│   ├── data/                            # Persistent JSON tables (when MongoDB is offline)
│   ├── public/                          # Static assets, web SPA root, images, icons
│   │   ├── index.html                   # Primary Web Application Entry Point
│   │   ├── modules/                     # Live modular JavaScript components
│   │   └── img/                         # Verified brand logo and visual media
│   └── tests/                           # Unit and integration test suites
│       └── unit/                        # 13 Vitest unit test suites (87 passing tests)
```

### Module Interconnection Architecture
```
                         ┌──────────────────────────────────────────────┐
                         │       Client Web SPA (index.html / Hash)     │
                         └──────┬──────────────────┬─────────────────┬──┘
                                │                  │                 │
                 ┌──────────────▼──────┐   ┌───────▼────────┐  ┌─────▼──────────┐
                 │  documents-ui.js    │   │accounting-ui.js│  │print-templates │
                 └──────────────┬──────┘   └───────┬────────┘  └─────┬──────────┘
                                │                  │                 │
                                └──────────────────┼─────────────────┘
                                                   │ HTTP / JSON REST
                                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               Express Server (server.js)                               │
├────────────────────┬────────────────────┬────────────────────┬─────────────────────────┤
│ Auth & 2FA Gate    │ Numbering & Series │ Document Engine    │ Accounting Core         │
│ (sessions, cookies)│ (numbering.js)     │ (documents.js)     │ (vouchers.js, accounts) │
├────────────────────┼────────────────────┼────────────────────┼─────────────────────────┤
│ Delivery Challan   │ Measurement Sheet  │ Projects & Costing │ Reports Engine          │
│ (challan.js)       │ (measurement.js)   │ (projects.js)      │ (reports.js)            │
├────────────────────┼────────────────────┼────────────────────┼─────────────────────────┤
│ Bank & BRS         │ Petty Cash Imprest │ Procurement Match  │ External Integrations   │
│ (bank.js)          │ (pettycash.js)     │ (procurement.js)   │ (exports.js, ewaybill)  │
└────────────────────┴────────────────────┴────────────────────┴─────────────────────────┘
                                                   │
                                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Data Storage Layer (db.js)                                │
│          [MongoDB Atlas Cloud]  <---- automatic fallback ---->  [Local JSON Files]     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. A to Z Master Inventory of Existing Features

### A — Accounts & Ledgers (Chart of Accounts)
- **Status:** `[Working]`
- **Module:** `accounts.js`, `accounting-ui.js`
- **Features:**
  - Auto-initializes the canonical **28 Tally Prime Master Ledger Groups** (`Capital Account`, `Current Assets`, `Sundry Debtors`, `Sundry Creditors`, `Bank Accounts`, `Cash-in-hand`, `Direct Expenses`, `Indirect Incomes`, etc.).
  - Auto-seeds standard system ledgers: Bank Default, Petty Cash, Accounts Receivable, Accounts Payable, Output CGST (9%), Output SGST (9%), Output IGST (18%), Input CGST (9%), Input SGST (9%), Input IGST (18%), Sales Account, Cost of Goods Sold, Retained Earnings.
  - Multi-company ledger isolation (`companyId`).
  - Ledger balance calculation via debit/credit entries summation.

### B — Banking & Reconciliation (BRS)
- **Status:** `[Working]`
- **Module:** `bank.js`, `server.js` (`/api/bank/*`), `accounting-ui.js`
- **Features:**
  - Multi-format bank statement ingestion (HDFC, ICICI, SBI, Axis, Standard Chartered CSV/text).
  - Transaction hash duplicate detection preventing re-import of identical bank statements.
  - Auto-matching engine (reference matching, party name regex fuzzy matching, exact amount matching).
  - Suspense Account allocation system for unrecognized deposits/withdrawals.
  - User-defined automated bank rules for recurring counterparty narration patterns.

### C — Costing & BOM Engine (Fabrication Estimator)
- **Status:** `[Working]`
- **Module:** `costing-engine.js`, `server.js` (`/api/costing/calculate`)
- **Features:**
  - 60-Second automated Bill of Materials (BOM) calculation for architectural aluminum systems (e.g. Domal 27, 2-Track, 3-Track, Casement, Louvers).
  - Calculates outer frame, shutter profiles, glass area, mesh, hardware, rollers, locks, rubber gaskets, wool pile.
  - Computes cutting cutlists, material quantities in meters/sqm, wastage margins, and fabrication labor.

### D — Delivery Challan & E-Way Bill (Phase 2)
- **Status:** `[Working]`
- **Module:** `challan.js`, `ewaybill.js`, `public/modules/print-templates.js`
- **Features:**
  - **Dual-Mode CGST Rule 55 Delivery Challan:**
    1. *With Value (Commercial Transport Copy):* Displays HSN, rates, taxable values, and GST amounts for transport check-posts.
    2. *Without Value (Gate Pass / Site Copy):* Displays HSN, quantities, and UOM only; completely hides monetary values for site security and stores receipt.
  - Official Delivery Challan PDF streaming (`GET /api/documents/:id/challan/pdf?mode=with_value|without_value`).
  - Partial delivery tracking comparing cumulative dispatched quantities against source order items.
  - NIC E-Way Bill JSON Generator (Part-A and Part-B compliant) with 200 km/day validity calculator.

### E — Double-Entry Voucher Engine (Phase 4)
- **Status:** `[Working]`
- **Module:** `vouchers.js`, `server.js` (`/api/vouchers/*`), `accounting-ui.js`
- **Features:**
  - Strict mathematical double-entry balance check: **Total Debits = Total Credits**.
  - Rejects imbalanced transactions before database write.
  - Atomic voucher persistence into `vouchers` collection and normalized `ledger_entries` collection.
  - Voucher Types: `receipt`, `payment`, `journal`, `contra`, `sales`, `purchase`.
  - Sequential fiscal voucher numbering (e.g. `RCP/26-27/0001`, `PMT/26-27/0001`).
  - Non-destructive voucher cancellation with audit trail logging.

### F — Exports to Tally Prime & Zoho Books (Phase 7)
- **Status:** `[Working]`
- **Module:** `exports.js`, `server.js` (`/api/exports/*`)
- **Features:**
  - **Tally Prime XML Export:** Complete XML schema generating `All Masters` (Ledger groups, ledgers, GSTINs, opening balances) and `Vouchers` with `ALLLEDGERENTRIES.LIST`, `ISDEEMEDPOSITIVE`, and negative amount formatting.
  - **Zoho Books CSV Export:** Formats and downloads standardized CSVs for Invoices, Bills, Delivery Challans, Customers, and Chart of Accounts.
  - Configurable accounting integration mode (`native`, `hybrid`, `external`).

### G — GST Compliance & Statutory Invoicing
- **Status:** `[Working]`
- **Module:** `documents.js`, `numbering.js`, `print-templates.js`
- **Features:**
  - 16-character statutory document numbering compliant with Section 31 CGST Act and Rule 46 (e.g. `CTBI/26-27/0001` <= 16 chars).
  - Place of Supply (POS) validation: Intra-state (CGST + SGST) vs Inter-state (IGST).
  - Dual statutory entity addresses: Receiver (Billed To) vs Consignee (Shipped To / Site Store).
  - Statutory lock: Issued/finalised Tax Invoices are permanently locked against direct editing.

### H — Measurement Sheet (M-Sheet) & Variation Statement (Phase 3)
- **Status:** `[Working]`
- **Module:** `measurement.js`, `server.js` (`/api/documents/:id/measurement`)
- **Features:**
  - Joint site measurement entry (Opening ID, width, height, structural deductions).
  - Side-by-side comparison between contract bill of quantities (BOQ) and site execution measurements.
  - Billable variation statements computing positive/negative quantity variances.
  - Gatekeeper validation preventing invoicing beyond approved structural site measurements.

### I — Multi-Tenancy & Master Admin Control
- **Status:** `[Working]`
- **Module:** `server.js`, `public/index.html` (`viewCompanies()`, `viewRegistrations()`, `viewAudit()`)
- **Features:**
  - Complete data isolation by `companyId`.
  - Master Platform Administrator role (`isMaster`) with RFC 6238 TOTP two-factor authentication.
  - Self-service client registration flow with automatic notification to `RAFIQTN70@GMAIL.COM`.
  - Master Admin approval interface (`#/registrations`): Approve, Reject, Suspend, Delete.
  - Company login audit logger tracking staff IP addresses, user agents, timestamps, and security blocks.

### J — Petty Cash Imprest System (Phase 5)
- **Status:** `[Working]`
- **Module:** `pettycash.js`, `server.js` (`/api/pettycash/*`)
- **Features:**
  - Site-wise imprest petty cash tracking.
  - Head-office top-ups and site expenditure vouchers.
  - Automated Contra and Expense voucher generation for reconciliation.

### K — Procurement & 3-Way Matching (Phase 6)
- **Status:** `[Working]`
- **Module:** `procurement.js`, `server.js` (`/api/procurement/3way-match`)
- **Features:**
  - Three-way verification: Purchase Order (PO) vs Goods Receipt / Delivery Challan (GRN/DC) vs Supplier Commercial Bill.
  - Evaluates quantity deviations, unit rate discrepancies, and tax rate mismatches against configurable percentage tolerances.

### L — Projects & Cost Centers (Phase 6)
- **Status:** `[Working]`
- **Module:** `projects.js`, `server.js` (`/api/projects/*`)
- **Features:**
  - Project/Job cost center tracking.
  - Budget allocation vs actual recognized revenues and accumulated direct expenses.
  - Real-time project margin and profitability reporting.

### M — Quotation Lifecycle & Online Client Portal
- **Status:** `[Working]`
- **Module:** `server.js`, `public/index.html`, `server-pdf.js`
- **Features:**
  - Quotation creation, multi-item estimation, window schedule drawing tags.
  - Public shareable token link (`/q/:token`) allowing clients to view quotes online.
  - One-click online acceptance flow updating quote status to `Approved`.
  - Conversion of approved quotation directly into downstream documents (PI, CPO, Tax Invoice, DC, MRL).

### N — Reports Engine (Phase 4)
- **Status:** `[Working]`
- **Module:** `reports.js`, `server.js` (`/api/reports/*`)
- **Features:**
  - **Trial Balance:** Full hierarchy with Group Summaries and Debit/Credit columns.
  - **Profit & Loss Statement:** Revenue from Operations, Direct Costs, Gross Margin, Indirect Expenses, Net Profit/Loss.
  - **Balance Sheet:** Capital & Liabilities (Equities, Loans, Current Liabilities) vs Assets (Fixed Assets, Current Assets, Bank & Cash).
  - **Day Book:** Chronological ledger transaction journal for any selected date range.
  - **Ledger Statement:** Running debit/credit account statement with opening and closing balances.
  - **GST Summary Report:** Outward taxable supplies and Input Tax Credit (ITC) grouped by rate (5%, 12%, 18%, 28%).

### O — Running Account (RA) Progress Billing (Phase 3)
- **Status:** `[Working]`
- **Module:** `rabill.js`, `server.js` (`/api/documents/:id/rabill/calculate`)
- **Features:**
  - Progressive cumulative gross billing across multi-month commercial contracts.
  - Statutory deduction handling: Retention money (e.g. 5%), Mobilization advance recovery, TDS, and Labor cess.
  - Computes net payable amount for certified construction work.

### P — Universal Document Engine (Phase 1)
- **Status:** `[Working]`
- **Module:** `documents.js`, `server.js` (`/api/documents/*`)
- **Features:**
  - Supports 8 core document types:
    1. `pi`: Proforma Invoice
    2. `cpo`: Customer Purchase Order / Work Order
    3. `dc`: Delivery Challan
    4. `inv`: Tax Invoice
    5. `mrl`: Material Requisition List (Factory cutlist)
    6. `ra`: Running Account Bill
    7. `cn`: Credit Note
    8. `dn`: Debit Note
  - Revision management (`rev: 0, 1, 2...`) with mandatory change rationale.
  - Prior revisions marked `superseded: true` and locked immutably.
  - Automated side-by-side revision difference comparison (`/api/documents/:id/compare/:targetId`).

---

## 4. Complete Inventory of All 91 HTTP Endpoints

| # | Method | Endpoint Route | Module / Controller | Status | Roles / Access |
|---|---|---|---|:---:|---|
| 1 | `GET` | `/robots.txt` | Static | `[Working]` | Public |
| 2 | `GET` | `/sitemap.xml` | Static | `[Working]` | Public |
| 3 | `GET` | `/google568b31d06bc40311.html` | Static | `[Working]` | Public |
| 4 | `GET` | `/api/db` | `server.js` | `[Working]` | Authenticated |
| 5 | `POST` | `/api/db` | `server.js` | `[Working]` | Authenticated |
| 6 | `POST` | `/api/costing/calculate` | `costing-engine.js` | `[Working]` | Authenticated |
| 7 | `GET` | `/api/setup-needed` | `server.js` | `[Working]` | Public |
| 8 | `GET` | `/api/init` | `server.js` | `[Working]` | Public |
| 9 | `POST` | `/api/setup` | `server.js` | `[Working]` | Public (Init only) |
| 10 | `POST` | `/api/register` | `server.js` | `[Working]` | Public (Rate-limited) |
| 11 | `POST` | `/api/request-demo` | `server.js` | `[Working]` | Public (Rate-limited) |
| 12 | `POST` | `/api/login` | `server.js` | `[Working]` | Public (Rate-limited) |
| 13 | `POST` | `/api/admin/verify-otp` | `server.js` | `[Working]` | Master Admin 2FA |
| 14 | `POST` | `/api/admin/resend-otp` | `server.js` | `[Working]` | Master Admin 2FA |
| 15 | `POST` | `/api/admin/reset-data` | `server.js` | `[Working]` | Master Admin Only |
| 16 | `GET` | `/api/admin/login-audit` | `server.js` | `[Working]` | Master Admin Only |
| 17 | `GET` | `/api/admin/company-stats` | `server.js` | `[Working]` | Master Admin Only |
| 18 | `GET` | `/api/admin/company-activity/:id` | `server.js` | `[Working]` | Master Admin Only |
| 19 | `DELETE` | `/api/admin/companies/:id` | `server.js` | `[Working]` | Master Admin Only |
| 20 | `PUT` | `/api/admin/companies/:id` | `server.js` | `[Working]` | Master Admin Only |
| 21 | `POST` | `/api/admin/companies` | `server.js` | `[Working]` | Master Admin Only |
| 22 | `POST` | `/api/admin/companies/:id/send-credentials` | `server.js` | `[Working]` | Master Admin Only |
| 23 | `GET` | `/api/companies/public` | `server.js` | `[Working]` | Public |
| 24 | `POST` | `/api/admin/users/:id/reset-password` | `server.js` | `[Working]` | Admin / Master |
| 25 | `GET` | `/api/admin/registrations` | `server.js` | `[Working]` | Master Admin Only |
| 26 | `POST` | `/api/admin/registrations/:id/approve` | `server.js` | `[Working]` | Master Admin Only |
| 27 | `POST` | `/api/admin/registrations/:id/reject` | `server.js` | `[Working]` | Master Admin Only |
| 28 | `POST` | `/api/admin/registrations/:id/suspend` | `server.js` | `[Working]` | Master Admin Only |
| 29 | `DELETE` | `/api/admin/registrations/:id` | `server.js` | `[Working]` | Master Admin Only |
| 30 | `POST` | `/api/ai/diagnose` | `server.js` | `[Working]` | Authenticated |
| 31 | `POST` | `/api/logout` | `server.js` | `[Working]` | Authenticated |
| 32 | `GET` | `/api/me` | `server.js` | `[Working]` | Authenticated |
| 33 | `GET` | `/api/quotes/:id/pdf` | `server-pdf.js` | `[Working]` | Authenticated |
| 34 | `GET` | `/api/quotations/:id/pdf` | `server-pdf.js` | `[Working]` | Authenticated |
| 35 | `GET` | `/q/:token/pdf` | `server-pdf.js` | `[Working]` | Public via Token |
| 36 | `POST` | `/api/quotes/:id/email` | `server.js` | `[Working]` | Authenticated |
| 37 | `POST` | `/api/quotes/:id/email-pdf` | `server.js` | `[Working]` | Authenticated |
| 38 | `POST` | `/api/quotes/:id/share` | `server.js` | `[Working]` | Authenticated |
| 39 | `GET` | `/q/:token` | `server.js` | `[Working]` | Public via Token |
| 40 | `POST` | `/q/:token/accept` | `server.js` | `[Working]` | Public via Token |
| 41 | `POST` | `/api/ai/draft-items` | `server.js` | `[Working]` | Authenticated |
| 42 | `POST` | `/api/quotes/:id/payments` | `server.js` | `[Working]` | Authenticated |
| 43 | `GET` | `/api/quotes/:id/payments` | `server.js` | `[Working]` | Authenticated |
| 44 | `GET` | `/api/followups` | `server.js` | `[Working]` | Authenticated |
| 45 | `GET` | `/api/documents` | `documents.js` | `[Working]` | Authenticated |
| 46 | `POST` | `/api/documents` | `documents.js` | `[Working]` | Authenticated |
| 47 | `GET` | `/api/documents/:id` | `documents.js` | `[Working]` | Authenticated |
| 48 | `PUT` | `/api/documents/:id` | `documents.js` | `[Working]` | Authenticated |
| 49 | `DELETE` | `/api/documents/:id` | `documents.js` | `[Working]` | Authenticated |
| 50 | `POST` | `/api/documents/:id/revise` | `documents.js` | `[Working]` | Authenticated |
| 51 | `GET` | `/api/documents/:id/history` | `documents.js` | `[Working]` | Authenticated |
| 52 | `GET` | `/api/documents/:id/compare/:targetId` | `documents.js` | `[Working]` | Authenticated |
| 53 | `POST` | `/api/documents/:id/status` | `documents.js` | `[Working]` | Authenticated |
| 54 | `POST` | `/api/documents/convert-from-quote/:quoteId` | `server.js` | `[Working]` | Authenticated |
| 55 | `GET` | `/api/documents/:id/challan/pdf` | `challan.js` | `[Working]` | Authenticated |
| 56 | `POST` | `/api/documents/:id/ewaybill/json` | `ewaybill.js` | `[Working]` | Authenticated |
| 57 | `POST` | `/api/documents/:id/ewaybill/record` | `ewaybill.js` | `[Working]` | Authenticated |
| 58 | `GET` | `/api/documents/:id/pending-deliveries` | `challan.js` | `[Working]` | Authenticated |
| 59 | `GET` | `/api/documents/:id/measurement` | `measurement.js` | `[Working]` | Authenticated |
| 60 | `POST` | `/api/documents/:id/measurement` | `measurement.js` | `[Working]` | Authenticated |
| 61 | `GET` | `/api/documents/:id/measurement/pdf` | `measurement.js` | `[Working]` | Authenticated |
| 62 | `GET` | `/api/documents/:id/variation` | `measurement.js` | `[Working]` | Authenticated |
| 63 | `POST` | `/api/documents/:id/rabill/calculate` | `rabill.js` | `[Working]` | Authenticated |
| 64 | `GET` | `/api/accounts` | `accounts.js` | `[Working]` | Authenticated |
| 65 | `POST` | `/api/accounts` | `accounts.js` | `[Working]` | Authenticated |
| 66 | `GET` | `/api/vouchers` | `vouchers.js` | `[Working]` | Authenticated |
| 67 | `POST` | `/api/vouchers` | `vouchers.js` | `[Working]` | Authenticated |
| 68 | `POST` | `/api/vouchers/:id/cancel` | `vouchers.js` | `[Working]` | Authenticated |
| 69 | `GET` | `/api/reports/daybook` | `reports.js` | `[Working]` | Authenticated |
| 70 | `GET` | `/api/reports/ledger/:id` | `reports.js` | `[Working]` | Authenticated |
| 71 | `GET` | `/api/reports/trialbalance` | `reports.js` | `[Working]` | Authenticated |
| 72 | `GET` | `/api/reports/pnl` | `reports.js` | `[Working]` | Authenticated |
| 73 | `GET` | `/api/reports/balancesheet` | `reports.js` | `[Working]` | Authenticated |
| 74 | `GET` | `/api/reports/gst` | `reports.js` | `[Working]` | Authenticated |
| 75 | `POST` | `/api/bank/upload` | `bank.js` | `[Working]` | Authenticated |
| 76 | `GET` | `/api/bank/suspense` | `bank.js` | `[Working]` | Authenticated |
| 77 | `POST` | `/api/bank/suspense/:id/resolve` | `bank.js` | `[Working]` | Authenticated |
| 78 | `GET` | `/api/bank/rules` | `bank.js` | `[Working]` | Authenticated |
| 79 | `GET` | `/api/projects` | `projects.js` | `[Working]` | Authenticated |
| 80 | `POST` | `/api/projects` | `projects.js` | `[Working]` | Authenticated |
| 81 | `GET` | `/api/projects/:id/financials` | `projects.js` | `[Working]` | Authenticated |
| 82 | `GET` | `/api/pettycash/balance` | `pettycash.js` | `[Working]` | Authenticated |
| 83 | `POST` | `/api/pettycash/topup` | `pettycash.js` | `[Working]` | Authenticated |
| 84 | `POST` | `/api/pettycash/expense` | `pettycash.js` | `[Working]` | Authenticated |
| 85 | `POST` | `/api/pettycash/reconcile` | `pettycash.js` | `[Working]` | Authenticated |
| 86 | `POST` | `/api/procurement/3way-match` | `procurement.js` | `[Working]` | Authenticated |
| 87 | `GET` | `/api/exports/tally/xml` | `exports.js` | `[Working]` | Authenticated |
| 88 | `GET` | `/api/exports/zoho/csv` | `exports.js` | `[Working]` | Authenticated |
| 89 | `GET` | `/api/settings/accounting-integration` | `server.js` | `[Working]` | Authenticated |
| 90 | `POST` | `/api/settings/accounting-integration` | `server.js` | `[Working]` | Authenticated |
| 91 | `GET` | `*` | Static SPA Fallback | `[Working]` | Public |

---

## 5. Existing Data Models & Entity Relationships (ER Summary)

### 1. `accounts` (Chart of Accounts & Ledgers)
- **Primary Key:** `id` (e.g. `led_bank_default`)
- **Fields:** `id`, `name`, `code`, `groupId`, `groupName`, `nature` (`assets` \| `liabilities` \| `income` \| `expenses`), `isSystem` (bool), `companyId`, `openingBalance` (number), `openingBalanceType` (`Dr` \| `Cr`), `gstin`, `pan`, `email`, `phone`, `address`, `createdAt`.
- **Relationships:** Belongs to `companies`. Parent relationship to `groupId`. Referenced by `ledger_entries` and `vouchers`.

### 2. `vouchers` (Double-Entry Header)
- **Primary Key:** `id` (e.g. `vch_xxxx`)
- **Fields:** `id`, `voucherNo` (e.g. `RCP/26-27/0001`), `voucherType` (`receipt` \| `payment` \| `journal` \| `contra` \| `sales` \| `purchase`), `date` (YYYY-MM-DD), `companyId`, `narration`, `partyId`, `partyName`, `docRef`, `totalAmount`, `status` (`posted` \| `cancelled`), `cancelled` (bool), `createdAt`, `createdBy`, `billing` (JSON), `shipping` (JSON), `project`, `projectCode`, `site`, `poNo`, `poDate`, `vehicleNo`, `ewayBillNo`, `ewayBillDate`, `transporter`, `entries` (Array of Dr/Cr items).
- **Relationships:** Belongs to `companies`. 1-to-many with `ledger_entries`. Optional link to `documents` or `projects`.

### 3. `ledger_entries` (Individual Debit / Credit Legs)
- **Primary Key:** `id` (e.g. `ent_xxxx`)
- **Fields:** `id`, `voucherId`, `voucherNo`, `voucherType`, `date`, `companyId`, `ledgerId`, `ledgerName`, `debit` (number), `credit` (number), `narration`, `partyId`, `partyName`, `docRef`, `cancelled` (bool), `createdAt`.
- **Relationships:** Foreign key to `vouchers.id` and `accounts.id`.

### 4. `documents` (Universal Commercial & Logistics Documents)
- **Primary Key:** `id` (e.g. `inv_xxxx`, `dc_xxxx`, `pi_xxxx`)
- **Fields:** `id`, `rootId`, `rev` (int), `baseNo`, `no` (<= 16 chars), `docType` (`pi` \| `cpo` \| `dc` \| `inv` \| `mrl` \| `ra` \| `cn` \| `dn`), `date`, `companyId`, `companyCode`, `status` (`draft` \| `pending` \| `approved` \| `issued` \| `finalised` \| `cancelled`), `superseded` (bool), `revReason`, `subject`, `cust` (JSON), `shipping` (JSON), `vendor` (JSON), `project`, `projectCode`, `site`, `poNo`, `poDate`, `vehicleNo`, `ewayBillNo`, `ewayBillDate`, `transporter`, `lrNo`, `pos` (Place of Supply), `gstRate`, `isInterState`, `lines` (Array of line items with rate, qty, hsn, disc, tax), `totals` (subtotal, taxable, cgst, sgst, igst, grandTotal), `terms`, `notes`, `sourceDocId`, `sourceDocNo`, `metadata`, `shareToken`, `log` (Array of audit events).
- **Relationships:** Belongs to `companies`. Optional link to `quotes.id` or parent `documents.id`.

### 5. `projects` (Cost Centers & Jobs)
- **Primary Key:** `id` (e.g. `prj_xxxx`)
- **Fields:** `id`, `name`, `code`, `companyId`, `customerId`, `customerName`, `site`, `startDate`, `targetDate`, `budget` (number), `status` (`active` \| `completed` \| `hold`), `notes`, `createdAt`, `createdBy`.
- **Relationships:** Belongs to `companies`. Linked to `customers.id`, `documents.projectCode`, and `vouchers.projectCode`.

### 6. `bank_txns` & `bank_rules`
- **Primary Key:** `id`
- **Fields:** `id`, `hash` (SHA-256 of date+narration+amount), `companyId`, `bankAccountId`, `date`, `narration`, `ref`, `type` (`credit` \| `debit`), `amount`, `balance`, `matched` (bool), `matchType`, `isSuspense` (bool), `suspenseReason`, `voucherId`, `voucherNo`.
- **Relationships:** Foreign key to `accounts.id` (bank ledger) and `vouchers.id`.

### 7. `petty_cash` (Imprest Funds)
- **Primary Key:** `id`
- **Fields:** `id`, `companyId`, `site`, `type` (`topup` \| `expense`), `amount`, `date`, `notes`, `voucherId`, `voucherNo`, `createdAt`, `createdBy`.
- **Relationships:** Foreign key to `companies.id` and `vouchers.id`.

### 8. `companies` & `users` (Multi-Tenant Org & Staff)
- **Companies:** `id`, `name`, `code`, `active`, `createdAt`, `contactEmail`, `contactPhone`, `address`, `gstin`, `pan`.
- **Users:** `id`, `companyId`, `name`, `username`, `email`, `role` (`admin` \| `manager` \| `accounts` \| `estimator` \| `viewer`), `salt`, `pass`, `active`, `approvalStatus`.

### 9. `registrations` & `demoRequests` (SaaS Onboarding)
- **Registrations:** `id`, `fullName`, `email`, `salt`, `pass`, `registrationType` (`Company` \| `Individual`), `companyName`, `mobile`, `country`, `address`, `service`, `additionalReqs`, `status` (`PENDING` \| `APPROVED` \| `REJECTED` \| `SUSPENDED`), `registeredAt`, `approvedAt`, `approvedBy`.
- **Demo Requests:** `id`, `name`, `email`, `phone`, `company`, `preferredDate`, `message`, `createdAt`.

---

## 6. Integrations, Environment Variables & Config

### External Services & Gateways
1. **MongoDB Atlas:** Managed multi-region cloud cluster via `MONGODB_URI`.
2. **Resend API:** Transactional email delivery via HTTPS REST `https://api.resend.com/emails`.
3. **Brevo API (Sendinblue):** Secondary fallback transactional email API via `https://api.brevo.com/v3/smtp/email`.
4. **Google Gmail SMTP:** Tertiary fallback email transport (`smtp.gmail.com:465`).
5. **National Informatics Centre (NIC) E-Way Bill System:** JSON bulk-upload generation adhering to Government schema `v1.0.0421`.
6. **Tally Prime Interface:** XML standard exchange format for direct import into Tally Prime Release 1.0 - 4.0+.
7. **Zoho Books Interface:** CSV standardized import schemas.

### Environment Variables
- `PORT`: HTTP server listen port (default `3000`).
- `DATA_DIR`: Local database JSON directory (default `./data`).
- `MONGODB_URI`: Cloud connection string for MongoDB Atlas.
- `BASE_URL`: Production domain URL (`https://www.mrquoter.in`).
- `ADMIN_EMAIL`: Master admin alert recipient (`rafioffl20@gmail.com, rafiqtn70@gmail.com`).
- `MASTER_PASSWORD`: Master admin platform password.
- `MASTER_TOTP_SECRET`: Base32 secret for Master 2FA Authenticator.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`: SMTP configuration.
- `RESEND_API_KEY`: API token for Resend transactional emails.
- `BREVO_API_KEY`: API token for Brevo transactional emails.

---

## 7. Known Bugs, Dead Code, Redundancies & Technical Debt

| Item | Classification | Description & Impact | Recommendation for Tally Expansion |
|---|---|---|---|
| **Floating Point Precision** | Tech Debt | Some calculations in legacy quotes and report totals use JS floating point arithmetic (`Math.round(...)`), risking 1-paisa rounding errors on large transactions. | Adopt integer paise or explicit decimal rounding utility (`roundPaise(amount)`) across the voucher and ledger engine. |
| **Monolithic Server File** | Tech Debt | `server.js` contains 4,370 lines combining authentication, quote handling, and dispatching. Modular services exist (`vouchers.js`, `documents.js`, `reports.js`), but `server.js` acts as an expansive aggregator. | Keep new accounting controllers decoupled inside dedicated modular files (`inventory.js`, `tax.js`, `payroll.js`) and mount via Express routers. |
| **Dual Codebase Synchronization** | Redundancy | `QuoteDesk (3).html` and `public/index.html` must remain 100% byte-for-byte synchronized. | Automated script verification after every milestone build to guarantee absolute synchronization. |
| **In-Memory Mock Fallback in Tests** | Partial Gap | Some unit tests mock DB operations in memory rather than testing against MongoDB queries directly. | Ensure new Tally accounting tests run both unit tests on balance rules and integration tests on DB transactions. |
| **Bill-by-Bill Allocation** | Missing | Vouchers have `partyId` and `docRef`, but there is currently no formal bill-by-bill FIFO adjustment table linking payments directly to specific invoice numbers (Agst Ref, New Ref, Advance, On Account). | Implement formal Tally-style bill settlement ledger in Milestone 2. |
| **Inventory Ledger Decoupling** | Missing | Materials exist in `costing-engine.js` and `quotedesk.json`, but are not yet formally linked to double-entry Stock-in-Hand ledger balances. | Connect stock movements (GRN / Delivery Note / Sales) to Inventory and COGS ledgers in Milestone 4. |

---

## 8. Audit Summary & Verdict
The repository has a solid, well-architected foundation:
- Multi-tenancy, authentication, role-based access, and statutory GST numbering are fully established and working.
- A functional double-entry accounting core (`accounts.js`, `vouchers.js`, `reports.js`, `bank.js`, `pettycash.js`, `projects.js`, `exports.js`) already exists and passes all 87 unit tests.
- Expanding into full TallyPrime accounting will **extend** and **enrich** these existing modules without requiring any breaking changes or disruptive rewrites.

Phase 1 Audit is complete and documented. Ready for Phase 2 Gap Analysis.
