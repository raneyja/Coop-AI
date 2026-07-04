#!/usr/bin/env bash
# Autocomplete smoke — local Docker API health + inline completion + telemetry.
# After API steps, prints Extension Development Host checklist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API="${COOP_API_BASE:-http://localhost:8787}"
export COOP_API_BASE="$API"

echo "=== autocomplete API smoke ==="
echo "    base: $API"

if ! curl -sf --max-time 3 "$API/health" >/dev/null 2>&1; then
  echo ""
  echo "API not reachable at $API"
  echo ""
  echo "Do this now:"
  echo "  1. Terminal — from repo root: docker compose up -d api"
  echo "  2. Terminal — wait for health: curl -sf $API/health"
  echo "  3. Terminal — re-run: npm run smoke:autocomplete"
  exit 1
fi

npx tsx scripts/autocomplete-smoke-live.mjs

echo ""
echo "=== Extension Development Host (manual) ==="
echo ""
echo "Prereqs:"
echo "  - File — .vscode/settings.json has coopAI.apiBaseUrl: $API"
echo "  - File — .vscode/settings.json has coopAI.autocomplete.enabled: true"
echo "  - Terminal — npm run compile (or F5 launch rebuilds)"
echo ""
echo "1. VS Code — Run > Start Debugging (F5) to open Extension Development Host"
echo "2. Extension UI — open a .ts file, type: const value = "
echo "   Success: gray ghost text appears (not the Suggest dropdown)"
echo "3. Extension UI — press Tab to accept ghost text"
echo "   Success: completion inserts inline"
echo "4. Extension UI — Settings > Coop > Autocomplete status"
echo "   Success: shows ready (not mock mode if using real keys)"
echo "5. Extension UI — type inside a comment // like this"
echo "   Success: no ghost text (privacy filter)"
echo ""
echo "Optional — graph context:"
echo "  - Extension UI — set workspace owner/repo in Coop settings"
echo "  - Browser — admin portal indexes the repo"
echo "  - Extension UI — enable coopAI.autocomplete.useGraphContext"
echo ""
