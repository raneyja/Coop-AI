# GitHub org testing (dummy company flow)

**Reminder:** Simulate a real company by installing the Coop GitHub App on a **GitHub Organization** (not your personal account), then confirm a Coop admin can index org-owned repos that someone else created.

Use this when validating org-wide indexing, handoff to a GitHub org owner, and member access to the admin’s cloud index.

---

## Part A — Browser — Create a dummy GitHub org

1. Sign in to a **second GitHub account** (or your main account if you only need a free org).
2. Open [github.com/account/organizations/new](https://github.com/account/organizations/new) → create org (e.g. `coop-test-org`) on the **Free** plan.
3. **New repository** → Owner = **`coop-test-org`** (not your personal username) → create e.g. `coop-test-org/widget`.
4. Optional: create a second GitHub user, add them as org member, have them create `coop-test-org/other-repo` to prove “admin didn’t create it but can index it.”

**Success looks like:** Repo URL is `github.com/coop-test-org/...` (owner is the org name).

---

## Part B — Terminal or Browser — Seed a Coop test org

> **Do this before connecting GitHub.** The install link must come from the admin portal so Coop can attach the GitHub installation to your org. Opening GitHub’s install page directly (no `state` in the callback URL) causes **“Invalid or expired install state.”**

### Option 1 — Local Docker (fastest for dev)

**Terminal** — repo root, API + Postgres running (`docker compose up -d`):

```bash
cd "/Users/jonraney/Desktop/Coop AI"
docker compose up -d api postgres
npm run seed:pro-onboarding
```

**Success looks like:** JSON with `admin.email` = `pro-onboarding@demo.local`, `password` = `DemoPassword12!` (or `DEMO_PASSWORD`), `adminPortalUrl` = `http://localhost:3001/login`.

Or create a named org manually:

```bash
docker compose exec api node dist/admin-org.js create-org "Org Test Co" pro
docker compose exec api node dist/admin-org.js create-user <orgId> you@example.com owner
```

Set password via admin portal signup flow or existing auth tooling.

### Option 2 — Production (Railway Postgres)

**Terminal** — point at production DB (Railway Postgres → Connect → `DATABASE_URL`), same encryption key as **Coop-AI**:

```bash
cd "/Users/jonraney/Desktop/Coop AI"
DATABASE_URL='postgres://...' CREDENTIALS_ENCRYPTION_KEY='...' npm run build:backend
DATABASE_URL='postgres://...' CREDENTIALS_ENCRYPTION_KEY='...' node dist/admin-org.js create-org "Org Test Co" pro
DATABASE_URL='postgres://...' CREDENTIALS_ENCRYPTION_KEY='...' node dist/admin-org.js create-user <orgId> you@example.com owner
```

**Success looks like:** JSON with `id` (orgId). Sign in at [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login) with that user (set password on first login if needed).

---

## Part C — Browser — Connect GitHub (install on org via Coop)

1. **Browser** — [admin.coop-ai.dev/integrations](https://admin.coop-ai.dev/integrations) (or local `http://localhost:3001/integrations`) → sign in as the seeded admin.
2. GitHub card → **Connect (GitHub App)**.
   - If you are **not** the GitHub org owner: **Send link to GitHub admin** → paste that link to the org owner (it includes Coop’s signed `state`).
   - **Do not** bookmark or open `github.com/apps/coopai-for-vs-code/installations/new` by itself.
3. On GitHub you should land on **“Where do you want to install this app?”** with your personal account **and** any orgs you own.
   - If you only see **personal account** permissions (no switcher): GitHub auto-selected personal because the org is not an available target — see **Troubleshooting** below.
   - To retry the account picker: open the full Coop link from **Send link to GitHub admin** (includes `?state=...`) or edit the URL to `…/installations/new?state=…` (remove `/permissions` if present).
4. Select **`coop-test-org`** → **All repositories** (or pick `widget`) → **Install** or **Save** if already installed.
5. Callback URL should include `state=...` and `installation_id=...` → page says installed successfully → return to admin → **Refresh** until **Connected**.

**Success looks like:** No “Invalid or expired install state”; Integrations shows **Connected**.

**If you already installed from a direct GitHub link:** The app may be on the org already — that error is OK. Sign in to Coop admin → **Connect (GitHub App)** again → GitHub shows **Configure** → **Save** → callback succeeds this time.

### Troubleshooting — no org on GitHub install page

| Cause | Fix |
|-------|-----|
| Not org **owner** | **Browser** — `github.com/orgs/coop-test-org/people` → your role must be **Owner** (Member is not enough). |
| Org on another GitHub account | Sign into GitHub as the account that created the org, or transfer org ownership. |
| Stuck on personal (app already on personal account) | **Browser** — [github.com/settings/installations](https://github.com/settings/installations) → CoopAI for VS Code → **Configure** → **Uninstall**. Then **Connect** from Coop again using the link with `state=`. |
| **Install App** shows only `raneyja`, not your org | App is **private** (personal-only) — [github.com/settings/apps/coopai-for-vs-code](https://github.com/settings/apps/coopai-for-vs-code) → **Advanced** → **Danger zone** → **Make public**. Then **Install App** → install on **CoopAI-Corp**. |
| Org owner, still no org in list | **Browser** — `github.com/organizations/coop-test-org/settings/oauth_application_policy` → allow GitHub Apps (or ask org owner). |
| You created the GitHub App (developer settings) | **Browser** — [github.com/settings/apps/coopai-for-vs-code](https://github.com/settings/apps/coopai-for-vs-code) → **Install App** (left sidebar) → **Install** next to `coop-test-org`. You still need Coop’s `state` in the callback — use **Send link to GitHub admin** URL; if GitHub omits `state`, return to Coop admin and click **Connect** again after org install completes (relink may apply). |

See [github-connect.md](./github-connect.md) for App env vars and handoff details.

---

## Part D — Browser — Index org repos

1. **Indexing → Configure GitHub**
2. Select org repos (e.g. `CoopAI-Corp/coop-test-org-widget`)
3. Save / enable Deep-Index

**Success looks like:** Repos appear in the list (not only `yourusername/...` personal repos). Status moves **queued → indexing → ready** when **coop-worker** is running on Railway.

### Troubleshooting — clone failed: `could not read Username for 'https://github.com'`

The worker tried to clone **without** a GitHub App token (unauthenticated HTTPS). Public repos like `yourusername/Coop-AI` may still succeed; **private** org repos will fail.

**Do this now:**

1. **Browser** — Railway → **coop-worker** → **Variables**
2. Confirm these match **Coop-AI** exactly (use **Reference variable** where Railway supports it):
   - `CREDENTIALS_ENCRYPTION_KEY` — decrypts installation tokens stored by the API
   - `GITHUB_APP_ID`
   - `GITHUB_APP_PRIVATE_KEY`
   - `GITHUB_APP_SLUG` = `coopai-for-vs-code`
   - `DATABASE_URL`
   - `OPENAI_API_KEY` (for embeddings after clone succeeds)
3. **Browser** — Redeploy **coop-worker** → **Deployments** → latest → **View logs**
   - **Success looks like:** no `[workers] CREDENTIALS_ENCRYPTION_KEY is missing` or `GITHUB_APP_ID` warnings at startup
4. **Browser** — Admin → **Indexing** → **Reindex** on the failed repo

### Troubleshooting — `repository not found` on a personal repo (`raneyja/...`)

Coop is linked to your **company org** GitHub App install (e.g. **CoopAI-Corp**). That installation token can only clone repos the app was granted on **that org** — not your personal account repos.

| Symptom | Meaning |
|---------|---------|
| `CoopAI-Corp/...` indexes **Ready** | Org install + worker env are correct |
| `raneyja/repp` → `repository not found` | Repo is outside the org install (expected for org-only testing) |

**Do this now:** Admin → **Indexing** → **Turn off** on personal repos you do not need (`raneyja/repp`, etc.). Keep only org repos enabled.

**Only if you need personal repos indexed too:** **Browser** — [github.com/settings/installations](https://github.com/settings/installations) → install Coop on your **personal** account → Coop admin → **Integrations** → reconnect (note: one Coop org typically links to one GitHub install — prefer org install for company testing).

**Verify org install before Configure GitHub:** **Browser** → `github.com/organizations/YOUR-ORG/settings/installations` — you must see **CoopAI for VS Code** listed. If it says *“No installed GitHub Apps”*, Coop is not connected to the company org yet (even if Integrations shows Connected — that may be a personal install).

---

**Collaborators and teams is not the control.** That page manages **people** who can clone or push. Coop uses a **GitHub App installation** — a separate permission layer.

| What you checked | What actually matters |
|------------------|----------------------|
| Repo → **Settings → Collaborators and teams** | Org → **Settings → Installed GitHub Apps** → Coop → **Configure** → **Repository access** |
| “0 users have organization access” on the repo | Whether the **App** is installed on the **org** (not your personal account) and includes this repo |

**Do this now:**

1. **Browser** — [github.com/organizations/CoopAI-Corp/settings/installations](https://github.com/organizations/CoopAI-Corp/settings/installations) (use your org slug) → **CoopAI for VS Code** → **Configure**
   - **Repository access:** **All repositories**, or **Only select repositories** with `coop-test-org-widget` checked → **Save**
2. **Browser** — [github.com/settings/installations](https://github.com/settings/installations) — if Coop is installed on your **personal** account, **Uninstall** it there (Coop should use the **org** install only).
3. **Browser** — Admin → **Integrations** → **Disconnect** → **Connect (GitHub App)** (relink is OK if org install already exists).
4. **Browser** — **Indexing → Configure GitHub** again.

**Verify which install Coop uses:** the picker should list `CoopAI-Corp/...` repos. If you only see `raneyja/...`, Coop is linked to your personal GitHub App install — repeat step 2.

---

## Part E — Browser — Member uses admin index (optional)

1. **Users → Invite** a developer (or use `seed-repo-access-demo` locally for a pre-built admin + dev pair).
2. Developer signs in → **Workspace → Choose workspace repos** → pick up to 3 indexed org repos.
3. VS Code extension → sign in → search/chat against those repos.

**Success looks like:** Member does **not** re-index; they use the admin’s cloud index.

---

## Quick checklist

| Step | Surface | Done when |
|------|---------|-----------|
| GitHub org + org-owned repo | Browser | `github.com/coop-test-org/...` exists |
| Coop Pro org + admin user | Terminal or signup | Can sign in to admin portal |
| GitHub Connected via admin **Connect** | Admin Integrations | Connected (not direct GitHub URL) |
| App on org | GitHub org settings | Installed GitHub Apps → Coop |
| Org repos in Configure GitHub | Admin Indexing | `YourOrg/*` listed (not only personal repos) |
| Index completes | Admin Indexing | **ready** (worker + `OPENAI_API_KEY` on Railway) |

---

## Related docs

- [github-connect.md](./github-connect.md) — App creation, Railway vars, handoff, OAuth fallback
- [deploy-production-handoff.md](./deploy-production-handoff.md) — worker + Zoekt (Phase 2)
- [workspace-repos.md](./workspace-repos.md) — admin indexes once; members pick workspace repos
