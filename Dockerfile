# syntax=docker/dockerfile:1.7
# Production image: Next.js standalone output on Node 22 (Coolify, DigitalOcean…).
# Debian-based (not Alpine) so Prisma's engine finds the OpenSSL it expects.
# No secrets or DATABASE_URL are needed at build time; config comes from the
# environment at run time. See docs/deploy-coolify.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# Prisma CLI with all of its dependencies, at the project's version, in its own
# folder: copying node_modules/prisma alone misses its dependencies and breaks
# `migrate deploy` inside the container.
FROM deps AS prisma-cli
RUN mkdir -p /opt/prisma-cli && cd /opt/prisma-cli && echo '{"private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund "prisma@$(node -p "require('/app/node_modules/prisma/package.json').version")"

FROM node:22-bookworm-slim AS run
WORKDIR /app
# curl: Coolify runs its health check inside the container, and the slim image has neither curl nor wget.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# Schema + Prisma CLI: start.sh applies pending migrations before the server starts.
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=prisma-cli --chown=app:app /opt/prisma-cli/node_modules /opt/prisma-cli/node_modules
COPY --from=build --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
# First platform-staff member: node scripts/create-staff.mjs --email you@example.com
COPY --from=build --chown=app:app /app/scripts/create-staff.mjs ./scripts/create-staff.mjs
COPY --from=build --chown=app:app /app/docker/start.sh ./start.sh
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["./start.sh"]
