# Handoff: Liquid Ledger — bookkeeping for the drinks trade

## Overview
Liquid Ledger is multi-tenant SaaS bookkeeping software for small and mid-sized **importers, exporters and wholesalers of drinks**: wine, beer, spirits, fortified wine, water and soft drinks. On top of standard bookkeeping (sales, purchases, bank, VAT, general ledger, reports) it handles what generic tools like Exact, Jortt or AFAS don't:

- **Excise (accijns)** calculated per product from volume, alcohol % and category, including bonded vs duty-paid stock
- **Customs and EMCS documents** (import and export declarations, e-AD, T1)
- **Stock per warehouse**, including bonded warehouses and goods in transit
- **Shipments** linked to orders, costs and documents
- **Deposit (statiegeld)** on bottles, cans and kegs

The primary user is the **owner of a small drinks importer (1–10 people) who is not an accountant**. Everything must feel quick: documents are dropped in and booked automatically, bank lines come with match suggestions, and staff pick plain-language categories while the ledger accounts are chosen for them.

The handover covers three surfaces:
1. **Customer app** (`designs/Liquid Ledger.dc.html`): the product the client uses every day
2. **Sign-in with two-factor authentication** (`designs/Liquid Ledger Login.dc.html`)
3. **Platform admin console** (`designs/Liquid Ledger Admin.dc.html`): for the Liquid Ledger team to create and manage clients (tenants), users, plans, security and support access

See `DOMAIN_AND_DATA.md` for the data model, permission matrix, excise and VAT rules, auth requirements and a suggested build order.

## About the design files
The files in `designs/` are **design references created in HTML**: interactive prototypes that show the intended look, copy and behaviour. They are **not production code to copy**. Recreate them in a real application stack. If no stack exists yet, a good fit for this product is:

- **Frontend:** React + TypeScript (Next.js or Vite), Tailwind or CSS modules for the tokens below, TanStack Query, React Hook Form + Zod
- **Backend:** Node (NestJS or Fastify) or Python (Django), PostgreSQL with **row-level security per tenant**, a job queue for OCR, bank sync and filing
- **Auth:** a proven provider or library supporting TOTP, WebAuthn/passkeys, SMS fallback, recovery codes and SAML. Don't hand-roll crypto.
- **Money:** store amounts as integer cents (or `numeric(14,2)`) with a currency code. Never use floats.

To open a prototype, open the `.dc.html` file in a browser with `support.js` in the same folder (internet access is needed for fonts and icons). The logic of each prototype is a plain JS class at the bottom of its file. It's useful as a reference for state, calculations and sample data.

## Fidelity
**High-fidelity.** Colours, typography, spacing, radii, copy and interactions are final-intent. Recreate the UI pixel-close, using your component library for primitives (buttons, inputs, drawers, tables) styled to these tokens. All data shown is **realistic sample data**. Excise rates are illustrative Dutch-style rates and must come from a maintained rates table (see `DOMAIN_AND_DATA.md`).

---

## Design tokens

### Colour
| Token | Hex | Use |
|---|---|---|
| `brand-700` (primary) | `#7a1f3d` | Primary buttons, links, active tab underline, nav badge, logo, focus ring |
| `brand-800` (hover) | `#5f1730` | Primary hover/pressed |
| `brand-50` | `#fcf5f7` | Selected-row and suggestion backgrounds |
| `brand-100` | `#f9eef2` | Active nav item background, hover tints |
| `brand-150` | `#f8e9ee` | Wine-category chips |
| `brand-200` | `#f1d5df` | Focus halo (`0 0 0 3px`), selected-card ring, avatar background |
| `brand-300` | `#e3b8c6` | Dashed suggestion border |
| `brand-350` | `#e8c3cf` | Secondary chart bars ("Out") |
| `ink-900` (text) | `#14171f` | Body text |
| `ink-700` | `#3a4250` | Secondary text, nav items |
| `ink-500` (muted) | `#5b6474` | Labels, meta text |
| `ink-400` | `#8a93a3` | Hints, placeholders, group labels |
| `line-300` | `#d5d9e0` | Input and secondary-button borders |
| `line-200` | `#e4e7ec` | Card borders, table header bottom border |
| `line-100` | `#eef0f3` | Table row separators |
| `surface-0` | `#ffffff` | Cards, sidebar, drawers |
| `surface-50` | `#f9fafb` | Table header background |
| `surface-100` (app bg) | `#f5f6f8` | Page background |
| `surface-150` | `#f0f2f5` | Neutral pills, count badges |
| Admin sidebar | `#1c1216` bg, `#33212a` active, `#2c1d23` hover, `#c45b7e` active edge | Platform admin only |

**Status colours** (background / foreground). Use these only for status, never for actions:
- Green (paid, booked, active, done): `#e6f6ee` / `#157347`, solid `#1aa364`
- Blue (open, ready, info, in transit): `#e8f0fb` / `#1f4f8f`
- Amber (warning, check needed, low stock): `#fff3dc` / `#9a5b00`
- Red (overdue, missing, locked, error): `#fdebea` / `#b42318`, solid `#e5484d`
- Gray (draft, neutral): `#f0f2f5` / `#4b5563`

**Product category tiles** (bg / fg / Phosphor icon): Wine and Fortified `#f8e9ee`/`#7a1f3d` `wine` · Beer `#fff3dc`/`#9a5b00` `beer-stein` · Spirits `#f3ece4`/`#6b4a2b` `brandy` · Water `#e8f0fb`/`#1f4f8f` `drop` · Soft drinks `#e6f6ee`/`#157347` `pint-glass`.

### Typography
- **UI font:** Geist (Google Fonts), weights 400/500/600/700. Fallback `ui-sans-serif, system-ui, sans-serif`.
- **Wordmark only:** Oleo Script 400 ("Liquid Ledger"). Never use it for UI text. Login tagline "From cask to cash." also uses Oleo Script.
- Numbers: `font-variant-numeric: tabular-nums` on every amount, quantity and date column.
- Scale:
  - Page title (h1): 24px / 600 / `-0.015em`
  - Login title: 28px / 600 / `-0.02em`
  - Drawer title: 18px / 600
  - Card title: 15px / 600
  - KPI value: 26px / 600 / `-0.02em`
  - Summary card value: 21px / 600
  - Body and table: 13.5–14px / 400 (500 for names)
  - Meta: 12.5px
  - Table header: 12px / 500, `ink-500`
  - Sidebar group label: 11.5px / 500, `ink-400`
- Body line-height 1.45, antialiased.

### Spacing, radius, elevation
- **Spacing:** 4px base. Common values: 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32.
  - Page padding: 28px top, 32px sides (main app); 26px / 28px (admin)
  - Card padding: 16–20px
  - Grid gaps: 12–16px
- **Radius:**
  - 7px: nav items, small buttons
  - 8px: buttons and inputs
  - 9px: banners, larger inputs
  - 10px: drawers' inner boxes
  - 12px: cards
  - 999px: pills and badges
  - Login inputs: 9–10px
- **Shadows:**
  - Dropdown menus: `0 12px 32px rgba(20,23,31,.12)`
  - Drawers: `-12px 0 40px rgba(20,23,31,.16)`
  - Toast: `0 12px 32px rgba(20,23,31,.25)`
  - Cards use a 1px border, no shadow.
- **Focus:** `2px solid #7a1f3d`, offset 1px. Inputs on focus: border `#7a1f3d` plus `0 0 0 3px #f1d5df`.
- **Backdrop:** `rgba(20,23,31,.32)`.

### Controls
- **Primary button:** h36, padding 0 14px, radius 8, bg `#7a1f3d`, text white 14/500, icon 16px with gap 6. Hover `#5f1730`.
- **Secondary button:** same size, white bg, 1px `#d5d9e0` border, hover bg `#f3f5f8`.
- **Small button:** h30, padding 0 10–12px, 13px text.
- **Tabs:** 14/500 text, padding 12px 10px. Active tab has text `#7a1f3d` and inset bottom shadow `0 -2px 0 #7a1f3d`. Count chip 12px on `#f0f2f5`.
- **Pill:** 12/500, padding 2px 8–9px, radius 999.
- **Tables:** CSS grid rows; header 12/500 on `#f9fafb`; rows padding 11–12px 16px, 1px `#eef0f3` separator, hover `#fafbfc`. Numeric columns right-aligned. On narrow screens the table scrolls horizontally (each table has a `min-width`).

### Logo
The end-on barrel: a 48×48 viewBox SVG, defined inline in every design file (search for `clipPath id="ll-logo"`). It consists of:
- an outer circle r22 filled `#7a1f3d`
- an inner ring r14 with a 2px white stroke
- five vertical stave lines clipped to r12, white at 45% opacity
- a bung hole circle r2.6 at (24,30), white

The inverted version (white disc, burgundy lines) is used on dark and photo backgrounds. Sizes used: 34px in the app sidebar, 42px on login, 32px in admin. Have a designer produce final SVG, PNG, favicon and app-icon exports from this geometry.

### Icons
Phosphor Icons (https://phosphoricons.com), Regular weight in the app (`ph`), Fill only for permission checkmarks. Use `@phosphor-icons/react` in a React build.

---

## Screens: customer app (`Liquid Ledger.dc.html`)

### App shell
- **Layout:** CSS grid of `236px | 1fr`. Collapsed: `68px | 1fr`, animated with `grid-template-columns .18s ease`.
- **Sidebar:** white, 1px right border, sticky full height, padding 14px 12px. From top to bottom:
  - Logo and wordmark (Oleo Script 22px `#7a1f3d`), plus a collapse button with the `sidebar-simple` icon.
  - Company switcher ("Vale & Hart Drinks B.V." / "Financial year 2026"), bg `#fcf5f7`, border `#f1d5df`, radius 9.
  - Nav groups:
    - No label: Dashboard
    - **Daily work:** Bank, Sales invoices, Purchase invoices, Costs & receipts, Relations
    - **Drinks trade:** Products, Stock & warehouses, Excise & customs, Orders & shipments
    - **Accounting:** VAT return, General ledger, Reports
  - Settings and Help pinned to the bottom.
- **Nav item:** 14px text, padding 7px 10px, radius 7. The active item has bg `#f9eef2`, text `#7a1f3d` at 600 weight, and a 3px inset left edge in `#7a1f3d`. Counts are burgundy pills.
- **Collapsed sidebar:**
  - Icons only (20px) with a `title` tooltip; group labels become 1px dividers.
  - Counts become 16px dots at the icon's top-right corner, with a 2px white ring.
  - The company switcher becomes a 40px "VH" tile.
  - Auto-collapses when the viewport is narrower than 1100px. A manual choice is persisted per user (prototype key: `ll-sidebar`).
- **Top bar:** sticky, translucent `rgba(245,246,248,.92)` with an 8px backdrop blur. It contains:
  - Global search (max 520px, can shrink, shows a ⌘K hint)
  - Language switcher (globe icon plus the language code, opening a dropdown of 7 languages)
  - Upload (secondary button)
  - **+ New** (primary, opens a menu: Sales invoice, Upload purchase invoice, Receipt or expense, Journal entry, Product, Relation, Order / shipment, each with a keyboard-shortcut letter)
  - Notifications bell and avatar
- **Toast:** dark `#14171f` pill, bottom centre, check icon, auto-hides after about 4s.

### 1. Dashboard
- **Header:** the date and "Good morning, Marta", plus "Bank synced 07:12 · September closed".
- **KPI cards** (four, clickable, each navigating to its screen):
  - Bank balance
  - To receive (overdue amount noted in red)
  - To pay
  - Excise due (with its filing state)
- **Row 2:**
  - **Cash in & out:** a six-month bar chart with In in `#7a1f3d` and Out in `#e8c3cf`.
  - **To do:** a dynamic list, where each item navigates to the right screen:
    - bank lines to reconcile
    - purchase invoices to approve
    - receipts to book
    - overdue invoices
    - a shipment held at customs
    - the excise return being ready
- **Row 3:**
  - **Receivables:** a split bar of not-yet-due vs overdue, plus the top debtors.
  - **Revenue by category:** with margin per category.
  - **Deadlines:** a date tile with a status pill (VAT Q3, Excise Sep, ICP, supplier payment).

### 2. Bank
- Account cards: ING Current, ING Savings, Wise USD. The selected card gets a burgundy border and a 3px ring.
- Tabs: To reconcile / Reconciled.
- Each row shows date, counterparty and description, amount (incoming amounts in green with a +), and a **suggested booking** box (dashed `#e3b8c6` border on `#fcf5f7`) with the reason, e.g. "Exact amount and reference" or "Rule: booked the same way 4 times". Row actions are **Match** (primary) and **Other…**.
- "Accept all N suggestions" books everything at once. Matching a sales-invoice payment marks that invoice Paid. Empty state: "All caught up".

### 3. Sales invoices
- Four summary cards: Open, Overdue, Invoiced this month, Average days to get paid.
- Tabs with counts: All, Draft, Open, Overdue, Paid.
- Table columns: number, customer and city, date, due date, excise included, total, status pill. Overdue shows as "Overdue 9d".
- **New invoice drawer** (right side, 780px):
  1. **Customer cards.** The customer's tax regime drives the invoice:
     - **Domestic NL:** excise per bottle, VAT 21% over price plus excise.
     - **EU B2B:** shipped duty-suspended under EMCS, no excise, VAT reverse-charged, box 3b.
     - **Export outside the EU:** no excise, VAT 0%, box 3a, export declaration drafted.
     The drawer shows a blue info line explaining the active regime.
  2. **Lines:** product select, cases, price per bottle, net, excise with the formula underneath (e.g. "60 btl × 0.75 L × €0.98"), and a delete button. "+ Add line".
  3. **Totals:** Net, Excise, VAT line (label depends on regime), Total.
  4. Footer actions: Save draft and **Send invoice**. Sending adds the invoice to the list, shows a toast, and notes the e-AD or export declaration.

### 4. Purchase invoices (stock purchases)
- **Drop zone:** dashed border, turns burgundy on drag-over. While processing it shows "Reading GA-5521.pdf — products, alcohol %, VAT, excise…". There's also a forward-to email address.
- **Split view:**
  - **Left list:** tabs To approve / Booked; each item shows supplier, number, date, total and a flag ("Ready" in green or "Check rate" in amber).
  - **Right panel:** two columns.
    - A **document preview**, with the recognised fields highlighted (yellow for header fields, pink for lines).
    - A **booking proposal**:
      - a confidence pill
      - an amber warning when needed, e.g. for a foreign-currency rate
      - read-only fields: supplier, number, currency, dates
      - lines, each with its ledger account
      - VAT treatment, stock destination, excise ("€0.00 now · €441.00 when released"), and the purchase order or shipment it matched
    - Actions: **Approve & book**, and **Book & schedule payment**.

### 5. Costs & receipts (day-to-day costs)
- Header actions: Log mileage, Pay out claims (SEPA batch), **Book all suggested**.
- Capture strip (phone app, email address, card feed), plus four summary cards: costs this month, to book, to reimburse per person, payroll.
- **Left list:** To book / Booked. Each row shows date, supplier and description, a category chip (dashed when it's only a suggestion, amber "What was it for?" when there's no category yet), the amount and who paid it (Card, Bank, or "Own · Joost").
- **Right panel**, for the selected receipt:
  - Receipt thumbnail, supplier, amount
  - **"What was it for?"** with a search box (matches words like "lunch" or "taxi" and account numbers like "4560") and a grouped grid of categories. Each shows a plain-language label and the ledger account (e.g. "4560 Representatiekosten").
  - Info box: ledger account, VAT treatment, and a "good to know" note (e.g. the work-related costs scheme, partly deductible, excise on samples).
  - Paid with: Company card / Bank transfer / Own money (own money goes to that employee's expense claim).
  - Checkbox "Always book {supplier} as {category}", which creates a rule.
  - **"How it lands in the books":** a preview of debit and credit lines, e.g. cost account (net), 1810 VAT to reclaim, and the offsetting account (1110 company card, 1000 bank, or 1650 expense claims).
  - **Book receipt.** Payroll rows are imported, not categorised, and show a 5-line split.
- The full category-to-account map is in `DOMAIN_AND_DATA.md`.

### 6. Relations
- Tabs: Customers / Suppliers.
- Columns: initials tile, name and type, country, VAT number, excise status (e.g. "Authorised consignee · SE…", "Consignor · ES…", "Export · outside EU"), payment terms, open balance.

### 7. Products
- Search (name, product code, producer, barcode) and category filter chips: All, Wine, Beer, Spirits, Fortified, Water & soft drinks. The active chip is filled burgundy.
- Table columns: category tile, name with producer and country, product code, category pill, size and alcohol %, units per case, stock, cost, list price, margin (green), excise per bottle.
- **Product drawer** (660px):
  - Header: photo placeholder, name, producer and region, pills (category, Active, product code).
  - **Product & customs data:** barcode, volume, alcohol %, vintage or age, gravity in °P (beer), case and pallet size, customs tariff code, EMCS excise product code, country of origin, pure alcohol per unit.
  - **Price lists:** Horeca, Wholesale, Export, each per bottle, per case and with margin, plus the landed cost price. Prices exclude VAT, excise and deposit.
  - **Excise & deposit:** per bottle, per case, deposit, and the formula.
  - **Stock** per location with the reorder level.
  - **Last 90 days:** units sold, revenue, top customer.
  - Footer actions: Archive, Duplicate, **Edit product**.

### 8. Stock & warehouses
- Location cards: Rotterdam (Bonded), Amsterdam (Duty paid), In transit (Under bond). Each shows bottles, cost value, and excise either "on release" or "paid".
- Table columns: product code, product, category, alcohol %, bottles, litres, pure alcohol in litres, excise, cost value, and a "Low" pill when below the reorder level.

### 9. Excise & customs
- Four summary cards: excise due (with its payment deadline), bottles released for consumption, bottles shipped duty-suspended, excise licence number.
- **Return table** per product: category, bottles, hectolitres, the calculation ("27.00 hl × €98.00"), and the excise amount, with a total row.
- **File with Customs** turns into "Filed · EX-2026-09-4471".
- **Customs & EMCS documents:** document type, reference (MRN or ARC), shipment, and a status pill. A missing T1 document shows in red.

### 10. Orders & shipments
- Table columns: reference, type pill (Import, Export, EU, Domestic), route and mode, goods, arrival date (ETA), and a **4-segment progress bar** (Booked → In transit → At customs → Arrived) with the stage text. Blue means in progress, green means arrived, red means blocked.
- A blocked shipment gets an action button, e.g. "Upload T1".

### 11. VAT return
- Dutch-style return boxes (1a, 1e, 3a, 3b, 4a, 4b, 5a, 5b), grouped under section headers, with turnover and VAT columns. A highlighted row shows the amount to pay and the deadline.
- **Intra-EU listing (ICP):** customer, VAT number, amount.
- **Checks before filing:** all invoices booked, VAT numbers validated in VIES, import VAT matched, bank reconciled.
- **Submit return** turns into "Submitted".
- Other countries need their own return layouts (see `DOMAIN_AND_DATA.md`).

### 12. General ledger
- **Chart of accounts:** groups Assets, Liabilities, Revenue, Costs, each with a total. Each account row shows code, name (Dutch or English per setting, the other language muted), and balance.
- **Latest journal entries:** title, date, source ("Auto from upload", "Bank", and so on), and debit/credit lines.

### 13. Reports
- Tabs: Profit & loss / Balance sheet.
- Profit & loss columns: Sep, Aug, change % (green or red depending on whether it helps profit), year to date. Subtotal rows have a gray background; the profit row is tinted.
- Note: excise is a pass-through and is kept out of revenue.
- Balance sheet: two columns that balance.

## Screens: sign-in (`Liquid Ledger Login.dc.html`)
- **Layout:** two columns (`repeat(auto-fit, minmax(min(100%,460px),1fr))`); they stack on mobile.
- **Left visual:**
  - Background: a full-bleed photo slot over a radial burgundy gradient `#9a2e52 → #7a1f3d → #4a1023`, with a burgundy scrim (`rgba(60,10,28,…)`, darker at top and bottom).
  - A giant faint barrel mark at 10% opacity, bottom right.
  - Top left: the white logo (42px) and the wordmark (Oleo Script 30px).
  - Bottom left: the tagline **"From cask to cash."** (Oleo Script 54px), a lede at 17px in `#fbeef2`, and glass-style category pills (white at 14% opacity, 1px border at 22%, 6px blur).
  - The current photo (drinks in glasses, as seen in the screenshots) is the user's choice. Make sure it's licensed for commercial use, and keep it brand-free.
- **Right form:** 392px max width, vertically centred. Language switcher top right; footer with "Two-factor authentication · Data hosted in the EU", Privacy, Terms and ©.
- **Step 1, credentials:**
  - Fields: Work email, Password (with a show/hide eye and a "Forgot password?" link).
  - **Continue** (h46).
  - An "or" divider, then **Sign in with a passkey**.
  - "New to Liquid Ledger? Start a free trial".
  - Errors appear in a red inline banner.
- **Step 2, two-factor authentication:**
  - Back link, a method icon tile, "Step 2 of 2 · Two-factor authentication", and the title "Enter your verification code".
  - **Six code boxes**, 56px tall, 24px/600 text, laid out 3 + 3 with a dash separator. Behaviour:
    - Typing a digit moves focus to the next box; Backspace goes back; the arrow keys move between boxes.
    - Pasting a 6-digit code fills all boxes.
    - It submits automatically when complete ("Verifying…").
    - A wrong code shakes the boxes (`ll-shake .4s`), shows a red banner, then clears and refocuses the first box.
    - Inputs use `inputmode="numeric"` and `autocomplete="one-time-code"`.
  - "Trust this device for 30 days" checkbox.
  - **Verify and sign in.**
  - Other methods: authenticator app, text message to a masked phone number, recovery code.
- **Step 3, signed in:** a green check, "You're signed in", and **Open Liquid Ledger**.
- All copy is translated into NL, EN, FR, DE, IT, ES and PL.

## Screens: platform admin (`Liquid Ledger Admin.dc.html`)
For Liquid Ledger staff only, on a separate subdomain (e.g. `admin.liquidledger.app`) with its own auth (passkey required).

- **Shell:**
  - Dark sidebar `#1c1216`: white logo and wordmark, a burgundy "PLATFORM ADMIN" badge, and nav (Overview, Clients, Users, Roles & permissions, Plans & billing, Audit log, Security policies) with red alert badges. The signed-in staff member is shown at the bottom.
  - Top bar: search ("client, user, email or VAT number"), a system status pill, and a link to the customer app.
- **Overview:**
  - KPIs: active clients, users (with the count without 2FA), monthly recurring revenue (MRR), trials ending within 7 days.
  - **Needs attention:** failed payments, locked users, users without 2FA, trials ending.
  - Clients by country.
  - Recent activity.
- **Clients:**
  - Tabs: All, Active, Trial, Past due, Suspended.
  - Columns: initials tile, name and VAT number, country flag, plan, users, MRR, last active, status.
  - **Client drawer:**
    - Facts: plan, MRR, users, administrations used, data region, tax regime, storage.
    - **Module toggles:** Excise, Customs, EMCS link, Multi-currency, Payroll import, API access.
    - The client's users, with an Invite button.
    - **Support access:** a reason is required, the session lasts 60 minutes, the client is notified and it's audit-logged.
    - Footer: Suspend or Reactivate, Change plan, Edit.
  - **New client drawer:**
    - Company name.
    - **Country** (7 choices), which sets the excise authority, VAT return type and chart of accounts.
    - VAT number (placeholder adapts to the country).
    - Plan cards and a 30-day trial checkbox.
    - Owner name and email.
    - Note: the owner is invited in the local language and must set up 2FA.
- **Users:**
  - Tabs: Client users, Invited, Locked, No 2FA, Platform staff.
  - Columns: user, client, role, 2FA method, last sign-in, status.
  - Row actions: Resend invite, Unlock, Reset 2FA, and a ⋯ menu (change role, disable, sign out all sessions).
  - Invite modal: email, role chips with a description of each role.
- **Roles & permissions:** a matrix of 6 roles × permissions grouped by area. Each cell is full access (green check), view only (blue eye) or none (gray dash). Exact values are in `DOMAIN_AND_DATA.md`.
- **Plans & billing:**
  - Plan cards: Starter €49, Business €149, Pro €249, Enterprise custom, with limits and the number of clients on each.
  - Subscription invoices with status.
- **Audit log:** time, actor, action (with icon), client, IP address. Exportable as CSV.
- **Security policies:**
  - Toggles; 2FA-for-everyone and staff passkeys are locked on.
  - Fixed values: session timeout 30 minutes, lockout after 5 attempts for 15 minutes, data region EU (Frankfurt).

---

## Interactions and behaviour (cross-cutting)
- **Navigation:** sidebar items switch screens. KPI cards, to-do items and deadlines deep-link with filters pre-set (e.g. Overdue tab).
- **Drawers** slide in from the right over a backdrop. Close with ×, a backdrop click or Esc.
- **Toasts** confirm every state change in plain language and include the side effect, e.g. "Booked · 600 bottles added to Rotterdam bonded stock; €3,900 to pay by 4 Nov."
- **Suggestions vs. booked:** anything the system proposes is shown with a dashed burgundy border. Once the user confirms it, it turns solid or neutral. Never auto-book without a rule or an explicit confirmation.
- **Empty states:** a friendly icon plus one line ("All caught up", "Nothing left to approve").
- **Loading:** OCR shows the step text in the drop zone. Filing shows a spinner state on the button.
- **Errors:** an inline red banner near the field, with the message in plain language.
- **Responsive:**
  - Grids use `auto-fit, minmax(...)` and wrap.
  - Tables scroll horizontally.
  - The sidebar collapses below 1100px.
  - The top-bar search shrinks first (`min-width: 0`); buttons and avatar don't shrink.
- **Language:** a UI language switcher (NL, EN, FR, DE, IT, ES, PL), stored per user. The prototype translates the shell, titles and dashboard; the build must translate everything (use i18n keys from day one), plus locale formatting:
  - numbers: `€ 1.234,56` (nl), `1 234,56 €` (fr)
  - dates
- **Ledger account names:** shown in the administration's chart language (Dutch or English in the prototype's Tweaks), independent of the UI language.

## State (per screen, indicative)
- App: `screen`, `sidebarCollapsed`, `language`, `toast`, `newMenuOpen`
- Bank: `selectedAccount`, `tab`, plus a server list of unreconciled transactions with suggestions
- Sales: `filter`, `drawerOpen`, draft `{customerId, lines[{productId, cases, unitPrice}]}`. Totals are derived server-side using the tax engine.
- Purchases: `tab`, `selectedDocumentId`, `uploading`. Server provides OCR results and a booking proposal.
- Costs: `tab`, `selectedReceiptId`, `categoryQuery`, `ruleOn`; receipt `{categoryKey, paidBy, employeeId}`
- Products: `categoryFilter`, `query`, `selectedProductId`
- Login: `step` (`credentials` → `mfa` → `done`), `mfaMethod`, `code[6]`, `trustDevice`, `error`
- Admin: `clientFilter`, `userFilter`, `selectedClientId`, `supportReason`, new-client form, invite form

## Assets
- **Fonts:** Geist and Oleo Script (Google Fonts, both under the SIL Open Font License).
- **Icons:** Phosphor Icons (MIT).
- **Logo:** inline SVG in the design files; final exports to be produced.
- **Login photo:** the user-supplied photo in the login screenshots. Confirm its licence, then ship it as an optimised WebP/AVIF at 1x and 2x.

## Files
- `designs/Liquid Ledger.dc.html`: customer app, all 13 screens plus drawers. Prototype logic, sample data and calculations are in the `Component` class at the bottom.
- `designs/Liquid Ledger Login.dc.html`: sign-in with 2FA, 7 languages.
- `designs/Liquid Ledger Admin.dc.html`: platform admin console.
- `designs/support.js`: runtime needed to open the prototypes. Not part of the product.
- `designs/image-slot.js`: photo placeholder used on the login screen. Not part of the product.
- `DOMAIN_AND_DATA.md`: data model, permissions, tax and excise rules, auth requirements, build order.
- `screenshots/`: 40 reference captures at 924px wide (a narrow laptop or tablet width, so cards wrap more than on a wide desktop). Where a screen is taller than one capture, there's a second "-lower" image. Compare against the live `.dc.html` files for full-height and hover states.

### Screenshot index
**Customer app** (`screenshots/app/`)
- `01-dashboard`, `02-dashboard-lower`: KPIs, cash chart, to-dos, receivables, revenue by category, deadlines
- `03-bank-reconcile`: account cards, transactions with suggested bookings
- `04-sales-invoices`, `05-sales-new-invoice-drawer`: list with tabs; invoice editor with excise per line
- `06-purchase-invoices`, `07-purchase-booking-proposal`: drop zone, approval list, document preview and booking proposal
- `08-costs-receipts`, `09-costs-category-picker`: receipts list; "What was it for?" picker and journal preview
- `10-relations`, `11-products`, `12-product-drawer`
- `13-stock-warehouses`, `14-excise-return`, `15-excise-customs-documents`, `16-shipments`
- `17-vat-return`, `18-general-ledger`, `19-reports-pnl`, `20-reports-balance-sheet`
- `21-language-switcher`, `22-sidebar-collapsed`, `23-sidebar-expanded`

**Sign-in** (`screenshots/login/`)
- `01-credentials`, `02-2fa-code`, `03-2fa-code-empty`, `04-2fa-wrong-code`, `05-signed-in`

**Platform admin** (`screenshots/admin/`)
- `01-overview`, `02-overview-lower`, `03-clients`, `04-client-drawer`, `05-new-client`, `06-users`, `07-invite-user`, `08-roles-permissions`, `09-roles-permissions-lower`, `10-plans-billing`, `11-audit-log`, `12-security-policies`

## Suggested first prompt for Claude Code
> Read `README.md` and `DOMAIN_AND_DATA.md` in `design_handoff_liquid_ledger/`. Set up a monorepo with a Next.js + TypeScript web app and a Postgres-backed API. Start with milestone 1 (auth with mandatory 2FA, tenants, users and roles, app shell with collapsible sidebar and language switcher) and match the design tokens exactly. Open the `.dc.html` files in `designs/` in a browser to compare against.
