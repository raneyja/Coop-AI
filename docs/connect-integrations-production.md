# Connect integrations (production quick reference)

For **org admins** and **operators**. Full enterprise motion: [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md).

Production mode: `coopAI.devMode: false`. Tokens live on the **Coop server**, not in VS Code.

**Callback base (production):** `https://api.coopai.dev/v1/{provider}/app/callback`

---

## Org admin (5-minute checklist)

**Extension UI** — Coop AI → **Settings**

| # | Step | Success |
|---|------|---------|
| 1 | **Account** → sign in (SSO or org API key) → **Test connection** | Connected |
| 2 | **Connections → GitHub** → **Connect** → browser → **Refresh** → **Test** | Connected |
| 3 | **Connections → Slack** → same pattern | Connected |
| 4 | **Connections → Jira** → same + set **Jira site URL** | Connected |
| 5 | **Connections → Confluence** → same + set **Confluence site URL** | Connected |
| 6 | **Connections → Notion** → same | Connected |
| 7 | **Connections → Google Docs** → same | Connected |
| 8 | **Workspace** → owner / repo / branch | Saved |

**Teams:** Coming soon in Settings UI.

---

## Platform operator (server env)

Add to **File** — `.env.backend` on the API host (see [`.env.backend.example`](../.env.backend.example)):

| Provider | Variables |
|----------|-----------|
| Core | `CREDENTIALS_ENCRYPTION_KEY`, `WEBHOOK_DOMAIN` or `COOP_PUBLIC_BASE_URL` |
| GitHub App | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` |
| Slack | `SLACK_APP_CLIENT_ID`, `SLACK_APP_CLIENT_SECRET` |
| Atlassian | `ATLASSIAN_APP_CLIENT_ID`, `ATLASSIAN_APP_CLIENT_SECRET` |
| Notion | `NOTION_APP_CLIENT_ID`, `NOTION_APP_CLIENT_SECRET` |
| Google Docs | `GOOGLE_DOCS_APP_CLIENT_ID`, `GOOGLE_DOCS_APP_CLIENT_SECRET` |
| Teams (when enabled) | `TEAMS_APP_CLIENT_ID`, `TEAMS_APP_CLIENT_SECRET` |

**Terminal** — after saving:

```bash
docker compose up -d --build api
```

---

## Operator registration links

| Tool | Console | Redirect URI |
|------|---------|--------------|
| GitHub | [github.com/settings/apps](https://github.com/settings/apps) or OAuth Apps | `/v1/github/app/callback` |
| Slack | [api.slack.com/apps](https://api.slack.com/apps) | `/v1/slack/app/callback` |
| Atlassian | [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/) | `/v1/atlassian/app/callback` |
| Notion | [notion.so/my-integrations](https://www.notion.so/my-integrations) — type **OAuth** | `/v1/notion/app/callback` |
| Google | [console.cloud.google.com](https://console.cloud.google.com) — OAuth Web client | `/v1/google-docs/app/callback` |
| Teams | [portal.azure.com](https://portal.azure.com) — App registrations | `/v1/teams/app/callback` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 503 / not configured on server | Operator: env vars + API restart |
| 403 admin required | User must be org **owner** or **admin**, or use org API key auth |
| Redirect URI mismatch | Operator: callback URL must match exactly in vendor console |
| Google insufficient scopes | Revoke app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), re-Connect |
| Notion / Google paste warnings | Remove unusual line terminators in `.env.backend` after copy-paste |
| Search returns empty | Set **Workspace** repo; ensure docs/messages mention `github:owner/repo` |
| Slack "Invalid permissions requested" | In [api.slack.com/apps](https://api.slack.com/apps) → **OAuth & Permissions**: add `search:read`, `channels:history`, `groups:history` under **User Token Scopes** (not Bot). Reinstall app to workspace, then Connect again. |
