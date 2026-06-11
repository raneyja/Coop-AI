#!/usr/bin/env bash
# Apply pending SQL migrations to an existing Postgres database.
# Fresh Docker volumes auto-apply via docker-entrypoint-initdb.d; use this script
# when upgrading a database that was created before newer migrations existed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="${ROOT}/migrations"
# Default targets Docker Compose Postgres. If localhost fails with "role coop does not exist",
# use: docker compose exec -T postgres psql -U coop -d coopai -f migrations/NNN_name.sql
DATABASE_URL="${DATABASE_URL:-postgres://coop:coop@127.0.0.1:5432/coopai}"

echo "Using DATABASE_URL=${DATABASE_URL}"
echo "Migrations directory: ${MIGRATIONS_DIR}"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

for file in "${MIGRATIONS_DIR}"/*.sql; do
  base="$(basename "${file}")"
  # Skip macOS duplicate filenames (should not exist after hygiene cleanup)
  if [[ "${base}" == *" 2"* ]]; then
    continue
  fi
  applied="$(psql "${DATABASE_URL}" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '${base}'" 2>/dev/null | tr -d '[:space:]')"
  if [[ "${applied}" == "1" ]]; then
    echo "skip  ${base} (already applied)"
    continue
  fi
  echo "apply ${base}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (filename) VALUES ('${base}')"
done

echo "Migrations complete."
