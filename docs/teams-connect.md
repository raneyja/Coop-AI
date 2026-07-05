# Connect Microsoft Teams (production mode)

Coop searches **Teams channel messages** via **Microsoft Graph OAuth**. This is an **Entra (Azure AD) app registration** — not a Teams Store app or bot manifest.

Requires **work or school Microsoft 365** with Teams channels. Personal Microsoft accounts and Teams Community are not supported for channel search.

**Production callback:** `https://api.coop-ai.dev/v1/teams/app/callback`  
**Local dev callback:** `http://localhost:8787/v1/teams/app/callback`

---

## Operator — Azure app registration

### 1. Browser — [Microsoft Entra admin center](https://entra.microsoft.com/) → Identity → Applications → **App registrations** → **New registration**

| Field | Value |
|-------|--------|
| Name | `Coop AI` (or your product name) |
| Supported account types | **Accounts in any organizational directory (Multitenant)** |
| Redirect URI — platform | **Web** |
| Redirect URI — URL (production) | `https://api.coop-ai.dev/v1/teams/app/callback` |

Click **Register**.

**Success:** Overview page shows **Application (client) ID** — copy this for `TEAMS_APP_CLIENT_ID`.

### 2. Browser — same app → **Authentication**

Under **Web** redirect URIs, also add (if you dev locally):

```
http://localhost:8787/v1/teams/app/callback
```

| Setting | Value |
|---------|--------|
| **Allow public client flows** | No |
| **Supported account types** | Multitenant (same as registration) |

Save.

### 3. Browser — **Certificates & secrets** → **New client secret**

| Field | Value |
|-------|--------|
| Description | `Coop API production` |
| Expires | 24 months (set a calendar reminder) |

Copy the **Value** immediately — shown once. This is `TEAMS_APP_CLIENT_SECRET`.

### 4. Browser — **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**

Add exactly these (must match `teamsAppService.ts`):

| Permission | Purpose |
|------------|---------|
| `User.Read` | Sign-in profile |
| `Team.ReadBasic.All` | List teams the user can access |
| `ChannelMessage.Read.All` | Read channel messages for search |
| `offline_access` | Refresh tokens |

Click **Add permissions**.

Then **Grant admin consent for {your tenant}** (operator tenant). Customer tenants may also require their IT admin to consent on first Connect.

**Note:** `ChannelMessage.Read.All` is admin-consent in most orgs. Org admins connecting from [admin.coop-ai.dev/integrations](https://admin.coop-ai.dev/integrations) need sufficient Entra role, or IT must pre-consent the app.

---

## Operator — server env

### File — `.env.backend` (local) or Railway → **Coop-AI** → **Variables** (production)

```env
TEAMS_APP_CLIENT_ID=<Application (client) ID from Azure>
TEAMS_APP_CLIENT_SECRET=<client secret Value>
WEBHOOK_DOMAIN=https://api.coop-ai.dev
COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev
COOP_ADMIN_PORTAL_URL=https://admin.coop-ai.dev
```

Local dev: use `http://localhost:8787` for `WEBHOOK_DOMAIN` / `COOP_PUBLIC_BASE_URL`.

### Terminal — restart API after saving

```bash
docker compose up -d --build api
```

**Success:** `GET /v1/teams/app/install-url` returns `{ "url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?..." }` (not 503).

---

## Org admin — connect

**Browser** — [admin.coop-ai.dev/integrations](https://admin.coop-ai.dev/integrations)

1. **Microsoft Teams** → **Connect**
2. Sign in with work/school account → approve permissions (admin consent if prompted)
3. Return to Integrations → **Refresh** → **Test Teams**

**Extension UI** (optional): **Settings → Tools → Microsoft Teams** → **Connect** (same OAuth flow).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `AADSTS700016` — application identifier `jVw8Q~…` not found | **`TEAMS_APP_CLIENT_ID` is set to the client secret.** Azure Entra → App registrations → **Overview** → copy **Application (client) ID** (UUID) into `TEAMS_APP_CLIENT_ID`. Put the secret **Value** (contains `~`) in `TEAMS_APP_CLIENT_SECRET` only. Redeploy API. |
| 503 / not configured on server | Set `TEAMS_APP_CLIENT_ID` and `TEAMS_APP_CLIENT_SECRET`; redeploy API |
| `redirect_uri` mismatch | Azure → Authentication → Web redirect URI must match exactly (`https://api.coop-ai.dev/v1/teams/app/callback`) |
| `AADSTS50011` redirect URI error | Same as above — check trailing slash and `http` vs `https` |
| Admin consent required | Entra admin must grant consent for Graph permissions, or use [admin consent URL](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent) for your app |
| Connected but search empty | User must have access to Teams channels; personal Teams has no channel search |
| Token exchange failed | Client secret expired or wrong; create new secret in Azure |
| `invalid_client` | Client ID/secret mismatch — re-copy from Azure Overview + Certificates & secrets |

---

## What Coop does *not* need

| Not required | Why |
|--------------|-----|
| Teams App manifest (`.zip`) | Coop uses Graph REST, not a Teams tab/bot |
| Teams Admin Center app upload | No in-Teams UI |
| Azure Bot Service | No bot messaging |
| Application (not delegated) Graph permissions | OAuth uses delegated user token |

---

## Related docs

- [connect-integrations-production.md](./connect-integrations-production.md) — all integration callbacks
- [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md) — customer admin motion
