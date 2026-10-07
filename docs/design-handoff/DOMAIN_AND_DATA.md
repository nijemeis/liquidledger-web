# Liquid Ledger: domain rules, data model and build plan

This complements `README.md`. Amounts, rates and codes in the prototypes are **sample values**. Every tax rate, threshold and form layout must come from versioned configuration that someone keeps up to date. Validate rules with a tax adviser in each launch country.

## 1. Tenancy model

```
Platform (Liquid Ledger)
 └─ Client (tenant / company account: billing, plan, owner)
     └─ Administration (one legal entity's books: country, currency, chart, fiscal year)
         └─ all bookkeeping data (invoices, stock, journal…)
```
- A **user** belongs to the platform and can have **memberships** in several administrations, with a role per membership. External accountants typically have many memberships.
- **Platform staff** are separate from client users. They have their own console and must sign in with a passkey.
- Isolation: every bookkeeping table has an `administration_id`, enforced with Postgres row-level security. Support access works through a time-boxed `support_session` with a reason, which is audit-logged and shown to the client.

## 2. Core entities (minimum fields)

| Entity | Key fields |
|---|---|
| `client` | id, name, country, vat_number, plan, status (trial · active · past_due · suspended), trial_ends_at, created_at, modules[] |
| `administration` | id, client_id, legal_name, country, base_currency, chart_template (NL-RGS, BE-PCMN, FR-PCG, DE-SKR03/04, IT, ES-PGC, PL), fiscal_year_start, vat_period (monthly/quarterly), excise_licence_no, excise_authority |
| `user` | id, email, name, locale, mfa_methods[], passkeys[], status (invited · active · locked · disabled), last_sign_in_at |
| `membership` | user_id, administration_id, role (owner · admin · bookkeeper · warehouse · accountant · read_only) |
| `relation` | id, kind (customer/supplier/both), name, country, vat_number (VIES-validated), excise_status (e.g. authorised consignee + SEED/excise no.), payment_terms_days, default_price_list, tax_regime_override |
| `product` | id, sku, name, producer, category (wine · beer · spirits · fortified · water · soft), unit_volume_l, abv, plato (beer), vintage/age, units_per_case, cases_per_pallet, ean, cn_code, emcs_product_code, origin_country, deposit_amount, reorder_level, status |
| `price_list` / `price` | list (horeca/wholesale/export/custom), product_id, unit_price, currency, valid_from |
| `warehouse` | id, name, kind (bonded · duty_paid · in_transit), excise_warehouse_no |
| `stock_movement` | product_id, warehouse_from/to, qty_units, reason (purchase · sale · transfer · release_for_consumption · sample · loss · count), document_ref, excise_amount, at |
| `sales_invoice` + lines | number (sequential per administration), customer_id, dates, tax_regime (domestic · eu_b2b · export), status (draft · open · overdue · paid · credited), lines(product_id, qty_units, unit_price, net, excise, vat_code, vat_amount, deposit) |
| `purchase_invoice` + lines | supplier_id, number, dates, currency, fx_rate, status (to_approve · booked · paid), source_document_id, ocr_confidence, lines(product_id or ledger_account, qty, price, vat_code, warehouse_id) |
| `receipt` (cost) | date, supplier, description, amount, category_key, ledger_account, vat_treatment, paid_by (card · bank · own), employee_id, status (unsorted · suggested · booked), rule_id |
| `booking_rule` | match (supplier/IBAN/description pattern), category_key or ledger_account, vat_code, created_by |
| `bank_account` / `bank_transaction` | iban, provider (PSD2 aggregator), currency; transactions with counterparty, description, amount, status (unreconciled · reconciled), match (invoice/receipt/rule) |
| `shipment` | ref, direction (import · export · eu · domestic), route, mode, eta, stage (booked · in_transit · at_customs · arrived), linked orders/invoices/costs/documents |
| `customs_document` | type (import_declaration · export_declaration · e_ad · t1 · …), reference (MRN/ARC), shipment_id, status |
| `ledger_account` | code, name_nl, name_en (plus other locales), type (asset · liability · equity · revenue · cost), rgs_code (NL), vat_default |
| `journal_entry` + lines | date, source (sales · purchase · bank · receipt · stock · manual · payroll_import), lines(account, debit, credit, vat_code, relation_id). Immutable once in a closed period; corrections are reversing entries. |
| `tax_return` | type (vat · excise · icp), period, computed boxes JSON, status (draft · ready · filed), filed_ref, filed_at |
| `audit_event` | at, actor (user/staff/system), administration_id, action, before/after JSON, ip, user_agent |
| `subscription` / `subscription_invoice` | plan, price, period, status, payment provider ids |

## 3. Roles and permissions
F = full access, V = view only, — = no access. Owner and Admin are identical except for billing and deletion.

| Permission | Owner | Admin | Bookkeeper | Warehouse | Accountant | Read-only |
|---|---|---|---|---|---|---|
| Sales invoices | F | F | F | V | F | V |
| Purchases & receipts | F | F | F | F | V | V |
| Bank reconciliation | F | F | F | — | V | V |
| Products & stock | F | F | V | F | V | V |
| File VAT return | F | F | — | — | F | — |
| File excise return | F | F | F | — | V | — |
| Customs & EMCS documents | F | F | F | F | V | — |
| Reports & exports | F | F | F | — | F | V |
| Users & roles | F | F | — | — | — | — |
| Billing & plan | F | — | — | — | — | — |
| Delete administration | F | — | — | — | — | — |

Platform staff roles: **Super admin** (everything, including rates and policies), **Support** (read clients and users, open support sessions, reset 2FA, unlock), **Finance** (plans, billing, subscription invoices).

## 4. Authentication and security (non-negotiable)
- **2FA is required for every user.** A user can't open an administration until 2FA is enrolled.
- 2FA methods: TOTP (authenticator app), **WebAuthn passkeys** (which can also be the first factor, as with "Sign in with a passkey"), SMS as a fallback only, and 10 single-use recovery codes.
- Platform staff must use passkeys. The admin console sits behind an IP allow-list option.
- "Trust this device for 30 days" uses a signed device cookie bound to the user. The password is still required on a trusted device.
- Lockout: 5 failed password or 2FA attempts locks the account for 15 minutes and sends the user an email. Support can unlock; that is audit-logged.
- Sessions: 30 minutes idle timeout (configurable stricter per client on Pro), refresh rotation, "sign out all sessions".
- Email the user about sign-ins from a new device, with a "this wasn't me" link that locks the account.
- SSO (SAML/OIDC) on Enterprise.
- EU data residency (e.g. Frankfurt), encryption at rest, daily backups, GDPR data export and deletion per client.
- An audit event for every sign-in, permission change, filing, support session, rate change and booking-rule change.

## 5. Excise (accijns)
Excise is due when goods are **released for consumption**, normally when they leave a bonded warehouse for a domestic customer. While goods sit in a bonded warehouse, or move under EMCS to another authorised warehousekeeper in the EU, they are **duty-suspended**.

The calculation basis differs per category (rates are per country, so store them in a versioned `excise_rate` table: country, category, basis, rate, valid_from):

| Category | Basis | Prototype formula per unit |
|---|---|---|
| Beer | hl × % vol (NL); hl × °Plato in some countries | `volume_l / 100 × abv × rate` |
| Still wine | hl of product (bands by abv in some countries) | `volume_l / 100 × rate` |
| Fortified / intermediate | hl of product | `volume_l / 100 × rate` |
| Spirits | hl of pure alcohol | `volume_l / 100 × abv/100 × rate` |
| Water and soft drinks | none (some countries tax sugar or soft drinks separately) | 0 |

Prototype sample NL rates: beer €9.10 per hl·%vol, wine €98/hl, intermediate €182/hl, spirits €1,991 per hl of pure alcohol. **These are illustrative only.**

Rules:
- The excise return per period sums all `release_for_consumption` movements, including **samples** taken from bonded stock.
- On sales invoices, excise appears only for the **domestic** regime. For EU B2B it is zero, but an **e-AD (EMCS)** must be drafted. For export it is zero and an **export declaration** must be drafted.
- On purchase, excise is "€0 now · €X when released" when goods go into bonded stock. If goods are bought duty-paid, the excise is part of the cost price.

## 6. VAT
- The tax regime is determined per invoice from the customer's country, VAT status and delivery destination: domestic, EU B2B (reverse charge, ICP listing), export (0%), EU B2C (distance sales and OSS: out of scope for v1, flag it).
- Purchases: domestic input VAT; intra-EU acquisition (reverse charge, box 4b in NL); import (via customs or the import VAT deferment permit, box 4a in NL).
- Each country has its own return layout: NL (boxes 1a–5g), BE (grids 00–91), FR (CA3), DE (UStVA), IT (LIPE), ES (Modelo 303), PL (JPK_V7). Model the return as configuration (box definitions and mapping from VAT codes), not as hard-coded screens.
- VAT is calculated on price **plus excise** for domestic sales.
- Validate EU VAT numbers in VIES and store the validation result and date.

## 7. Cost categories mapped to ledger accounts (NL template from the prototype)
Each category carries: ledger account, VAT treatment, and an optional note. Users see the label; accountants see the code.

| Category key | Label | Account (NL) | VAT |
|---|---|---|---|
| office | Office supplies | 4500 Kantoorbenodigdheden | 21% reclaimable |
| software | Software & subscriptions | 4520 Automatiseringskosten | 21% / reverse charge for EU services |
| postage | Postage & couriers | 4540 Porti- en koerierskosten | 21% |
| phone | Phone & internet | 4610 Telefoon- en internetkosten | 21% |
| wages | Wages & payroll (import only) | 4000 / 4010 / 4020, plus 1500 wage tax payable | none |
| staff | Staff lunch, gifts & training | 4100 Overige personeelskosten | not reclaimable; counts toward the work-related costs scheme (werkkostenregeling) |
| mileage | Mileage allowance | 4110 Reiskostenvergoeding | none |
| travel | Train, taxi & flights | 4750 Reiskosten | 9% |
| hotel | Hotels & stays | 4760 Verblijfkosten | 9% |
| fuel | Fuel & charging | 4710 Brandstofkosten | 21% |
| parking | Parking & tolls | 4720 Parkeer- en tolkosten | 21% |
| meals | Business meals & drinks | 4560 Representatiekosten | not reclaimable; partly deductible for corporate tax |
| samples | Samples & tastings | 4570 Proefmonsters en proeverijen | 21%; excise due on samples from bonded stock |
| fairs | Marketing & trade fairs | 4600 Reclame- en beurskosten | 21% (foreign VAT via the EU refund procedure) |
| rent | Rent & premises | 4200 Huur bedrijfsruimte | 21% |
| energy | Energy & water | 4210 Gas, water en licht | 21% |
| insurance | Insurance | 4800 Verzekeringen | none (insurance tax included) |
| advice | Accountant & legal | 4810 Advies- en accountantskosten | 21% |
| bankfee | Bank charges | 4820 Bankkosten | none |
| other | Something else | 4900 Overige algemene kosten | 21% |

Offsetting accounts: 1000 bank, 1110 company credit card, 1650 expense claims payable (per employee), 1810 VAT to reclaim. Other balance-sheet accounts used: 1300 receivables, 1600 payables, 1700 VAT payable, 1710 excise payable, 3000 stock (bonded), 3010 stock (duty paid), 3020 goods in transit. Revenue: 8000–8030 per category. Cost of goods sold: 7000. Map every account to the official **RGS** code for NL, and provide equivalent templates per country.

## 8. Automation (where the "quick and easy" comes from)
- **Document intake:** upload, email-in or phone photo. OCR and an LLM extract supplier, number, dates, currency, lines, volume and alcohol %. The system then matches the result to a purchase order or shipment, proposes ledger accounts, VAT and stock destination, and shows a confidence score. A human approves unless a rule says otherwise.
- **Bank:** PSD2 feed through an aggregator (e.g. Tink, GoCardless or Salt Edge). Matching runs in this order:
  1. exact amount plus reference to an open invoice
  2. booking rules
  3. history ("booked the same way N times")
  4. partial payments
- **FX:** daily ECB rates; stored per document.
- **Payroll:** monthly journal import from the payroll provider (e.g. Nmbrs or Loket in NL), split over wages, social charges, pension and wage tax.
- **Filing integrations (later milestones):** Digipoort (NL VAT and ICP), the customs and EMCS systems per country, Peppol e-invoicing (required in BE from 2026, FR in phases).

## 9. Suggested build order
1. **Foundation:** auth with mandatory 2FA, passkeys and recovery codes; clients, administrations, users, memberships and roles; app shell (collapsible sidebar, top bar, language switcher, i18n); audit log; platform admin (clients, users, security policies).
2. **Master data:** relations (VIES validation), products (full drinks data), warehouses, price lists, chart-of-accounts templates.
3. **Sales:** invoice editor with the tax engine (regime, excise, VAT, deposit), PDF and email sending, numbering, receivables.
4. **Purchases and costs:** document intake and OCR, approval flow, receipts with categories and rules, expense claims.
5. **Bank:** PSD2 feed, reconciliation with suggestions, SEPA payment batches.
6. **Stock and excise:** stock movements, bonded and duty-paid locations, excise return, samples.
7. **Ledger and reports:** journal, period close, VAT return (NL first), ICP listing, profit and loss, balance sheet, accountant export.
8. **Shipments and customs:** shipments, document tracking, EMCS and e-AD drafting.
9. **Billing:** plans, trials, payment provider (Stripe or Mollie), dunning, suspension.
10. **Expansion:** country tax packs (BE, DE, FR, IT, ES, PL), filing integrations, SSO, API.
