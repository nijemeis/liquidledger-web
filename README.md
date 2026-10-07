# Liquid Ledger

Bookkeeping, stock and excise for importers, exporters and wholesalers of drinks — wine, beer, spirits,
fortified wine, water and soft drinks. Multi-tenant SaaS: one platform, many client companies, each with
their own administrations, users and roles, plus a platform admin console for the Liquid Ledger team.

The product design is in [`docs/design-handoff/`](docs/design-handoff/) (the Claude Design handoff:
README, domain rules, interactive prototypes and screenshots). This repository is the production build of it.

## What's in it

| Area | |
|---|---|
| **Sign-in** | Email + password, **mandatory two-factor authentication** (authenticator app, passkeys, SMS fallback, 10 recovery codes), "Sign in with a passkey", trusted devices (30 days), lockout after 5 failures, new-device emails with a "this wasn't me" lock link, password reset, invitations, free-trial sign-up |
| **Customer app** | Dashboard · Bank (statement import CAMT.053/CSV, match suggestions, rules) · Sales invoices (tax engine for excise + VAT per regime, numbering, credit notes, print/PDF) · Purchase invoices (upload, AI reading, booking proposal) · Costs & receipts (plain-language categories → ledger accounts, rules, expense claims) · Relations (VIES checks) · Products · Stock & warehouses (bonded / duty-paid / in transit) · Excise & customs (return per period, EMCS/customs documents) · Orders & shipments · VAT return (NL boxes, ICP) · General ledger · Reports (P&L, balance sheet, accountant exports) · Settings (security, users & roles, administration, booking rules) |
| **Platform admin** | Separate console (own host in production) with **passkey-only staff sign-in**: clients, users, roles & permissions, plans & billing, audit log (CSV export), security policies, excise rates, time-boxed **support access** (reason required, client notified, audit-logged, read-only) |
| **Languages** | NL, EN, FR, DE, IT, ES, PL; numbers and dates formatted per locale; ledger account names in the administration's chart language |

## Stack

- **Next.js 15** (App Router, React 19, Server Components + Server Actions), TypeScript
- **PostgreSQL 16** via **Prisma 6**, with **row-level security** per administration
- Auth built from audited libraries: `@node-rs/argon2` (argon2id), `otplib` (TOTP), `@simplewebauthn/server` (passkeys)
- Phosphor icons, Geist + Oleo Script fonts (self-hosted by `next/font`)
- Vitest for unit and database tests, Playwright for browser checks

## Security model

Financial data, so the defaults are strict:

- **Tenant isolation in the database.** Every bookkeeping table has `administration_id` and a Postgres
  row-level-security policy. Application code reads and writes tenant data only inside `withTenant()`
  (`src/lib/db.ts`), which sets the administration for that transaction. A query that forgets its filter
  still can't see another tenant; a query outside a tenant transaction sees nothing. The app refuses to start
  in production if its database role could bypass RLS. Tests: `tests/tenancy.test.ts`.
- **Books can't be rewritten.** Journal lines are immutable (database trigger); corrections are reversing
  entries. Entries can't be posted into a closed period (trigger). Every entry must balance (posting engine).
  Invoice and journal numbers are gapless per administration.
- **2FA for everyone**; staff must use passkeys. TOTP secrets are encrypted at rest (AES-256-GCM,
  `APP_ENCRYPTION_KEY`) with replay protection; recovery codes and all tokens are stored only as hashes.
- **Sessions** are opaque random tokens (hashed in the database), `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`
  prefixed in production; 30-minute idle timeout (stricter per client possible), 12-hour absolute lifetime,
  "sign out all sessions". Client and staff sessions are separate cookies on separate hosts.
- **Brute-force protection**: per-IP and per-account rate limits (stored in Postgres, so they work across
  instances), lockout after 5 failed password or 2FA attempts for 15 minutes, with an email to the user.
- **Audit log** for sign-ins, lockouts, permission changes, filings, support sessions, rate changes and bookings.
- **Headers**: strict CSP, HSTS, `X-Frame-Options: DENY`, no MIME sniffing, same-origin checks on JSON endpoints
  (Server Actions check the Origin header).
- **Least privilege**: the role × permission matrix from the handoff (`src/lib/permissions.ts`) is enforced on
  every server action, not just hidden in the UI.

## Run it locally

Requirements: Node 22, PostgreSQL 16.

```bash
# 1. Database: a normal (non-superuser) role that owns its database
createuser liquidledger --pwprompt --createdb      # password: liquidledger
createdb -O liquidledger liquidledger

# 2. Config
cp .env.example .env
#   set APP_ENCRYPTION_KEY: openssl rand -base64 32

# 3. Install, migrate, load the demo company
npm install
npx prisma migrate deploy
npm run db:seed          # prints demo logins, an authenticator secret and staff set-up links

# 4. Run
npm run dev              # http://localhost:3000
```

The seed creates **Vale & Hart Drinks B.V.** with nine months of history booked through the real
posting engine (purchases, releases for consumption, sales, payments, payroll, tax payments) plus the
admin console's clients, users and staff. Sign in as `marta@valehart.nl` / `wijnkelder-2026`; add the
printed authenticator secret to your authenticator app (or a password manager) for the 6-digit code.
Platform staff (`/admin`) first open their set-up link to choose a password and register a passkey.

Checks:

```bash
npm run typecheck
npm test                 # unit + database tests (needs a liquidledger_test database)
npm run build
```

## Deploy (DigitalOcean App Platform, Frankfurt)

`.do/app.yaml` describes the app: two web instances (stateless — sessions live in Postgres), a pre-deploy
migration job, a managed PostgreSQL 16 cluster in `fra1`, and the domains `liquidledger.net` and
`admin.liquidledger.net` (the admin console is only served on the admin host).

1. Create the database cluster in **fra1**, then a dedicated **non-superuser** role for the app (e.g.
   `liquidledger_app`) that owns the `liquidledger` database. Use the PgBouncer **transaction-mode** pool
   for `DATABASE_URL` (append `?pgbouncer=true&connection_limit=5`) and the direct connection for `DIRECT_URL`.
2. `doctl apps create --spec .do/app.yaml`, then fill in the secrets: `DATABASE_URL`, `DIRECT_URL`,
   `APP_ENCRYPTION_KEY` (`openssl rand -base64 32` — keep a copy in your password manager: losing it
   means every user must set up their authenticator app again), `SMTP_URL`, optionally `ANTHROPIC_API_KEY`
   (document reading), `S3_*` (Spaces for documents) and `TWILIO_*` (SMS fallback).
3. Point the DNS records of both domains at the app.
4. Create the first staff member: `npm run staff:create -- --email you@liquidledger.net --name "Your Name" --role SUPER_ADMIN`
   (run in the App Platform console), open the printed set-up link and register your passkey.
5. Add your own company as a client from the admin console, or sign up for a trial.

**Before going live:** have a Dutch tax adviser validate the VAT boxes and excise rules, replace the
illustrative excise rates (admin console → Excise rates) with the official Douane table, review the privacy
policy and terms (placeholders under `/privacy` and `/terms`), configure SMTP with SPF/DKIM for
`liquidledger.net`, and enable daily backups + point-in-time recovery on the database.

## Project layout

```
prisma/              schema, migrations (incl. row-level security), demo seed
src/app/(auth)       sign-in, 2FA, enrolment, reset, invite, trial
src/app/(app)        the customer app (one folder per screen; actions.ts = Server Actions)
src/app/admin        platform admin console
src/app/api          JSON endpoints (auth ceremonies, documents, exports, health)
src/lib/auth         sessions, login flow, TOTP, WebAuthn, rate limits
src/lib/domain       accounting core: posting engine, tax engine (excise, VAT), sales, purchases,
                     receipts, bank matching, stock, returns, reports — framework-free and unit-tested
src/i18n             translations (one file per area) and formatting
docs/design-handoff  the design this is built from
```

## Not yet automated

These need contracts or certifications with third parties and are later milestones in the handoff's build order:

- **Filing**: VAT/ICP returns (Digipoort) and excise/EMCS (Douane) are prepared in full, but you file the
  figures in the official portal and record the reference in Liquid Ledger.
- **Bank feeds**: statements are imported as CAMT.053 or CSV (every Dutch bank exports these); live PSD2
  feeds need an aggregator contract (Tink, GoCardless, Salt Edge).
- **Billing**: subscription invoices are tracked; card collection needs Stripe or Mollie.
- **Email-in** for documents, **payroll provider** API import, **Peppol** e-invoicing, **SSO (SAML)** for Enterprise.
- **Country tax packs** beyond the Netherlands (BE, DE, FR, IT, ES, PL VAT layouts and charts of accounts):
  the engine is configuration-driven, but each country needs its own validated layout.
