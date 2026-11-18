# Deploying Liquid Ledger to Coolify (self-hosted)

App built from the repo's **Dockerfile**, PostgreSQL running **on the same Coolify server**, two hostnames on one app:

| | For now | Later |
|---|---|---|
| Customer app | `liquidledger.spiderintheweb.nl` | `liquidledger.net` |
| Admin console (only served there) | `liquidledger-admin.spiderintheweb.nl` | `admin.liquidledger.net` |

The admin host is a sibling (`liquidledger-admin.…`), not `admin.liquidledger.…`, so a wildcard record for
`*.spiderintheweb.nl` covers both (wildcards only reach one level). Moving to `liquidledger.net` later is a
change of domains and environment variables only — see the end of this document.

Steps marked **YOU** happen in the Coolify UI or your DNS (I can't reach your server).

> **Already in the repo (DONE), and tested end to end against Postgres 17 in Docker:**
> `Dockerfile` (standalone Next.js, Debian slim, curl for the health check), `docker/start.sh` (applies pending
> migrations, then starts the server), `docker/coolify-db.sql` (one-time database + role), `/api/health`
> (checks the database), `scripts/create-staff.mjs` (first admin, runs inside the container), and the startup
> check that refuses a database role that could bypass row-level security.

---

## 1. PostgreSQL — YOU

1. **+ New → Database → PostgreSQL** (the default image, Postgres 16 or 17, is fine — no extensions needed).
   Keep it **not publicly exposed**.
2. Start it, open its **Terminal** and run `psql -U postgres` (use the superuser name Coolify shows if it isn't
   `postgres`). Paste the contents of [`docker/coolify-db.sql`](../docker/coolify-db.sql) with `CHANGE_ME`
   replaced by a long random password (`openssl rand -hex 24`). It creates:
   - role `liquidledger` — **not** a superuser, no BYPASSRLS — which owns
   - database `liquidledger`.

   **Why not Coolify's generated user?** That user is a superuser, and a superuser silently bypasses
   row-level security — the guarantee that one client never sees another client's books. The app checks this
   at startup and **refuses to start** when its role could bypass it.
3. Note the database's **internal hostname** (its service name on Coolify's Docker network, shown on the
   database page). The app connects over that private network, so no TLS and no public port are needed.

---

## 2. The app — YOU

**+ New → Application → Public/Private Git repository →** `nijemeis/liquidledger-web`, branch `main`.

- **Build Pack: Dockerfile** (repo root, no base directory).
- **Ports Exposes: `8080`**.
- **Domains:** `https://liquidledger.spiderintheweb.nl,https://liquidledger-admin.spiderintheweb.nl`
  (comma-separated; Coolify gets Let's Encrypt certificates for both).
- **Health check:** path `/api/health`, port `8080`. It touches the database, so a deploy that can't reach
  Postgres stays unhealthy instead of serving errors.
- **No pre-deployment command needed:** the container runs `prisma migrate deploy` itself on start. It only
  applies migrations that haven't run yet (a no-op on restarts) and takes a database lock, so a restart or
  a second container is safe. (Set `MIGRATE_ON_START=0` if you ever want a separate job to migrate.)
- Turn on **auto-deploy on push to `main`** if you want the same flow as the other apps.

---

## 3. Environment variables — YOU

| Key | Value |
|---|---|
| `DATABASE_URL` | `postgresql://liquidledger:<password>@<db-internal-host>:5432/liquidledger?connection_limit=10` |
| `DIRECT_URL` | the same URL without `?connection_limit…` (no pooler here; migrations use it) |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` — **secret**. Encrypts users' authenticator secrets. Keep a copy in your password manager: losing or changing it means every user must set up 2FA again. |
| `APP_URL` | `https://liquidledger.spiderintheweb.nl` |
| `ADMIN_URL` | `https://liquidledger-admin.spiderintheweb.nl/admin` |
| `ADMIN_HOST` | `liquidledger-admin.spiderintheweb.nl` (the admin console is only served on this host) |
| `WEBAUTHN_RP_ID` | `spiderintheweb.nl` — passkeys must belong to a domain both hosts share |
| `WEBAUTHN_ORIGINS` | `https://liquidledger.spiderintheweb.nl,https://liquidledger-admin.spiderintheweb.nl` |
| `TRUSTED_IP_HEADER` | `x-real-ip` (set by Coolify's Traefik; used for rate limits and sign-in alerts). Behind Cloudflare's proxy use `cf-connecting-ip`. |
| `SMTP_URL` | **secret**, e.g. `smtps://user:pass@smtp.postmarkapp.com:465`. Required for invitations, trial sign-ups, password resets and new-device alerts — without it those mails are only written to the log. |
| `MAIL_FROM` | e.g. `Liquid Ledger <no-reply@spiderintheweb.nl>` — an address your SMTP provider may send from (SPF/DKIM set up for that domain) |
| `ANTHROPIC_API_KEY` | optional, **secret** — reading uploaded purchase invoices |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | optional — uploaded documents go to object storage; without them they're stored in Postgres (fine to start with, and covered by the database backup) |

`NODE_ENV=production` and `PORT=8080` are set by the image. Mark every secret as **locked** in Coolify.
Never set `ALLOW_RLS_BYPASS_ROLE` — it exists only to override the startup safety check.

---

## 4. DNS — YOU

Point **A** (and AAAA if you use IPv6) records for `liquidledger.spiderintheweb.nl` and
`liquidledger-admin.spiderintheweb.nl` at the Coolify server (nothing to do if `*.spiderintheweb.nl` already
points there), then deploy so Coolify can obtain the certificates. If you proxy through Cloudflare, use SSL mode
**Full (strict)** and set `TRUSTED_IP_HEADER=cf-connecting-ip`.

---

## 5. Deploy and verify

Deploy and watch the log: `[start] applying database migrations` → `All migrations have been successfully
applied` → `Ready`. Then:

```bash
curl -s https://liquidledger.spiderintheweb.nl/api/health                                  # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" https://liquidledger.spiderintheweb.nl/login                 # 200
curl -s -o /dev/null -w "%{http_code}\n" https://liquidledger-admin.spiderintheweb.nl/admin/login     # 200
```

If the log says *"The database role can bypass row-level security … Refusing to start"*, `DATABASE_URL` uses
the superuser — switch it to the `liquidledger` role from step 1.

---

## 6. First admin — YOU

Production starts empty. Open the app's **Terminal** in Coolify and run:

```bash
node scripts/create-staff.mjs --email you@example.com --name "Your Name"
```

It prints a one-time set-up link (valid 48 hours). Open it, choose a password and register a passkey
(Touch ID / Windows Hello / phone). Run it again for a fresh link if you lose the passkey.

Never run the demo seed against this database — it wipes everything (and refuses to run in production).

---

## 7. Before real customers — YOU

- **Excise rates:** admin console → *Excise rates*. Production has none: add the official Douane rates per
  category (with bands — see the README's *Excise rates* section) before anyone sends an invoice.
- **Your company:** admin console → *Clients* → add it, or sign up through `/signup` like a customer would.
- **Backups:** on the database page, schedule daily backups to S3-compatible storage, and do one **restore
  test**. A self-hosted database has no managed failover, so backups matter more than on a managed provider.
- **Mail:** send yourself a password reset to confirm SMTP works (and lands in the inbox, not spam).
- **Legal:** the privacy policy and terms under `/privacy` and `/terms` are placeholders.

---

## Notes

- **Image:** Debian slim, not Alpine — Prisma's engine expects glibc/OpenSSL. The Prisma CLI is installed with
  all of its dependencies in `/opt/prisma-cli` (copying `node_modules/prisma` alone breaks `migrate deploy`).
- **Scaling:** the app is stateless (sessions live in Postgres), so more containers are fine; keep
  `connection_limit` × containers below Postgres' `max_connections` (100 by default).
- **Updating:** push to `main` → Coolify builds → the new container migrates and starts → the health check
  passes → traffic switches. Journal entries are immutable and migrations only add, so rolling back the app
  image is safe as long as no migration removed something it needs.

---

## Moving to liquidledger.net later

1. Add `https://liquidledger.net,https://admin.liquidledger.net` to the app's domains (keep the old ones for a
   while so links in sent emails keep working) and point DNS at the server.
2. Change `APP_URL`, `ADMIN_URL`, `ADMIN_HOST`, `WEBAUTHN_RP_ID` (`liquidledger.net`), `WEBAUTHN_ORIGINS` and
   `MAIL_FROM`, and redeploy.
3. **Passkeys are tied to their domain:** passkeys registered under `spiderintheweb.nl` don't work on
   `liquidledger.net`. Staff get a fresh set-up link with `node scripts/create-staff.mjs --email …` and register
   a new passkey; client users sign in with their authenticator app or a recovery code and can add a passkey
   again. Authenticator-app codes don't depend on the domain and keep working.
4. Sessions are per host, so everyone signs in again once.

