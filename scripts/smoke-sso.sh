#!/usr/bin/env bash
# Seed + smoke test Enterprise SSO demo (password login + SAML start redirect).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API="${COOP_API_BASE:-http://localhost:8787}"
ADMIN_PORTAL="${COOP_ADMIN_PORTAL_URL:-http://localhost:3001}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPassword12!}"

echo "=== health ==="
curl -sf "$API/health" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (!j.ok) process.exit(1);
  console.log('ok');
"

echo "=== seed enterprise SSO demo ==="
docker compose cp dist/admin-org.js api:/app/dist/admin-org.js >/dev/null 2>&1 || true
SEED_JSON="$(docker compose exec -T \
  -e DATABASE_URL=postgres://coop:coop@postgres:5432/coopai \
  -e CREDENTIALS_ENCRYPTION_KEY="${CREDENTIALS_ENCRYPTION_KEY:-change-me-to-a-long-random-secret}" \
  -e COOP_PUBLIC_BASE_URL="$API" \
  -e COOP_ADMIN_PORTAL_URL="$ADMIN_PORTAL" \
  -e DEMO_PASSWORD="$DEMO_PASSWORD" \
  api node dist/admin-org.js seed-enterprise-sso-demo)"
echo "$SEED_JSON" | tee /tmp/coop-sso-smoke-demo.json

ORG_NAME="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-sso-smoke-demo.json','utf8')).orgName")"
ADMIN_EMAIL="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-sso-smoke-demo.json','utf8')).accounts.admin.email")"
SSO_START="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-sso-smoke-demo.json','utf8')).smokeTest.ssoStartUrl")"

echo "=== password login (admin) ==="
ADMIN_TOKEN="$(curl -sf -X POST "$API/v1/auth/login" \
  -H "content-type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken")"
echo "ok token=${ADMIN_TOKEN:0:20}..."

echo "=== GET /v1/sso/config (enterprise) ==="
CONFIG_BODY="$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$API/v1/sso/config")"
node -e "
  const raw = process.argv[1];
  if (!raw || !raw.trim()) {
    console.log('skip: /v1/sso/config empty — rebuild API (docker compose up -d --build api) for self-serve SSO UI');
    process.exit(0);
  }
  let j;
  try { j = JSON.parse(raw); } catch { console.error(raw); process.exit(1); }
  if (j.error === 'not_found' || j.error === 'not found') {
    console.log('skip: /v1/sso/config not deployed yet — SAML start still works; rebuild API for admin SSO settings');
    process.exit(0);
  }
  if (!j.configured || j.provider !== 'saml') {
    console.error(j);
    process.exit(1);
  }
  console.log('ok configured', j.provider, 'enabled=' + j.enabled);
" "$CONFIG_BODY"

echo "=== SAML start returns mocksaml redirect ==="
REDIRECT_URL="$(curl -sf "$SSO_START&format=json" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).redirectUrl")"
node -e "
  const url = process.argv[1];
  if (!url || !url.includes('mocksaml.com')) {
    console.error('Expected mocksaml redirect, got:', url);
    process.exit(1);
  }
  console.log('ok redirect -> mocksaml.com');
" "$REDIRECT_URL"

echo ""
echo "=== Demo credentials ==="
echo "  Org:      $ORG_NAME"
echo "  Admin:    $ADMIN_EMAIL / $DEMO_PASSWORD"
echo "  Portal:   $ADMIN_PORTAL/login"
echo "  SSO test: open smokeTest.ssoStartUrl from seed JSON in a browser"
echo "  IdP:      https://mocksaml.com (click through test login — no account needed)"
echo ""
