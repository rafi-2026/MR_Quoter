# MR_QUOTER — Antigravity Implementation Prompt
### Add the "Excel-style auto costing engine" to my existing MR_QUOTER software

Copy everything below the line into Antigravity. Give it in **phases** (Phase 1 first, test, then Phase 2...). Do not paste all phases at once if the agent starts making mistakes.

---

## 0. ROLE AND GROUND RULES

You are a senior full-stack engineer. I already have a working web app called **MR_QUOTER** (running at `localhost:3000`, hash-routing like `/#/companies`). It is a multi-company quotation system for an **aluminium windows / doors / interiors & exteriors** business.

**Existing sidebar menu (do NOT remove or rename):** Dashboard, Quotes, Customers, Rate library, Users, Settings, Companies, Login IP Audit.
Existing roles: Master Admin (manages companies, sees IP audit) and company staff users. Data is separated per company (each company has its own code, e.g. CTPL, state, GSTIN).

**Rules**
1. FIRST read the whole existing codebase (stack, folder structure, DB/storage, auth, how Quotes, Customers, Rate library and Settings currently work). Tell me the stack you found and your plan in 10 lines. Then continue.
2. Extend the existing code. Do **not** rewrite the app, do not change the existing login, multi-company, IP audit or UI theme.
3. Every new table/collection must carry `company_id` and be filtered by the logged-in user's company (multi-tenant safe).
4. All money values: calculate with full precision, round **only where the Excel rounds** (described below). Currency is INR, format Indian style (₹3,74,997).
5. No hard-coded rates inside formulas. All rates, weights, margin, wastage, GST come from editable tables (Rate library / Settings).
6. After each phase, run the test cases in Section 9 and show me the results table (expected vs actual).

---

## 1. HOW WE CALCULATE MANUALLY IN EXCEL (what the software must copy)

My Excel file has one **quotation sheet** and many **costing sheets** (one per product type). The quotation sheet pulls the *Price per Sqft* from the costing sheet of that product, at that window's size.

### 1.1 Quotation sheet (what the customer sees)
Header: Quotation No (e.g. `CTPL - 252`), Date, Expiry Date, Client name, Location, CEO/contact, PRE (sales person) name and phone, Subject line ("Supply & fixing of aluminium windows work"), Series line ("Aluminium Windows – Domal 27 Series – Black (matt finish) powder coated").

Item table columns:
`Code | Design (image) | Window Type | Width (ft) | Height (ft) | Qty | Mesh | Handle Type | Glass | Total Area (sqft) | Price / Sqft | Total Price`

- Rows are grouped by floor/section headings: GROUND FLOOR, FIRST FLOOR, SECOND FLOOR (user can add any heading, e.g. "Living Room", "Elevation").
- `Total Area = Width × Height × Qty` (in **feet**, billing area).
- `Total Price = Total Area × Price/Sqft`.
- Total row: sum of Qty, sum of Area, sum of Price, and **Average rate = ROUND(Total Price ÷ Total Area, 0)**.
- `Transportation Charges` (manual amount, e.g. ₹6,000).
- `Total Value Excluding GST = Items Total + Transportation`.
- `Total Value Including GST = Excl. GST × 1.18` (GST % editable, default 18%).
- Footer: Notes (scaffolding/electricity/water by client; final price subject to actual site measurement), Payment terms (100% advance with PO), "For <Company name>", Authorized signature / Customer signature, Bank details (bank, branch, A/c no, IFSC, GST no).

### 1.2 Costing sheet per product (this is the heart — currently done by hand per window)
For **one window of given size**, the sheet builds a Bill of Materials (BOM):

```
W = Width_ft × 0.3048      (metres)
H = Height_ft × 0.3048     (metres)
A = W × H                  (square metres)   ← costing area
```

BOM line types:
| Type | Formula |
|---|---|
| **Aluminium profile** | `Length(m) × Nos × Weight(kg/m) × AluminiumRate(₹/kg)` |
| **Gasket / brush seal** | `Length(m) × ₹ per metre` |
| **Hardware** (rollers, locks, handles, cleats, hinges, friction stay…) | `Nos × unit price` |
| **Labour** | `A × labour rate per sqm` |
| **Glass** | `A × glass rate per sqm` (rate depends on glass type chosen) |
| **SS Mesh** | `(A ÷ 2) × mesh rate per sqm` — only if Mesh ≠ "NA" |

Then:
```
Subtotal      = sum of all BOM lines
Wastage       = Subtotal × 5%                      (editable, default 5%)
Total Cost    = Subtotal + Wastage
Margin        = ROUND(Total Cost × 35%, 0)         (editable, default 35%; markup on cost)
Price Ex-Tax  = ROUND(Total Cost + Margin, 0)      ← price of ONE window
Rate / Sqm    = ROUND(Price Ex-Tax ÷ A, 0)
Rate / Sqft   = ROUND(Rate/Sqm ÷ 10.764, 0)        ← this goes to the quotation "Price/Sqft"
Price Incl GST = ROUND(Price Ex-Tax × 1.18, 0)     (shown for reference)
```
Important: the rate per sqft **changes with size** (e.g. 10×6 ft = ₹597, 9×6 ft = ₹613, 8×8 door = ₹623) because frame/hardware don't scale linearly with area. So the rate must be **auto-calculated for every line from its own size**, never typed as a fixed number. If two lines have the same product + same size + same options, they get the same rate.

### 1.3 Site measurement converter (mm → feet) — separate sheet "M.Sheet"
Site measurements come in **mm**. Convert to billing feet with the rounding rule:
```
feet = mm ÷ 304.8
whole = floor(feet);  frac = feet − whole
if frac < 0.3        → whole
if 0.3 ≤ frac ≤ 0.7  → whole + 0.5
if frac > 0.7        → whole + 1
```
Examples: 3000 mm → 9.84 ft → **10**; 1850 mm → 6.07 → **6**; 2150 mm → 7.05 → **7**; 2350 mm → 7.71 → **8**.
Also show "actual sqft = mm×mm×qty×10.764 ÷ 10⁶" next to "billing sqft = rounded W × rounded H × qty" so the user sees the difference.

### 1.4 Combined products (Fixed + Sliding door, Fixed + Openable, Fixed + Top-hung, Fixed + 2T…)
A tall opening is split into a **fixed part** and an **operable part**. Each part is costed with its own BOM, then:
`Rate/Sqft for the whole opening = (Fixed price + Operable price) ÷ total opening area`.
(Example in my Excel: door 4 ft × 23 ft = fixed 16 ft high + sliding 7 ft high.)

---

## 2. DATA MODEL TO ADD (per company)

```
settings_costing        (1 row per company)
  aluminium_rate_per_kg  = 500
  wastage_pct            = 5
  margin_pct             = 35
  gst_pct                = 18
  labour_rate_per_sqm    = 500
  sqft_per_sqm           = 10.764
  ft_to_m                = 0.3048

materials               (Rate library — extend the existing one)
  id, company_id, category  [profile | glass | mesh | hardware | gasket | labour]
  code (profile no. like 5045), name, unit [kg/m | sqm | nos | m]
  weight_kg_per_m (profiles only), rate, active

product_templates       (one per product type)
  id, company_id, name, series (e.g. "Domal 27"), category [window|door|ventilator|combo]
  allowed_glass[], allows_mesh (bool), default_handle
  min/max size (optional warning)

template_lines          (the BOM of a template)
  id, template_id, sl_no, description, kind [profile|gasket|hardware|labour|glass|mesh]
  material_id (nullable), profile_no, weight_kg_per_m, unit_price
  length_expr   (text formula using W, H, A and earlier lines, e.g. "W", "H", "3*W", "H+0.15")
  nos_expr      (e.g. "2", "4")
  condition     (e.g. "mesh != 'NA'")

glass_types             (name → rate/sqm)  e.g. 5mm Clear 600, 6mm Toughened 850, 8mm Toughened Clear 1200
mesh_types / handle_types (name list; handle may have price)

quotes                  (extend existing)  + client, location, contact, pre_name, pre_phone,
                        subject, series_line, expiry_date, transport_charges, gst_pct,
                        margin_pct_override (nullable), status
quote_sections          (Ground floor / First floor …) with sort order
quote_items             + section_id, code, template_id, width_ft, height_ft, qty, mesh, handle, glass_id,
                        area_sqft, rate_per_sqft (calculated), total_price,
                        rate_override (nullable, with reason), cost_breakdown_json (snapshot)
site_measurements       (optional) mm width, mm height, qty → converted ft
```
Store a **snapshot of the BOM and rates** inside each quote item when the quote is saved/approved so later rate changes don't silently change old quotes.

---

## 3. CALCULATION ENGINE (write once, unit-tested, reused by UI + API + PDF)

Create a pure function (no UI code inside), e.g. `calculateItem(template, widthFt, heightFt, options, settings, rates)` returning:
```
{ W, H, A, lines:[{description, qty, unit, rate, amount}], subtotal, wastage, totalCost,
  margin, priceExTax, ratePerSqm, ratePerSqft, priceInclGst }
```
- Evaluate `length_expr` / `nos_expr` with a **safe expression parser** (no `eval` on user text). Allowed variables: `W, H, A` plus named earlier lines.
- Round exactly as in 1.2 (margin rounded, price rounded, per-sqm rounded, per-sqft rounded).
- Also create `roundFeet(mm)` for 1.3 and `quoteTotals(items, transport, gst)` for 1.1.

---

## 4. SEED DATA (verified against my Excel — reproduces my Excel rates exactly)

**Settings:** aluminium ₹500/kg, wastage 5%, margin 35%, GST 18%, labour ₹500/sqm.
**Glass (₹/sqm):** 5mm Clear 600 · 4mm Frosted 600 · 6mm Toughened 850 · 8mm Toughened Clear 1200 · 6mm Toughened Tinted Brown 2000.
**SS Mesh:** ₹290/sqm (applied on A÷2). **Gasket:** ₹12/m (sliding), ₹10/m (fixed). **Brush seal:** ₹4/m.

### Template 1 — "2.5T – 2P Sliding Window" (Domal 27)  [sheet 2TM]
| Sl | Profile | Description | Length (m) | Nos | kg/m | Rate |
|---|---|---|---|---|---|---|
|1|5045|Outer Frame Top|W|1|1.28|₹/kg|
|2|5045|Outer Frame Bottom|W|1|1.28|₹/kg|
|3|5045|Outer Frame Verticals|H|2|1.28|₹/kg|
|4|5047|Sliding Sash Both Side|W|2|0.78|₹/kg|
|5|5047|Sliding Sash One Side|H|4|0.78|₹/kg|
|6|5042|Interlock|H|2|0.35|₹/kg|
|7|5043|Mesh Sash|3×W|1|0.90|₹/kg|
|8|—|Glazing Gasket for Shutter|(len of lines 4+5+7)|1|—|₹12/m|
|9|—|Brush Seal Shutter Frame|8×W + 8×H|1|—|₹4/m|
|10|—|Rollers|—|6|—|₹30 each|
|11|—|Touch Lock|—|2|—|₹45 each|
|12|—|Labour|A|1|—|₹500/sqm|
|13|—|Glass (selected)|A|1|—|glass rate|
|14|—|SS Mesh (if mesh)|A÷2|1|—|₹290/sqm|
|15|—|Wastage & Transportation|5% of lines 1–14| | | |

### Template 2 — "2.5T – 2P Sliding Door" [sheet SD]
Same as Template 1 except: Rollers **4 × ₹80**, Pop-up Handle **2 × ₹110**, Corner Cleat **4 × ₹31** (instead of Touch Lock), glass default 8mm Toughened Clear (₹1200).

### Template 3 — "Fixed Window" [sheet F]
| Profile | Description | Length | Nos | kg/m |
|---|---|---|---|---|
|5008|Outer Frame Top|W|2|0.60|
|5008|Outer Frame Vertical|H|2|0.60|
|5006|Mullion|H|2|0.68|
|5013|Glazing Bead Outer Frame|(top+vertical lengths)|1|0.26|
|5013|Glazing Bead Mullion|(mullion length)|2|0.26|
Gasket for beads ₹10/m on (bead lengths) · Labour **₹600/sqm** · Glass A × rate · Wastage 5%.

### Template 4 — "Ventilator with Adjustable Louver & Exhaust Fan Provision" [sheet V]
Like Fixed Window but: Mullion Vertical length `H+0.15`, Nos 1, 0.65 kg/m; Glazing Bead Mullion nos 2; Gasket nos ×2 at ₹10/m; Labour ₹500/sqm; Glass 4mm Frosted ₹600; no mesh.

### Templates 5+ (build the engine so I can add these from the UI)
Sheets `D`, `O`, `T`, `2T`, `F+SD`, `F+O`, `F+D`, `F+T`, `F+2TM` (door/openable/top-hung/Domal-2T/combination types) follow the same BOM pattern (see Section 1.4 for combos). My Excel for some of these contains broken `#REF!` links, so **do not auto-import them**; instead give me the Template Builder UI (Phase 3) and I will enter their BOMs.

---

## 5. UI CHANGES (inside the existing menus)

**Settings → "Costing settings"** tab: aluminium rate, wastage %, margin %, GST %, labour rate, with a "last changed by/when" line.

**Rate library** (already exists): add tabs **Profiles** (code, name, kg/m), **Glass**, **Mesh & Handles**, **Hardware**, **Gaskets**. Editable inline. Show "used in N templates".

**New sub-page under Rate library → "Product Templates"**: list of templates; open one to see/edit its BOM table (same look as my Excel costing sheet: Sl | Profile | Description | Length formula | Nos | kg/m | Unit price | Total). Include a **live preview**: type W ft and H ft at the top and see every line amount, Total, Margin, Price, Rate/Sqm, Rate/Sqft recalculate instantly. Buttons: Duplicate template, Add line, Reorder lines.

**Quotes → New/Edit Quote** (the main screen):
- Header form (client from Customers dropdown, location, contact, PRE name/phone, subject, series line, date, expiry date — default +30 days editable).
- Item grid like my Excel: Code, Product (dropdown from templates), Width ft, Height ft, Qty, Mesh (SS Mesh / NA), Handle, Glass (dropdown), then **auto** Area, Price/Sqft, Total. Rate updates live as soon as size/glass/mesh changes.
- "Add section" (GROUND FLOOR etc.), "Add item", "Duplicate row", drag to reorder, delete.
- A **"mm → ft" button** on width/height fields: user types mm and the field shows the rounded feet (rule 1.3). Also a small standalone **Site Measurement** tool page/modal for pasting many rows.
- Row action **"View cost breakdown"**: shows the BOM for that row with every line (this replaces opening the Excel costing sheet).
- Optional manual **rate override** per row (needs a reason; highlighted in orange; only roles with permission).
- Bottom summary box: Total Qty, Total Area, Total (items), Average Rate, Transportation (input), Total Ex-GST, GST %, GST amount, **Grand Total incl. GST**, and amount in words (Indian system).
- Show internal-only panel (visible to admin only, never in PDF): total material cost, total margin ₹ and margin % per quote.

**Dashboard:** add cards: quotes this month, total quoted value, approved value, avg rate per sqft.

**Output:** "Download PDF" and "Download Excel" of the quotation in **exactly my Excel layout** (company letterhead with logo, items table with design image column, totals, notes, payment terms, signature boxes, bank details, GST no). All company details (bank, terms, notes, GSTIN, signatory name) come from the company's profile in Companies/Settings, not hard-coded. Keep "Rate" visible but never print cost/margin.

---

## 6. IMPLEMENTATION PHASES (do in this order, stop after each for my test)

**Phase 1 – Engine + Settings + Rate library**
Costing settings, materials tables, glass/mesh/handle lists, calculation engine with unit tests, seed Templates 1–4.

**Phase 2 – Quote screen auto-pricing**
Hook the engine into Quotes: sections, item grid, live rate, totals, GST, transport, mm→ft helper, cost breakdown popup, same-size same-rate reuse.

**Phase 3 – Template Builder**
UI to create/duplicate/edit templates and BOM lines with formula fields, live preview, combo products (fixed + operable).

**Phase 4 – PDF/Excel export, snapshots, permissions**
Excel-layout PDF/XLSX, snapshot of rates on save/approve, rate-override permission, admin-only margin panel, quote revisions (Rev 1, Rev 2), duplicate quote, status (Draft / Sent / Approved / Rejected).

**Phase 5 – Polish**
Validation (size limits, missing glass, zero qty), mobile responsive, audit log of rate changes, import existing customers.

---

## 7. IMPORTANT BEHAVIOURS / EDGE CASES
- Changing the Aluminium rate or margin in Settings must NOT change already **Approved/Sent** quotes (they use snapshots). Draft quotes show a "rates changed – recalculate?" banner.
- If Mesh = "NA", the mesh line and mesh-sash profile are excluded only where the template says so (sliding windows keep Mesh Sash profile; ventilators/fixed have none).
- Width/Height must accept decimals (3.5, 7.5).
- Qty multiplies **area and price**, not the BOM (costing is per single window).
- Rounding must follow Section 1.2 exactly, otherwise totals will differ from my Excel by a few rupees.
- Never use JavaScript `eval` for formulas; use a whitelist parser.
- Keep every existing feature working (login, companies, IP audit, customers).

---

## 8. THINGS FROM MY EXCEL THAT SHOULD **NOT** BE COPIED (they are mistakes of manual working)
- Typed rates copied between rows (`=K12`) → engine must compute each row itself.
- Margin typed as 0.404 in one sheet vs 0.35 elsewhere → one margin setting, with optional per-quote override.
- Different glass/mesh/labour prices in different sheets (mesh ₹250 vs ₹290, tinted glass ₹350 vs ₹2000, labour ₹500 vs ₹600) → keep **one Rate library**; templates may override a rate only explicitly and visibly.
- `#REF!` errors and links to other workbooks.
- Hard-coded dimensions inside formulas (`=(8+8)*0.3048`).

---

## 9. ACCEPTANCE TESTS (my Excel results — must match exactly)

Settings: Al ₹500/kg, wastage 5%, margin 35%, GST 18%, labour ₹500/sqm.

| # | Product | W ft | H ft | Glass | Mesh | Expected Price Ex-Tax (1 nos) | Expected Rate/Sqft |
|---|---|---|---|---|---|---|---|
|1|2.5T 2P Sliding Window|10|6|6mm Toughened (850)|SS|₹35,803|**₹597**|
|2|2.5T 2P Sliding Window|9|6|6mm Toughened (850)|SS|≈₹33,110|**₹613**|
|3|2.5T 2P Sliding Door|8|8|8mm Toughened Clear (1200)|SS|₹39,898|**₹623**|
|4|Fixed Window|10|8|6mm Toughened (850)|NA|₹26,406|**₹330**|
|5|Ventilator|3.5|2|4mm Frosted (600)|NA|≈₹3,826|**₹547**|

Test 1 intermediate values (to debug lines): Outer frame top ₹1,950.72 · Verticals ₹2,340.86 · Sash both side ₹2,377.44 · Sash one side ₹2,852.93 · Interlock ₹640.08 · Mesh sash ₹4,114.80 · Gasket ₹270.66 · Brush seal ₹156.06 · Rollers ₹180 · Touch lock ₹90 · Labour ₹2,787.09 · Glass ₹4,738.06 · SS mesh ₹808.26 · Wastage ₹1,262.88 · **Total cost ₹26,520.56 · Margin ₹9,282**.

Quote total test (my real quote CTPL-252, windows work):
Total Qty 18 · Total Area **472 sqft** · Items total **₹3,11,794** · Average rate **₹661** · Transport ₹6,000 · Ex-GST **₹3,17,794** · incl. 18% GST **₹3,74,996.92**.

MM test: 3000→10, 1850→6, 1200→4, 2450→8, 2150→7, 4500→15, 2100→7, 2350→8.

Report any mismatch to me instead of "adjusting" formulas to force a match.

---

## 10. WHAT I WANT BACK AT THE END OF EACH PHASE
1. List of files created/changed.
2. Migration/seed steps to run.
3. Test table (expected vs actual).
4. Screenshots or a short description of the new screens.
5. Any assumption you made and any question you need me to answer.
