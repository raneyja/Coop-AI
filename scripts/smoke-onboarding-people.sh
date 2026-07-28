#!/usr/bin/env bash
# Full onboarding people/access wiring smoke — mirrors admin People & access + Indexing grant flows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API="${COOP_API_BASE:-http://localhost:8787}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPassword12!}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok $*"; }

echo "=== health ==="
curl -sf "$API/health" >/dev/null || fail "API health"
pass health

echo "=== build + seed repo-access demo (indexed ready repos) ==="
npm run build:admin >/dev/null
docker compose cp dist/admin-org.js api:/app/dist/admin-org.js >/dev/null 2>&1 || true
SEED_JSON="$(docker compose exec -T -e DATABASE_URL=postgres://coop:coop@postgres:5432/coopai -e DEMO_PASSWORD="$DEMO_PASSWORD" api node dist/admin-org.js seed-repo-access-demo)"
echo "$SEED_JSON" > /tmp/coop-onboarding-people-smoke.json

ADMIN_EMAIL="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-onboarding-people-smoke.json','utf8')).admin.email")"
ADMIN_ID="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-onboarding-people-smoke.json','utf8')).admin.id")"
DEV_EMAIL="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-onboarding-people-smoke.json','utf8')).developer.email")"
DEV_ID="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-onboarding-people-smoke.json','utf8')).developer.id")"

login() {
  local email="$1"
  curl -sf -X POST "$API/v1/auth/login" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\"}"
}

echo "=== login admin — me must expose userId ==="
ADMIN_LOGIN="$(login "$ADMIN_EMAIL")"
ADMIN_TOKEN="$(node -pe "JSON.parse(process.argv[1]).accessToken" "$ADMIN_LOGIN")"
LOGIN_USER_ID="$(node -pe "JSON.parse(process.argv[1]).userId || ''" "$ADMIN_LOGIN")"
[[ -n "$ADMIN_TOKEN" ]] || fail "admin token"
if [[ -z "$LOGIN_USER_ID" ]]; then
  echo "WARN: login payload missing userId — /v1/me fallback required"
else
  [[ "$LOGIN_USER_ID" == "$ADMIN_ID" ]] || fail "login userId mismatch"
  pass "login userId=$LOGIN_USER_ID"
fi

echo "=== /v1/me returns userId + email ==="
ME_JSON="$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/me")"
node -e "
  const j = JSON.parse(process.argv[1]);
  if (!j.userId) process.exit(1);
  if (String(j.email || '').toLowerCase() !== '$ADMIN_EMAIL') process.exit(2);
  if (j.canInstallIntegrations !== true && j.role !== 'admin' && j.role !== 'owner') process.exit(3);
  console.log('ok me', j.userId, j.email, j.role);
" "$ME_JSON" || fail "/v1/me shape"

echo "=== org starts all_indexed + onboarding incomplete ==="
ORG_JSON="$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/admin/org")"
node -e "
  const j = JSON.parse(process.argv[1]);
  if (j.repoAccessMode !== 'all_indexed') process.exit(1);
  if (j.onboardingCompleted === true) process.exit(2);
  console.log('ok org mode', j.repoAccessMode, 'onboardingCompleted', j.onboardingCompleted);
" "$ORG_JSON" || fail "org initial state"

echo "=== indexed repos are developer-ready (grantable) ==="
REPOS_JSON="$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/orgs/repos")"
READY_IDS="$(node -e "
  const j = JSON.parse(process.argv[1]);
  const ready = (j.repos || []).filter(r => r.lightningEnabled && r.indexStatus === 'ready' && r.browseStatus !== 'failed');
  if (ready.length < 3) { console.error(ready); process.exit(1); }
  console.log(ready.map(r => r.repoId).join(','));
" "$REPOS_JSON")" || fail "ready repos"
pass "ready repos $READY_IDS"

echo "=== all_indexed: admin workspace sees all 3 ==="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.repoAccessMode !== 'all_indexed' || (j.repos || []).length !== 3) {
    console.error(j); process.exit(1);
  }
  console.log('ok workspace all_indexed', j.repos.length);
"

echo "=== switch to per_user (People & access radio) ==="
curl -sf -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"repoAccessMode":"per_user"}' "$API/v1/admin/org/repo-access" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.repoAccessMode !== 'per_user') process.exit(1);
  console.log('ok switched per_user');
"

echo "=== per_user before self-grant: admin sees 0 workspace repos ==="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.repoAccessMode !== 'per_user' || (j.repos || []).length !== 0) {
    console.error('expected empty admin workspace before grant', j); process.exit(1);
  }
  console.log('ok admin empty before grant');
"

echo "=== grant myself all ready repos (Grant myself button) ==="
READY_JSON="$(node -pe "JSON.stringify('$READY_IDS'.split(','))")"
curl -sf -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d "{\"repoIds\":$READY_JSON}" \
  "$API/v1/admin/users/$ADMIN_ID/repo-grants" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if ((j.repoIds || []).length !== 3) { console.error(j); process.exit(1); }
  console.log('ok admin grants', j.repoIds.join(', '));
"

echo "=== admin workspace now has 3 ==="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if ((j.repos || []).length !== 3) { console.error(j); process.exit(1); }
  console.log('ok admin workspace after grant', j.repos.length);
"

echo "=== developer still only sees pre-seeded 2 grants ==="
DEV_LOGIN="$(login "$DEV_EMAIL")"
DEV_TOKEN="$(node -pe "JSON.parse(process.argv[1]).accessToken" "$DEV_LOGIN")"
curl -sf -H "Authorization: Bearer $DEV_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if ((j.repos || []).length !== 2) { console.error(j); process.exit(1); }
  console.log('ok developer grants unchanged', j.repos.map(r => r.repoId).join(', '));
"

echo "=== switch back to all_indexed (Everyone gets Usable repos) ==="
curl -sf -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"repoAccessMode":"all_indexed"}' "$API/v1/admin/org/repo-access" >/dev/null
curl -sf -H "Authorization: Bearer $DEV_TOKEN" "$API/v1/me/workspace-repos" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.repoAccessMode !== 'all_indexed' || (j.repos || []).length !== 3) {
    console.error(j); process.exit(1);
  }
  console.log('ok developer inherits all indexed after all_indexed');
"

echo "=== grants rejected while all_indexed (UI only grants in per_user) ==="
CODE="$(curl -s -o /tmp/grant-reject.json -w '%{http_code}' -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d "{\"repoIds\":$READY_JSON}" \
  "$API/v1/admin/users/$DEV_ID/repo-grants")"
[[ "$CODE" == "400" ]] || fail "expected 400 when granting in all_indexed got $CODE $(cat /tmp/grant-reject.json)"
pass "grants blocked in all_indexed"

echo "=== complete onboarding ==="
curl -sf -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/admin/onboarding/complete" >/dev/null
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/admin/org" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (j.onboardingCompleted !== true) { console.error(j); process.exit(1); }
  console.log('ok onboarding completed');
"

echo ""
echo "=== ONBOARDING PEOPLE SMOKE PASS ==="
echo "Admin: $ADMIN_EMAIL / $DEMO_PASSWORD"
echo "Dev:   $DEV_EMAIL / $DEMO_PASSWORD"
echo "Portal: http://localhost:3001/login"
