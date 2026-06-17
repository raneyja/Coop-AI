#!/usr/bin/env bash
# Build Railway Raw Editor env block from .env.backend + production overrides.
# Secrets stay on your Mac — output goes to clipboard only (not printed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.backend"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

SKIP_KEYS='^(PORT|DATABASE_URL|ZOEKT_URL|ZOEKT_INDEX_PATH)$'
LOCALHOST='localhost'

emit() {
  local key="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    return
  fi
  if [[ "$value" == *"$LOCALHOST"* ]]; then
    return
  fi
  printf '%s=%s\n' "$key" "$value"
}

{
  emit NODE_ENV "production"
  emit COOP_REQUIRE_API_AUTH "true"
  emit COOP_DEV_MODE "false"
  emit JOBS_WORKERS "0"
  emit JOBS_BACKEND "postgres"
  emit GRAPH_CACHE_BACKEND "postgres"

  emit COOP_PUBLIC_BASE_URL "https://api.coop-ai.dev"
  emit WEBHOOK_DOMAIN "https://api.coop-ai.dev"
  emit COOP_CORS_ORIGINS "https://admin.coop-ai.dev,https://coop-ai.dev"
  emit COOP_ADMIN_PORTAL_URL "https://admin.coop-ai.dev"
  emit COOP_MARKETING_BASE_URL "https://coop-ai.dev"
  emit COOP_CHECKOUT_SUCCESS_URL "https://coop-ai.dev/welcome"
  emit COOP_CHECKOUT_CANCEL_URL "https://coop-ai.dev/pricing"
  emit EMAIL_FROM "${EMAIL_FROM:-hello@coop-ai.dev}"
  emit COOP_EMAIL_MOCK "false"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$line" || "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/^"\(.*\)"$/\1/' | sed "s/^'\(.*\)'$/\1/")"
    if [[ "$key" =~ $SKIP_KEYS ]]; then
      continue
    fi
    case "$key" in
      NODE_ENV|COOP_REQUIRE_API_AUTH|COOP_DEV_MODE|WEBHOOK_DOMAIN|COOP_PUBLIC_BASE_URL|COOP_CORS_ORIGINS|COOP_ADMIN_PORTAL_URL|COOP_MARKETING_BASE_URL|COOP_CHECKOUT_SUCCESS_URL|COOP_CHECKOUT_CANCEL_URL|EMAIL_FROM|COOP_EMAIL_MOCK|JOBS_WORKERS|JOBS_BACKEND|GRAPH_CACHE_BACKEND)
        continue
        ;;
    esac
    emit "$key" "$value"
  done < "$ENV_FILE"

  if [[ -n "${CREDENTIALS_ENCRYPTION_KEY:-}" && "$CREDENTIALS_ENCRYPTION_KEY" != "change-me-to-a-long-random-secret" ]]; then
    emit CREDENTIALS_ENCRYPTION_KEY "$CREDENTIALS_ENCRYPTION_KEY"
  fi
} | pbcopy

count="$(pbpaste | grep -c '=' || true)"
echo "Copied ${count} variables to clipboard."
echo "Do not paste this terminal session into chat."
echo ""
echo "Next: Railway → Coop-AI → Variables → Raw Editor → paste → Update Variables"
echo "Keep existing DATABASE_URL = \${{Postgres.DATABASE_URL}} (do not overwrite in Raw Editor)."
