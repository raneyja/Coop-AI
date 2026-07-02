#!/usr/bin/env bash
# Start admin portal for local repo-access / integration testing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_DIR="$ROOT/admin"
ENV_FILE="$ADMIN_DIR/.env.local"
EXAMPLE="$ADMIN_DIR/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE from .env.example"
  cp "$EXAMPLE" "$ENV_FILE"
fi

cd "$ADMIN_DIR"
if [[ ! -d node_modules ]]; then
  echo "Installing admin dependencies…"
  npm install
fi

echo ""
echo "Admin portal → http://localhost:3001"
echo "API base     → http://localhost:8787"
echo ""
echo "Demo org (after seed):"
echo "  npm run seed:repo-access-demo"
echo "  Admin: repo-access-admin@demo.local / DemoPassword12!"
echo ""

npm run dev
