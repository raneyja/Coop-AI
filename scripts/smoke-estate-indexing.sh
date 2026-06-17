#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose cp dist/admin-org.js api:/app/dist/admin-org.js >/dev/null

docker compose exec -T api node dist/admin-org.js create-org "Smoke Cap 2" pro > /tmp/coop-smoke-org.json 2>/dev/null
ORG_ID="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-smoke-org.json','utf8')).id")"
docker compose exec -T api node dist/admin-org.js create-api-key "$ORG_ID" smoke2 > /tmp/coop-smoke-key.json 2>/dev/null
TOKEN="$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/coop-smoke-key.json','utf8')).rawKey")"

echo "=== health ==="
curl -sf http://localhost:8787/health | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.ok) process.exit(1); console.log('ok')"

echo "=== /v1/me ==="
curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/me | node -e "
  const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
  if(j.indexedRepoCount!==0||j.indexedRepoLimit!==3||j.canEnableMoreRepos!==true) { console.error(j); process.exit(1); }
  console.log('ok', JSON.stringify({indexedRepoCount:j.indexedRepoCount, indexedRepoLimit:j.indexedRepoLimit}));
"

echo "=== seed r1,r2,r3 in DB (no jobs yet) ==="
docker compose exec -T postgres psql -U coop -d coopai -v ON_ERROR_STOP=1 -c \
  "INSERT INTO org_repos (org_id, repo_id, lightning_enabled, index_status, updated_at)
   VALUES ('$ORG_ID', 'github:acme/r1', true, 'ready', NOW()),
          ('$ORG_ID', 'github:acme/r2', true, 'ready', NOW()),
          ('$ORG_ID', 'github:acme/r3', true, 'ready', NOW())
   ON CONFLICT (org_id, repo_id) DO UPDATE SET lightning_enabled=true, index_status='ready', updated_at=NOW();"

echo "=== /v1/me at cap ==="
curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/me | node -e "
  const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
  if(j.indexedRepoCount!==3||j.canEnableMoreRepos!==false) { console.error(j); process.exit(1); }
  console.log('ok cap', j.indexedRepoCount);
"

echo "=== enable r4 expect 403 ==="
HTTP="$(curl -s -o /tmp/r4.json -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8787/v1/orgs/repos/github%3Aacme%2Fr4/lightning/enable")"
node -e "
  const fs=require('fs');
  const body=JSON.parse(fs.readFileSync('/tmp/r4.json','utf8'));
  if(process.argv[1]!=='403'||body.error!=='repo_limit') { console.error(process.argv[1], body); process.exit(1); }
  console.log('ok 403 repo_limit');
" "$HTTP"

echo "=== re-enable r2 expect 202 ==="
HTTP2="$(curl -s -o /tmp/r2.json -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8787/v1/orgs/repos/github%3Aacme%2Fr2/lightning/enable")"
node -e "
  const fs=require('fs');
  const body=JSON.parse(fs.readFileSync('/tmp/r2.json','utf8'));
  if(process.argv[1]!=='202'||!body.jobId) { console.error(process.argv[1], body); process.exit(1); }
  console.log('ok reindex', body.jobId);
" "$HTTP2"

echo "=== graph scope=indexed ==="
HTTP3="$(curl -s -o /tmp/graph.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8787/graph/github%3Aacme%2Fr1/search?scope=indexed&pattern=main")"
if [[ "$HTTP3" != "200" && "$HTTP3" != "404" ]]; then
  echo "FAIL graph HTTP $HTTP3"
  cat /tmp/graph.json
  exit 1
fi
echo "ok graph HTTP $HTTP3"

echo "=== SMOKE PASS ==="
