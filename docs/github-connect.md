# Connect GitHub (production mode)

In production (`coopAI.devMode: false`), GitHub connects through the browser — not a pasted PAT in VS Code.

Coop supports **two server-side options** (configure one in `.env.backend`):

| Mode | Env vars | Best for |
|------|----------|----------|
| **GitHub OAuth App** | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Local dev, small teams |
| **GitHub App** | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` | Production / org-wide install |

If both are set, **GitHub App** takes precedence for the install URL. OAuth and App can coexist on the same deployment — Pro orgs may connect via OAuth while Enterprise orgs install the GitHub App.

## Quick start — GitHub OAuth App (local)

1. **Create an OAuth App** at [github.com/settings/developers](https://github.com/settings/developers) → OAuth Apps → New OAuth App.

   | Field | Value |
   |-------|--------|
   | Application name | Coop AI (local) |
   | Homepage URL | `http://localhost:8787` |
   | Authorization callback URL | `http://localhost:8787/v1/github/app/callback` |

2. **Add to `.env.backend`:**

   ```env
   GITHUB_OAUTH_CLIENT_ID=Ov23...
   GITHUB_OAUTH_CLIENT_SECRET=...
   WEBHOOK_DOMAIN=http://localhost:8787
   CREDENTIALS_ENCRYPTION_KEY=<long random string>
   ```

3. **Restart the API:**

   ```bash
   docker compose up -d --build api
   ```

4. **In the extension** (Extension Host, `coopAI.devMode: false`):

   - **Account** → save your Coop org API key → Test connection
   - **Tools → GitHub** → **Connect GitHub**
   - Approve in the browser → return to VS Code → **Refresh status** / **Test GitHub**

Tokens are stored on the Coop server for your org — not in VS Code Secret Storage.

## GitHub App (production)

For org-wide installation (recommended for hosted Coop):

### 1. Browser — Create the app

[github.com/settings/apps/new](https://github.com/settings/apps/new)

| Field | Value |
|-------|--------|
| GitHub App name | **CoopAI for VS Code** (display name in GitHub UI) |
| Homepage URL | `https://coop-ai.dev` |
| **Setup URL** (post-install redirect) | `https://api.coop-ai.dev/v1/github/app/callback` |
| Callback URL | Leave **empty** |
| **Request user authorization (OAuth) during installation** | **Unchecked** |
| **Expire user authorization tokens** | **Unchecked** (only applies if OAuth during install is on — Coop does not use it) |
| Where can this app be installed? | **Any account** (set at create time; see below to change later) |

Local testing: use `http://localhost:8787/v1/github/app/callback` for Setup URL instead.

### 2. Browser — Repository permissions (Read-only only)

| Permission | Access |
|------------|--------|
| **Contents** | Read-only |
| **Metadata** | Read-only |
| **Pull requests** | Read-only |
| **Issues** | Read-only |
| Everything else | **No access** |

**Organization permissions** and **Account permissions** — leave **all** at **No access**.

### 3. Browser — Webhook (recommended)

| Field | Value |
|-------|--------|
| Active | Checked |
| Webhook URL | `https://api.coop-ai.dev/webhooks/github` |
| Secret | `baileythedog123098654` |

Subscribe to events: **Installation**, **Installation repositories**, **Push**, **Pull request**, **Pull request review**, **Issues**, **Repository**.

### 4. Browser — After create

1. Note **App ID** (numeric) and **slug** from `github.com/apps/{slug}`. Production slug is still **`coopai-for-vs-code`** even if the display name is **CoopAI for VS Code** — `GITHUB_APP_SLUG` must match the slug, not the display name.
2. **Private keys** → Generate → download `.pem` to **Downloads** (e.g. `coopai-for-vs-code.2026-07-04.private-key.pem`). GitHub shows only a **SHA256 fingerprint** on the settings page — that is **not** the key; open the downloaded file in TextEdit or VS Code.
3. **Install App** → choose org → select repos (or all) → Install.

### 5. Railway — API variables (production)

**Browser** — Railway → **Coop-AI** service → **Variables**:

| Variable | Value |
|----------|--------|
| `GITHUB_APP_ID` | `4216192` |
| `GITHUB_APP_SLUG` | `coopai-for-vs-code` |
| `GITHUB_APP_PRIVATE_KEY` | Full PEM from Downloads file **or** base64-encode: `base64 -i ~/Downloads/coopai-for-vs-code*.pem \| tr -d '\n'` |
| `GITHUB_WEBHOOK_SECRET` | `baileythedog123098654` (must match GitHub webhook secret exactly) |
| `COOP_PUBLIC_BASE_URL` | `https://api.coop-ai.dev` |

**Remove or clear** on Railway (production must not use OAuth):

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`

Redeploy **Coop-AI** after saving.

**Success looks like:** Admin → Integrations → Connect opens `github.com/apps/{slug}/installations/…` (not `login/oauth/authorize?client_id=Ov23…`).

### 6. Local `.env.backend` (optional)

Same App vars + `GITHUB_WEBHOOK_SECRET=baileythedog123098654` if testing webhooks locally; keep OAuth vars for local-only Connect if you prefer.

## Coop admin vs GitHub org owner (production)

Company repos live under a **GitHub Organization**. Installing the Coop GitHub App requires a **GitHub org owner** (or someone with app-install permission) — not every Coop admin has that access.

| Role | Action |
|------|--------|
| **Coop org admin** | Admin portal → Integrations → GitHub → **Send link to GitHub admin** (or Connect if they are also the GitHub org owner) |
| **GitHub org owner / IT** | Opens the link → installs on the **company org** → selects repositories |
| **Developers** | Sign in to Coop only — they use the admin’s cloud index; they do not re-index |

The admin portal shows **Waiting for GitHub install** until the callback completes, then **Connected**.

### OAuth fallback (limited)

If the GitHub org owner cannot install the App, Coop admins can use **Limited connect (OAuth)** in the admin portal when `GITHUB_OAUTH_*` is configured on the server.

- Indexes repos the **connecting user** can read (owner, collaborator, org member)
- Does **not** provide full org estate indexing
- Tokens may need reconnect more often than GitHub App — use for small teams only

Install URL API: `GET /v1/github/app/install-url?mode=oauth` (default `auto` prefers GitHub App).

## Auto-relink (app already on GitHub)

If the GitHub App is **already installed** on your org but Coop shows **Not connected** (e.g. you opened GitHub’s install page without Coop’s signed `state`):

1. **Browser** — Admin portal → Integrations → **Connect (GitHub App)** again.
2. Coop stores an install hint and may **relink automatically** when you open Integrations — no GitHub login required if the installation still exists.
3. If a GitHub tab opens, click **Save** on the existing installation, then return to admin and **Refresh**.

**Success looks like:** Status moves to **Connected**; message may say “GitHub reconnected automatically.”

Org-wide testing flow: [github-org-testing.md](./github-org-testing.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| “GitHub is not configured on the Coop server” | Add OAuth or App creds to `.env.backend` and restart API |
| “Invalid or expired install state” | Start Connect from admin portal (or **Send link to GitHub admin**) — do not bookmark GitHub’s install URL alone |
| App installed on GitHub but Coop not connected | **Connect (GitHub App)** again → Save on GitHub → Refresh (see **Auto-relink** above) |
| **Connected** but org repo missing in Configure GitHub | Check `github.com/organizations/ORG/settings/installations` — if **no apps listed**, the App was never installed on the org (Coop may be linked to personal). Install on org, uninstall from personal, Disconnect → Connect in admin. |
| Configure GitHub shows only `yourusername/*` repos | Coop is linked to a **personal** App install — uninstall on personal GitHub, install/configure on **company org**, reconnect in admin |
| **Install App** lists only personal account (no org) | **Browser** — [github.com/settings/apps/coopai-for-vs-code](https://github.com/settings/apps/coopai-for-vs-code) → **Advanced** → **Danger zone** → **Make public** → Save. Then **Install App** (left sidebar) → **CoopAI-Corp**. (GitHub no longer shows “Where can this GitHub App be installed?” on **General** after create — visibility is **Advanced** → public/private.) |
| `GITHUB_APP_PRIVATE_KEY` rejected after paste | GitHub downloads **RSA PEM** (`BEGIN RSA PRIVATE KEY`) or PKCS#8 (`BEGIN PRIVATE KEY`) — paste the full downloaded file; base64-encoding the PEM is also supported |
| “Sign in to Coop first” | Save org API key under **Account** (extension) or sign in to admin portal |
| Connect opens browser but callback fails | Setup URL must exactly match GitHub App settings (`/v1/github/app/callback`) |
| Still see PAT field | Workspace `coopAI.devMode` is still `true` — disable under **Workspace** settings |

### Collaborators and teams ≠ GitHub App access

Repo **Settings → Collaborators and teams** controls which **people** can access the repository. Coop does not use that page.

Coop reads repos granted to the **GitHub App installation** on your **organization**:

1. **Browser** — `github.com/organizations/YOUR-ORG/settings/installations`
2. **CoopAI for VS Code** (or your app slug) → **Configure**
3. **Repository access** → **All repositories** or select specific repos → **Save**

Private org repos with “0 collaborators” can still appear in Coop once the App installation includes them.

## Coop API key vs GitHub

- **Coop API key** — identifies your org to the Coop backend only.
- **Connect GitHub** — authorizes GitHub; stores GitHub tokens on the server.

Both are required in production mode.
