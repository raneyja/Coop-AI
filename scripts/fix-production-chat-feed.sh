#!/usr/bin/env bash
# Repair production chat_threads schema after false migration ledger entry.
# Requires: Railway CLI logged in, Postgres service online, plan active.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! npx --yes @railway/cli whoami >/dev/null 2>&1; then
  echo "Railway CLI not authenticated. Run: npx @railway/cli login"
  exit 1
fi

echo "Fetching production DATABASE_PUBLIC_URL from Railway Postgres..."
DATABASE_URL="$(
  npx --yes @railway/cli variables --service Postgres --json \
    | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); const u=j.DATABASE_PUBLIC_URL; const sep=u.includes('?')?'&':'?'; process.stdout.write(u+sep+'sslmode=no-verify');"
)"

export DATABASE_URL
export DATABASE_SSL=true

echo "Running migration repair (host redacted)..."
node scripts/run-migrations.mjs

echo "Verifying chat_threads table..."
node -e "
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(\"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='chat_threads') AS ok\")
  .then((r) => {
    if (!r.rows[0]?.ok) throw new Error('chat_threads still missing after migrate');
    console.log('OK: chat_threads exists on production');
    return pool.end();
  })
  .catch((e) => { console.error(e.message || e); process.exit(1); });
"

echo "Redeploying Coop-AI so API picks up Chat Feed fixes..."
npx --yes @railway/cli service link Coop-AI >/dev/null 2>&1 || true
npx --yes @railway/cli redeploy --yes

echo "Done. Reload admin Chat Feed and send a message in the extension to backfill threads."
