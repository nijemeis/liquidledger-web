# Liquid Ledger — working notes

Multi-tenant bookkeeping SaaS for drinks importers. Next.js 15 App Router + Prisma 6 + PostgreSQL 16.
Spec and design: `docs/design-handoff/` (README.md, DOMAIN_AND_DATA.md, prototypes in `designs/`).

## Non-negotiables
- **Tenant data only through `withTenant()` / `tenant(ctx, …)` / `appAction()`** (`src/lib/db.ts`, `src/lib/app-context.ts`).
  Postgres row-level security enforces isolation on every table with `administration_id`; never bypass it
  (`withSystem()` is for platform code only). Still filter on `administrationId` explicitly.
- **Money is integer cents.** Never floats. Volume in ml (`volumeMl`), alcohol in basis points (`abvBp`, 13.5% = 1350).
- **All bookings go through the posting engine** (`src/lib/domain/ledger.ts` `post()`); journal lines are
  immutable — correct with `reverse()`. Tax logic lives in `src/lib/domain/{excise,vat,sales,purchases}.ts`
  (pure functions, unit-tested in `tests/`).
- **Every mutation is a Server Action wrapped in `appAction(permission, fn)`** — it checks the session, role
  permission, read-only states (support view, suspended client), runs in the tenant transaction and turns
  `PostingError` into a user-facing message. Audit important changes with `auditApp()`.
- **Every UI string goes through `t()`**; each area has its own namespace file in `src/i18n/messages/`
  (English is the fallback, Dutch must be complete).
- Never auto-book: suggestions are shown with the dashed `suggest` style and need confirmation or a rule.

## Patterns
- Pages: server components in `src/app/(app)/<screen>/page.tsx`; `requireApp(permission)` first. URL holds UI state (`?tab=`, `?id=`, `?new=1`).
- Client interactivity: `useAction(action)` from `src/components/client.tsx` (toast + refresh). UI kit: `globals.css` classes,
  `src/components/ui.tsx`, `src/components/client.tsx`, icons via `src/components/icon.tsx` registry.
- Auth: `src/lib/auth/*` (client users) and `src/lib/auth/staff-flow.ts` (platform staff, passkey required).

## Commands
- `npm run dev` · `npm run typecheck` · `npm test` (needs `liquidledger_test` DB) · `npm run build`
- `npx prisma migrate dev --name <change>` for schema changes (keep RLS policies for new tenant tables:
  add them to a migration like `prisma/migrations/*_row_level_security`).
- `npm run db:seed` resets the database with the demo company (never in production).
