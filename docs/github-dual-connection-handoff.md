# GitHub org index + personal account — handoff

**Created:** July 4, 2026  
**Resume:** Validate member workspace flow, then build dual GitHub connection (org App + per-user OAuth).

**Related:**
- [github-org-testing.md](./github-org-testing.md) — org install checklist (you completed most of this)
- [workspace-repos.md](./workspace-repos.md) — two-layer model (org catalog vs user workspace)
- [github-connect.md](./github-connect.md) — Railway vars, App slug `coopai-for-vs-code`
- [deploy-railway-phase2-lightning.md](./deploy-railway-phase2-lightning.md) — **coop-worker** env

**Railway service names:** API service is **Coop-AI** (`api.coop-ai.dev`), not `coop-api`. Worker is **coop-worker**.

---

## Where you left off (July 4)

### Working in production

| Item | Status |
|------|--------|
| GitHub App on **CoopAI-Corp** (`coopai-for-vs-code`, public app) | Connected |
| Admin **Configure GitHub** lists org repos | Yes |
| **coop-worker** env synced from **Coop-AI** (encryption key + `GITHUB_APP_*`) | Done by you |
| `CoopAI-Corp/coop-test-org-widget` Deep-Index | **Ready** (repo was empty — expected) |
| Org install + worker clone auth | Fixed |

### Expected failures (not bugs)

| Repo | Error | Why |
|------|-------|-----|
| `raneyja/repp` | `repository not found` | Personal/private repo; Coop linked to **org** GitHub App install — token cannot see personal repos |
| `raneyja/Coop-AI` | Was **Ready** earlier | Likely **public** — clones without needing install scope |

**Action taken:** Turn off Deep-Index on personal repos you don’t need for org testing (`raneyja/repp`, etc.).

### Product decision (confirmed before sign-off)

Users should:

1. **Use the org cloud index** for company repos (admin indexes once; members pick workspace repos).
2. **Connect personal GitHub separately** for their own repos, editor, and identity — without replacing the org App install.

Today the codebase has **one GitHub connection per Coop org** (`code_host_installations`). Personal + org cannot both drive indexing until we build **dual connection**.

---

## Architecture target

```text
┌─────────────────────────────────────────────────────────────┐
│  ADMIN PORTAL — org GitHub App (CoopAI-Corp)                │
│  → code_host_installations (org-level)                      │
│  → org_repos Deep-Index (cloud)                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  MEMBER — workspace picker (≤3 repos from org catalog)      │
│  → user_workspace_repos                                     │
│  → chat / Coop-Search / folder picker (no re-index)         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  MEMBER — personal GitHub OAuth (extension, NEW)            │
│  → user_code_host_connections (NEW table)                   │
│  → open/browse personal repos, github login for Find Owner  │
│  → optional personal indexing (later; not org catalog)      │
└─────────────────────────────────────────────────────────────┘
```

| Connection | Who | Storage today | Purpose |
|------------|-----|---------------|---------|
| GitHub App | Org admin | `code_host_installations` | Index company repos |
| Workspace repos | Each developer | `user_workspace_repos` | Pick ≤3 indexed org repos |
| Personal GitHub OAuth | Each developer | **Not built** | Personal repos + identity |

**Do not** mix personal repos into admin **Indexing** via the org install token. Index jobs must resolve tokens by repo scope: org repos → org install; user repos → user OAuth.

---

## Build order for tomorrow

### Phase A — You (30–60 min): close the org loop

Prove members consume admin index without personal GitHub.

1. **Browser** — [admin.coop-ai.dev/users](https://admin.coop-ai.dev/users) → **Invite** a second user (or use local `seed-repo-access-demo` if testing locally).
2. **Browser** — Sign in as that user → **Workspace → Choose workspace repos** → select up to 3 **CoopAI-Corp/** repos that show **Ready**.
3. **Extension UI** — Sign in with that user → chat / folder picker / Coop-Search on those repos.

**Success looks like:** Member searches indexed org code; they did **not** connect GitHub or trigger re-index.

4. **Browser** — Add a few files to `coop-test-org-widget` on GitHub → admin **Reindex** → confirm search finds new content.

**Doc:** [github-org-testing.md § Part E](./github-org-testing.md)

---

### Phase B — Agents: dual GitHub connection (main build)

#### B1 — Schema + API

| Task | Notes |
|------|--------|
| Migration `user_code_host_connections` | `user_id`, `org_id`, `provider`, encrypted tokens, `github_login`, `connected_at` |
| `GET/DELETE /v1/me/code-hosts/github` | Status for extension |
| OAuth callback variant | `state` binds to `userId` + `orgId`, not org-only install |
| Token resolver for jobs | `resolveCodeHostTokenForOrg` for org repos; new `resolveCodeHostTokenForUser` for user-scoped clone |

**Key files today:**
- `src/server/codeHostCredentialResolver.ts`
- `src/server/githubAppApi.ts` (org OAuth callback pattern to mirror)
- `src/server/codeHostConnectors/routingGithubConnector.ts`
- `migrations/006_code_host_installations.sql` (org pattern reference)

#### B2 — Extension UX

| Task | Notes |
|------|--------|
| Settings → GitHub | Split copy: org index (server/admin) vs **Connect your GitHub** (personal OAuth) |
| Production path | Keep org message; add personal connect button → browser OAuth → return to VS Code |
| `SettingsDetailViews.tsx` `GitHubDetail` | Today prod only shows org-level “Connect GitHub App” |

**Reference:** `src/webview/components/settings/SettingsDetailViews.tsx` (`cloudPath = !prefs.devMode`)

#### B3 — Indexing policy (v1 minimal)

| Rule | Behavior |
|------|----------|
| Admin Indexing page | Org install catalog only (`listInstallationRepositoryCatalog`) |
| Personal repos | Not listed on admin Indexing unless explicit “user scope” product later |
| Clone in worker | Org `repoId` → org token; user-owned index jobs → user token (Phase B3 can follow B1/B2) |

#### B4 — Hardening (partially done locally, not deployed)

| Task | File |
|------|------|
| Redact tokens from job errors | `src/jobs/errorHandling.ts` — `redactSecretsFromErrorMessage` |
| Friendlier “repository not found” | `src/jobs/executors.ts` |
| Worker startup warnings if missing `GITHUB_APP_*` / encryption key | `src/jobs/workerEntry.ts` |

Run: `npm run test:error-handling`

---

## Copy-paste prompt for tomorrow’s Cursor chat

```text
Read docs/github-dual-connection-handoff.md and implement Phase B (dual GitHub connection).

Context: Production org GitHub App on CoopAI-Corp indexes org repos. Personal repos must NOT use the org install token. Members should use org cloud index via workspace repos AND optionally connect personal GitHub via per-user OAuth in the extension.

Start with B1 (schema + /v1/me/code-hosts/github + user OAuth callback), then B2 (extension Settings). Keep admin Indexing org-scoped only. Match existing patterns in code_host_installations and githubOAuthConnector.

Railway API service is named Coop-AI, not coop-api.
```

---

## Quick reference

| URL / name | Value |
|------------|--------|
| Admin | https://admin.coop-ai.dev |
| API | https://api.coop-ai.dev |
| GitHub App slug | `coopai-for-vs-code` |
| Test org | **CoopAI-Corp** |
| Test repo | `CoopAI-Corp/coop-test-org-widget` |
| Railway services | **Coop-AI**, **coop-worker**, Postgres |

### coop-worker must match Coop-AI

- `CREDENTIALS_ENCRYPTION_KEY`
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG=coopai-for-vs-code`
- `DATABASE_URL`
- `OPENAI_API_KEY` (embeddings)

---

## Out of scope for first dual-connection slice

- MCP, estate sync auto-queue all org repos
- Indexing personal repos into org admin catalog
- Second GitHub App install on personal account **replacing** org link (old anti-pattern)
- Stripe live flip

---

## Checklist when done

| Step | Done when |
|------|-----------|
| Member workspace smoke (Phase A) | Second user searches `CoopAI-Corp/*` without personal GitHub |
| `user_code_host_connections` migration | Applied on prod Postgres |
| User GitHub OAuth in extension | Settings shows connected + `github_login` |
| Admin Indexing unchanged | Only org-install repos in Configure picker |
| Org reindex still works | `CoopAI-Corp/*` → Ready after worker deploy |
| Token redaction deployed | Failed job Details never show `ghs_…` |
