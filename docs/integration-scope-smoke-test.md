# Integration scope smoke test

Manual checklist for admin-controlled Slack channel scoping on Enterprise orgs.

**Prerequisites**

| Requirement | Notes |
|-------------|--------|
| API + Postgres | `docker compose up -d --build api postgres` |
| Migration 018 | `npm run migrate` (creates `org_integration_policies`) |
| Slack OAuth env | `SLACK_APP_CLIENT_ID`, `SLACK_APP_CLIENT_SECRET` in `.env.backend` |
| Enterprise org | Org `plan = enterprise` with admin API key |
| Admin portal | `./scripts/dev-admin-portal.sh` → http://localhost:3002 |

---

## 1. Connect Slack

**Browser / Extension UI**

1. Sign in to admin portal with org admin API key.
2. Open **Integrations** → **Connect** on Slack.
3. Approve OAuth in Slack → return and **Refresh**.

**Success:** Slack row shows **Connected** (Enterprise may show **Scope required**).

---

## 2. Manage access → select channels → save

**Admin portal → Integrations → Slack**

1. Click **Manage access**.
2. Search/browse channels → check one or more.
3. Click **Save scope**.

**Success:** Summary shows e.g. `2 channels selected`; badge moves to **Active**.

---

## 3. Test scoped access

**Admin portal → Integrations → Slack → Manage access**

1. Click **Test**.

**Success:** Message like `Scoped Slack search succeeded (N recent hit(s) in allowlisted channels…)`.

**Only if blocked:** Enterprise org with zero channels selected → Test reports scope required.

---

## 4. Enterprise org without scope gets no Slack context

**Extension UI** (production mode, same Enterprise org)

1. Connect account with org API key.
2. Do **not** configure Slack scope (or clear all channels and save).
3. Run chat query that would fetch Slack, e.g. *any slack threads about this repo?*

**Success:** No Slack messages in context; error hint about admin configuring scope.

**With scope configured:** Same query returns hits only from allowlisted channels.

---

## 5. API spot checks (optional)

**Terminal** (replace `coop_…` and API base):

```bash
# Scope status
curl -s -H "Authorization: Bearer coop_YOUR_KEY" \
  https://api.coop-ai.dev/v1/admin/integrations/slack/scope | jq

# Channel picker
curl -s -H "Authorization: Bearer coop_YOUR_KEY" \
  "https://api.coop-ai.dev/v1/admin/integrations/slack/resources?q=eng" | jq

# Extension enforcement payload
curl -s -H "Authorization: Bearer coop_YOUR_KEY" \
  "https://api.coop-ai.dev/v1/orgs/integrations/scope?provider=slack" | jq
```

---

## 6. Audit

**Admin portal → Audit** (or `GET /v1/admin/audit`)

**Success:** `admin.integration.scope.updated` entry after saving scope, with `channelCount` metadata.

---

## Known limitations (Phase B)

- Scope enforcement is **Slack-only**; Jira/Confluence/Notion/Google show "coming soon" in admin UI.
- **Enterprise plan only** for default-deny; Pro/Free orgs behave as before (no scope gate).
- Existing Slack connections need **reconnect** once to store bot token for channel listing.
- Channel picker requires bot `channels:read`; search enforcement uses user `search:read` + `in:channel` filters.
