# Connect GitHub (production mode)

In production (`coopAI.devMode: false`), GitHub connects through the browser — not a pasted PAT in VS Code.

Coop supports **two server-side options** (configure one in `.env.backend`):

| Mode | Env vars | Best for |
|------|----------|----------|
| **GitHub OAuth App** | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Local dev, small teams |
| **GitHub App** | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` | Production / org-wide install |

If both are set, **GitHub App** takes precedence for the install URL.

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

1. Create a GitHub App at [github.com/settings/apps/new](https://github.com/settings/apps/new).
2. Set **Setup URL** (post-install redirect) to:

   ```
   https://api.coop-ai.dev/v1/github/app/callback
   ```

   (Use `http://localhost:8787/v1/github/app/callback` for local testing.)

3. Set repository permissions your deployment needs (Contents: Read, Pull requests: Read, etc.).
4. Add `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_SLUG` to `.env.backend`.
5. Restart the API. **Connect GitHub** opens the GitHub App install flow.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| “GitHub is not configured on the Coop server” | Add OAuth or App creds to `.env.backend` and restart API |
| “Sign in to Coop first” | Save org API key under **Account** |
| Connect opens browser but callback fails | Callback URL must exactly match the OAuth app settings |
| Still see PAT field | Workspace `coopAI.devMode` is still `true` — disable under **Workspace** settings |

## Coop API key vs GitHub

- **Coop API key** — identifies your org to the Coop backend only.
- **Connect GitHub** — authorizes GitHub; stores GitHub tokens on the server.

Both are required in production mode.
