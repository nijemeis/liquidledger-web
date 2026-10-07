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

## Run it on your own computer

This takes about 10 minutes the first time. You need three programs:

| Program | Why | Get it |
|---|---|---|
| **Git** | download the code | Mac: run `git --version` in Terminal — macOS offers to install it if missing |
| **Node.js 22** | runs the app | https://nodejs.org (the "LTS" installer) or `brew install node@22` |
| **Docker Desktop** | runs the database | https://www.docker.com/products/docker-desktop — open it once so it's running |

Then, in Terminal:

```bash
# 1. Download the code and go into the folder
git clone https://github.com/nijemeis/liquidledger-web.git
cd liquidledger-web

# 2. Install the app's libraries (a few minutes the first time)
npm install

# 3. Start the database (keeps running in the background)
docker compose up -d

# 4. Set everything up: config file, database tables, demo company
npm run setup

# 5. Start the app
npm run dev
```

Open **http://localhost:3000** and sign in:

- Email `marta@valehart.nl`, password `wijnkelder-2026`
- For the 6-digit code, open a **second** Terminal window in the same folder and run `npm run dev:code`.
  It prints the current code (it changes every 30 seconds). It also prints a setup key you can add to an
  authenticator app (Google Authenticator, Microsoft Authenticator, 1Password: "enter a setup key") if you
  prefer using your phone.
- Other demo users: `joost@valehart.nl` (Warehouse role) and `eva@bakker-accountants.nl` (external accountant),
  same password; `npm run dev:code -- joost@valehart.nl` for their code.

**Platform admin console** (http://localhost:3000/admin): staff sign in with a passkey. `npm run setup` prints a
set-up link for each staff member — open one, choose a password and register a passkey (on a Mac: Touch ID in
Chrome or Safari).

**Emails** (password resets, invites, new-device alerts) aren't sent locally; they're printed in the Terminal
window running `npm run dev`, so copy links from there.

### Day to day

| Task | Command |
|---|---|
| Start the app | `docker compose up -d` (if the database isn't running) then `npm run dev` |
| Stop the app | `Ctrl+C` in its Terminal; `docker compose stop` stops the database |
| Fresh demo data | `npm run db:seed` (wipes the local database and reloads the demo company) |
| Current login code | `npm run dev:code` |
| Get the latest code | `git pull`, then `npm install` and `npx prisma migrate deploy` |
| Run the checks | `npm run typecheck`, `npm test`, `npm run build` |

### If something goes wrong

- **"Can't reach PostgreSQL"** — Docker Desktop isn't running, or the database hasn't started yet. Open Docker
  Desktop, run `docker compose up -d`, wait a few seconds, then `npm run setup` again.
- **Port 5432 already in use** — you already run PostgreSQL yourself (e.g. Homebrew). Either stop it
  (`brew services stop postgresql@17`) or use it instead of Docker: create a normal user and database
  (`createuser liquidledger --pwprompt --createdb`, password `liquidledger`; `createdb -O liquidledger liquidledger`)
  and run `npm run setup`.
- **"That code isn't right"** — run `npm run dev:code` again and type the code quickly; after five wrong
  attempts the account locks for 15 minutes (`npm run db:seed` resets everything).
- **Port 3000 in use** — `npm run dev -- -p 3001` and open http://localhost:3001.

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
