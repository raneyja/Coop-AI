#!/usr/bin/env bash
# Smoke: Deep-Index enable → Ready → inventory → search → file fetch on a non–Coop-AI fixture.
# Requires: local API on :8787, worker, org admin key, and SMOKE_REPO_ID (default: a small public fixture).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_BASE="${SMOKE_API_BASE:-http://localhost:8787}"
REPO_ID="${SMOKE_REPO_ID:-github:octocat/Hello-World}"
FILE_PATH="${SMOKE_FILE_PATH:-README}"
PATTERN="${SMOKE_SEARCH_PATTERN:-Hello}"
TOKEN="${SMOKE_ORG_TOKEN:-}"
POLL_SECONDS="${SMOKE_POLL_SECONDS:-180}"

if [[ -z "$TOKEN" ]]; then
  echo "Do this now:"
  echo "1) Terminal — create an org API key (rawKey), export it:"
  echo "   export SMOKE_ORG_TOKEN='coop_…'"
  echo "2) Terminal — optionally set SMOKE_REPO_ID (must NOT be Coop-AI), then re-run:"
  echo "   ./scripts/smoke-deep-index-remote.sh"
  exit 1
fi

if [[ "$REPO_ID" == *"Coop"* ]] || [[ "$REPO_ID" == *"coop-ai"* ]]; then
  echo "FAIL: smoke must use a non–Coop-AI fixture. Got REPO_ID=$REPO_ID"
  exit 1
fi

ENC_REPO="$(node -pe "encodeURIComponent(process.argv[1])" "$REPO_ID")"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

echo "=== health ==="
curl -sf "$API_BASE/health" >/dev/null
echo "ok"

echo "=== enable Deep-Index (force) ==="
ENABLE_BODY="$(curl -sS -X POST "${AUTH[@]}" \
  "$API_BASE/v1/orgs/repos/${ENC_REPO}/lightning/enable" \
  -d '{}')"
JOB_ID="$(node -pe "const j=JSON.parse(process.argv[1]); if(!j.jobId){console.error(j); process.exit(1)}; j.jobId" "$ENABLE_BODY")"
echo "queued jobId=$JOB_ID"

echo "=== poll Ready (up to ${POLL_SECONDS}s) ==="
DEADLINE=$((SECONDS + POLL_SECONDS))
STATUS=""
while (( SECONDS < DEADLINE )); do
  STATUS_JSON="$(curl -sS "${AUTH[@]}" "$API_BASE/v1/orgs/repos/${ENC_REPO}/lightning/status")"
  STATUS="$(node -pe "JSON.parse(process.argv[1]).repo?.indexStatus ?? ''" "$STATUS_JSON")"
  echo "  status=$STATUS"
  if [[ "$STATUS" == "ready" ]]; then
    break
  fi
  if [[ "$STATUS" == "error" || "$STATUS" == "failed" ]]; then
    echo "FAIL: indexStatus=$STATUS"
    echo "$STATUS_JSON"
    exit 1
  fi
  sleep 5
done
if [[ "$STATUS" != "ready" ]]; then
  echo "FAIL: timed out waiting for Ready (last=$STATUS)"
  exit 1
fi
echo "ok Ready"

echo "=== inventory source=index-stats ==="
INV="$(curl -sS "${AUTH[@]}" "$API_BASE/v1/orgs/repos/${ENC_REPO}/inventory")"
node -e '
  const j=JSON.parse(process.argv[1]);
  if (j.source !== "index-stats" || !(j.fileCount > 0)) {
    console.error(j);
    process.exit(1);
  }
  console.log("ok", JSON.stringify({ source: j.source, fileCount: j.fileCount }));
' "$INV"

echo "=== graph search non-empty ==="
SEARCH="$(curl -sS "${AUTH[@]}" \
  "$API_BASE/graph/${ENC_REPO}/search?pattern=$(node -pe "encodeURIComponent(process.argv[1])" "$PATTERN")")"
node -e '
  const j=JSON.parse(process.argv[1]);
  const hits = Array.isArray(j.data) ? j.data.length : 0;
  const symbols = Array.isArray(j.symbols) ? j.symbols.length : 0;
  if (hits + symbols === 0) {
    console.error("empty search", j);
    process.exit(1);
  }
  console.log("ok", JSON.stringify({ hits, symbols }));
' "$SEARCH"

echo "=== file fetch content ==="
FILE="$(curl -sS "${AUTH[@]}" \
  "$API_BASE/v1/orgs/repos/${ENC_REPO}/files?path=$(node -pe "encodeURIComponent(process.argv[1])" "$FILE_PATH")")"
node -e '
  const j=JSON.parse(process.argv[1]);
  const content = j.content ?? j.data?.content ?? "";
  if (typeof content !== "string" || content.length === 0) {
    console.error(j);
    process.exit(1);
  }
  console.log("ok contentLength=" + content.length);
' "$FILE"

echo "=== force reindex gets new jobId ==="
ENABLE2="$(curl -sS -X POST "${AUTH[@]}" \
  "$API_BASE/v1/orgs/repos/${ENC_REPO}/lightning/enable" \
  -d '{}')"
JOB2="$(node -pe "const j=JSON.parse(process.argv[1]); if(!j.jobId){console.error(j); process.exit(1)}; j.jobId" "$ENABLE2")"
if [[ "$JOB2" == "$JOB_ID" ]]; then
  echo "FAIL: force reindex reused jobId=$JOB_ID"
  exit 1
fi
echo "ok new jobId=$JOB2 (was $JOB_ID)"

echo "=== SMOKE PASS (remote Deep-Index) ==="
