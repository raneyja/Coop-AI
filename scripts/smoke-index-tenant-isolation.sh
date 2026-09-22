#!/usr/bin/env bash
# Cross-org probes that must fail closed when api + postgres are up.
# Does not require the worker or Zoekt. Steps 5–7 (shared public slug index)
# need a running worker and are not part of this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
API="${COOP_API_URL:-http://localhost:8787}"

docker compose cp dist/admin-org.js api:/app/dist/admin-org.js >/dev/null

create_org() {
  local name="$1"
  docker compose exec -T api node dist/admin-org.js create-org "$name" pro
}

ORG_A_JSON="$(create_org "Isolation Org A")"
ORG_B_JSON="$(create_org "Isolation Org B")"
ORG_A="$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.id)" "$ORG_A_JSON")"
ORG_B="$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.id)" "$ORG_B_JSON")"

KEY_A_JSON="$(docker compose exec -T api node dist/admin-org.js create-api-key "$ORG_A" isolation-a)"
KEY_B_JSON="$(docker compose exec -T api node dist/admin-org.js create-api-key "$ORG_B" isolation-b)"
TOKEN_A="$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.rawKey)" "$KEY_A_JSON")"
TOKEN_B="$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.rawKey)" "$KEY_B_JSON")"

SLUG="github:acme/secret-isolation"

echo "=== 1) Org A creates a job ==="
JOB_JSON="$(curl -sf -X POST -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d "{\"type\":\"generate_repo_summary\",\"params\":{\"orgId\":\"$ORG_A\",\"repoId\":\"$SLUG\"}}" \
  "$API/api/jobs")"
JOB_ID="$(node -e "const j=JSON.parse(process.argv[1]); if(!j.jobId) process.exit(1); process.stdout.write(j.jobId)" "$JOB_JSON")"
echo "ok job $JOB_ID"

echo "=== 2) Org B GET job is 404 ==="
HTTP_JOB="$(curl -s -o /tmp/iso-job.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN_B" \
  "$API/api/jobs/$JOB_ID")"
node -e "
  const fs=require('fs');
  const body=fs.readFileSync('/tmp/iso-job.json','utf8');
  if (process.argv[1] !== '404') { console.error(process.argv[1], body); process.exit(1); }
  if (body.includes(process.argv[2]) || body.includes('secret-isolation')) {
    console.error('job body leaked', body); process.exit(1);
  }
  console.log('ok 404');
" "$HTTP_JOB" "$ORG_A"

echo "=== 3) Org B graph search is 404 ==="
HTTP_GRAPH="$(curl -s -o /tmp/iso-graph.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN_B" \
  "$API/graph/$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SLUG")/search?pattern=x")"
node -e "
  const fs=require('fs');
  const body=fs.readFileSync('/tmp/iso-graph.json','utf8');
  if (process.argv[1] !== '404') { console.error(process.argv[1], body); process.exit(1); }
  console.log('ok graph', process.argv[1]);
" "$HTTP_GRAPH"

echo "=== 4) Org B inventory does not return Org A stats ==="
docker compose exec -T postgres psql -U coop -d coopai -v ON_ERROR_STOP=1 -c \
  "INSERT INTO org_repos (org_id, repo_id, lightning_enabled, index_status, updated_at)
   VALUES ('$ORG_A', '$SLUG', true, 'ready', NOW())
   ON CONFLICT (org_id, repo_id) DO UPDATE SET lightning_enabled=true, index_status='ready';
   INSERT INTO repo_stats (org_id, repo_id, file_count, line_count, byte_count, languages, indexed_at)
   VALUES ('$ORG_A', '$SLUG', 9, 100, 1000, '[]'::jsonb, NOW())
   ON CONFLICT (org_id, repo_id) DO UPDATE SET file_count=9;"

HTTP_INV="$(curl -s -o /tmp/iso-inv.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN_B" \
  "$API/v1/orgs/repos/$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SLUG")/inventory")"
node -e "
  const fs=require('fs');
  const code=process.argv[1];
  const body=fs.readFileSync('/tmp/iso-inv.json','utf8');
  if (code !== '404') { console.error(code, body); process.exit(1); }
  if (body.includes('\"fileCount\":9') || body.includes('index-stats')) {
    console.error('stats leaked', body); process.exit(1);
  }
  console.log('ok inventory', code);
" "$HTTP_INV"

echo "=== SMOKE ISOLATION PASS (worker/Zoekt shared-slug steps not run) ==="
