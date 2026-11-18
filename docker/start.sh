#!/bin/sh
# Container entrypoint: apply pending database migrations, then start the app.
# `migrate deploy` only runs migrations that haven't been applied (a no-op on a
# restart) and takes an advisory lock, so two containers starting together are
# safe. Set MIGRATE_ON_START=0 to skip it (e.g. when a separate job migrates).
set -e
if [ "${MIGRATE_ON_START:-1}" != "0" ]; then
  echo "[start] applying database migrations"
  node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy
fi
exec node server.js
