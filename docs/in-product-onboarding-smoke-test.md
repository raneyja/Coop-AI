# In-product onboarding — smoke test

Manual checklist for admin wizard + extension checklist after [in-product-onboarding-spec.md](./in-product-onboarding-spec.md).

**Prerequisites**

| Requirement | Notes |
|-------------|--------|
| API + Postgres | `docker compose up -d --build api postgres` |
| Slack OAuth env | `SLACK_APP_CLIENT_ID`, `SLACK_APP_CLIENT_SECRET` in `.env.backend` |
| Slack app scopes | Per [slack-connect.md](./slack-connect.md) |
| Enterprise org | Org `plan = enterprise` with admin API key |
| Admin portal | `./scripts/dev-admin-portal.sh` → http://localhost:3002 |

---

## Smoke steps

| Step | Surface | Action | Success |
|------|---------|--------|---------|
| 1 | Terminal | `docker compose up -d --build api postgres` | `curl -s http://localhost:8787/health` → `"ok":true` |
| 2 | Browser — admin portal | Sign in at http://localhost:3002/login | Dashboard loads |
| 3 | Browser — dashboard | First visit with `onboardingCompleted` false | Setup wizard visible (6 steps) |
| 4 | Wizard — Connect | Connect GitHub + Slack inline (OAuth tab → Refresh) | Rows show **Connected** |
| 5 | Wizard — Manage access | Enterprise: **Manage Slack access** → select channels → Save | Badge **Active**; Continue enabled |
| 6 | Wizard — Verify | **Test all** | Connected rows show **Healthy** |
| 7 | Wizard — Done | **Finish setup** | Wizard hides; `GET /v1/admin/org` → `onboardingCompleted: true` |
| 8 | Extension UI | Admin user opens Settings hub | Checklist banner with admin portal links |
| 9 | Extension UI | `coopAI.devMode: false`, developer API key | No Connect buttons; no admin banner |
| 10 | Browser — `/integrations` | Full integrations page | Same Connect/scope behavior as wizard |

---

## API spot checks (optional)

**Terminal** (replace `coop_…`):

```bash
# Integration health
curl -s -H "Authorization: Bearer coop_YOUR_KEY" \
  http://localhost:8787/v1/admin/integrations/health | jq

# Live tests
curl -s -H "Authorization: Bearer coop_YOUR_KEY" \
  "http://localhost:8787/v1/admin/integrations/health?refresh=true" | jq

# Extension /v1/me fields
curl -s -H "Authorization: Bearer coop_YOUR_KEY" \
  http://localhost:8787/v1/me | jq '.onboardingCompleted, .adminPortalUrl, .integrationHealthSummary'
```

---

## Known gaps

- Jira/Notion/Google scope enforcement: UI stubs only (coming soon).
- Teams Connect: coming soon in product UI.
- Inline user invite in wizard: links to `/users` (MVP).
