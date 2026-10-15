#!/usr/bin/env bash
# One migration owner for local, CI and Railway; DATABASE_URL is mandatory.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "${ROOT}/scripts/run-migrations.mjs"
