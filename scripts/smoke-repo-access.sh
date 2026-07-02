#!/usr/bin/env bash
# Automated smoke test for admin-controlled repo indexing + per-user grants.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API="${COOP_API_BASE:-http://localhost:8787}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPassword12!}"

echo "=== health ==="
curl -sf "$API/health" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (!j.ok) process.exit(1);
  console.log('ok');
"

echo "=== seed demo org ==="
docker compose cp dist/admin-org.js api:/app/dist/admin-org.js >/dev/null 2>&1 || true
SEED_JSON="$(docker compose exec -T -e DATABASE_URL=postgres://coop:coop@postgres:5432/coopai -e DEMO_PASSWORD="$DEMO_PASSWORD" api node dist/admin-org.js seed-repo-access-demo)"
echo "$SEED_JSON" > /tmp/coop-repo-access-demo.json

ORG_ID="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-repo-access-demo.json','utf8')).orgId")"
ADMIN_EMAIL="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-repo-access-demo.json','utf8')).admin.email")"
DEV_EMAIL="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-repo-access-demo.json','utf8')).developer.email")"

login() {
  local email="$1"
  curl -sf -X POST "$API/v1/auth/login" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\"}" \
    | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken"
}

echo "=== login admin ==="
ADMIN_TOKEN="$(login "$ADMIN_EMAIL")"

echo "=== admin org has repoAccessMode ==="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/admin/org" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.plan !== 'pro' || j.repoAccessMode !== 'all_indexed') {
    console.error(j);
    process.exit(1);
  }
  console.log('ok', j.repoAccessMode);
"

echo "=== catalog has 5 repos, 3 indexed ==="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/orgs/repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const repos = j.repos ?? [];
  if (repos.length !== 5) { console.error('expected 5 catalog repos', repos.length); process.exit(1); }
  const indexed = repos.filter(r => r.lightningEnabled);
  if (indexed.length !== 3) { console.error('expected 3 indexed', indexed.length); process.exit(1); }
  const personal = repos.filter(r => r.repoId.includes('raneyja'));
  if (personal.some(r => r.lightningEnabled)) { console.error('personal repos must not be indexed'); process.exit(1); }
  console.log('ok', indexed.length, 'indexed,', personal.length, 'personal idle');
"

echo "=== login developer (all_indexed) ==="
DEV_TOKEN="$(login "$DEV_EMAIL")"

curl -sf -H "Authorization: Bearer $DEV_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.adminControlled !== true || j.repoAccessMode !== 'all_indexed') {
    console.error(j);
    process.exit(1);
  }
  if ((j.repos ?? []).length !== 3) {
    console.error('expected 3 workspace repos in all_indexed mode', j);
    process.exit(1);
  }
  console.log('ok all_indexed workspace', j.repos.length);
"

echo "=== switch to per_user ==="
curl -sf -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"repoAccessMode":"per_user"}' "$API/v1/admin/org/repo-access" >/dev/null

curl -sf -H "Authorization: Bearer $DEV_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.repoAccessMode !== 'per_user' || (j.repos ?? []).length !== 2) {
    console.error('expected 2 granted repos in per_user mode', j);
    process.exit(1);
  }
  console.log('ok per_user workspace', j.repos.map(r => r.repoId).join(', '));
"

echo "=== catalog filtered for developer ==="
curl -sf -H "Authorization: Bearer $DEV_TOKEN" "$API/v1/orgs/catalog/repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const repos = j.repos ?? [];
  if (repos.length !== 2) {
    console.error('expected 2 catalog repos for granted developer', repos);
    process.exit(1);
  }
  console.log('ok catalog filtered', repos.length);
"

echo "=== enable repo without grant stays hidden ==="
curl -sf -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{}' "$API/v1/orgs/repos/github%3Aacme%2Fmobile/lightning/enable" >/dev/null

curl -sf -H "Authorization: Bearer $DEV_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if ((j.repos ?? []).length !== 2) {
    console.error('mobile indexed but dev should still see only 2 grants', j);
    process.exit(1);
  }
  console.log('ok grant gate holds after new index');
"

echo ""
echo "=== SMOKE PASS ==="
echo "Demo credentials written to /tmp/coop-repo-access-demo.json"
echo "Admin portal: http://localhost:3001/login"
echo "  Admin: $ADMIN_EMAIL / $DEMO_PASSWORD"
echo "  Dev:   $DEV_EMAIL / $DEMO_PASSWORD"
echo "Org ID: $ORG_ID"
