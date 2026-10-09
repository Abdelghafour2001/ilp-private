#!/usr/bin/env sh
set -e

if [ "${RUN_DB_MIGRATIONS_ON_START:-true}" = "true" ]; then
  if [ "${STARTUP_DIAGNOSTICS_ENABLED:-true}" = "true" ]; then
    # Report every dependency first (a few seconds at most): if the database is unreachable,
    # migrations can hang or fail with a raw traceback, and this explains why.
    python -m app.core.diagnostics api || true
    export STARTUP_DIAGNOSTICS_DONE=1
  fi
  echo "Running database migrations..."
  alembic upgrade head
  if [ "${AUTO_SEED:-0}" = "1" ]; then
    echo "Seeding demo data (AUTO_SEED=1)..."
    python -m app.seed_all || echo "Seeding failed; continuing without it."
  fi
else
  echo "Skipping database migrations (RUN_DB_MIGRATIONS_ON_START=${RUN_DB_MIGRATIONS_ON_START})."
fi

exec "$@"
