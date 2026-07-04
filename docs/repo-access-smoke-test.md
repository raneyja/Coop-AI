# Repository access smoke test

Manual + automated checklist for admin-controlled Deep-Index and per-user repo grants.

**Prerequisites**

| Requirement | Notes |
|-------------|--------|
| API + Postgres | `docker compose up -d --build api postgres worker` |
| Migration 021 | `npm run migrate` or apply `migrations/021_org_repo_access.sql` |
| Admin portal env | `admin/.env.local` with `COOP_API_BASE=http://localhost:8787` |

---

## One-command automated smoke (API)

**Terminal** (repo root):

```bash
npm run smoke:repo-access
```

**Success:** prints `SMOKE PASS` and demo credentials in `/tmp/coop-repo-access-demo.json`.

This verifies:

- Pro org with 5 catalog repos (3 company indexed, 2 personal idle)
- `all_indexed` → developer sees all 3 indexed repos
- `per_user` → developer sees only granted repos (2)
- Newly indexed repo without grant stays hidden

---

## Seed demo org (manual UI testing)

**Terminal:**

```bash
npm run seed:repo-access-demo
```

Creates org **Repo Access Demo** (Pro) with:

| Account | Email | Password |
|---------|-------|----------|
| Admin | `repo-access-admin@demo.local` | `DemoPassword12!` |
| Developer | `repo-access-dev@demo.local` | `DemoPassword12!` |

**Catalog state after seed:**

| Repo | Deep-Indexed? |
|------|----------------|
| `github:acme/api` | Yes |
| `github:acme/web` | Yes |
| `github:acme/mobile` | Yes |
| `github:raneyja/personal-a` | No (discovered only) |
| `github:raneyja/personal-b` | No (discovered only) |

Developer pre-grants (used when you switch to per-user): `acme/api`, `acme/web` only.

### Fresh Pro org (onboarding / GitHub connect testing)

**Terminal:**

```bash
docker compose up -d api postgres
npm run seed:pro-onboarding
```

Creates **Pro Onboarding Test** with admin `pro-onboarding@demo.local` / `DemoPassword12!` — no repos or integrations pre-seeded. Use for admin portal onboarding and GitHub org install tests ([github-org-testing.md](./github-org-testing.md)).

---

## Start admin portal

**Terminal:**

```bash
./scripts/dev-admin-portal.sh
```

Open **http://localhost:3001/login** and sign in as the demo admin.

---

## Manual UI checklist

| Step | Surface | Action | Success |
|------|---------|--------|---------|
| 1 | Terminal | `npm run seed:repo-access-demo` | JSON with orgId + credentials |
| 2 | Browser | `./scripts/dev-admin-portal.sh` → login as admin | Dashboard loads, plan **Pro** |
| 3 | Browser — **Indexing** | Confirm only Deep-Indexed repos appear (no "Deep index off" list) | Empty until you Configure and select |
| 4 | Browser — **Indexing** | Click **Configure GitHub** → select repos → **Deep-Index selected** | Picker shows all repos; only selected appear on Indexing page |
| 5 | Browser — **Settings** | **Repository access** → switch **Per-user grants** | Saves; Users page copy updates |
| 6 | Browser — **Users** | **Manage repos** on developer → add/remove repos → **Save access** | Modal closes without error |
| 7 | Browser — **Users** | Invite form shows repo checkboxes (per-user mode) | Can select repos on invite |
| 8 | Extension UI | Sign in as `repo-access-dev@demo.local` | Settings → Workspace shows admin-controlled repos |
| 9 | Extension UI | Per-user mode: only granted repos in folder picker | No personal/ungranted repos |

---

## Real GitHub connect (optional)

The demo seed uses fake repo IDs. To test live discovery:

1. **Browser** — Admin portal → **Integrations** → **Connect (GitHub App)** (or **Send link to GitHub admin** for org install)
2. **Browser** — **Indexing** → **Configure GitHub** → picker opens with discovered repos
3. Select **company repos only** → **Deep-Index selected**
4. Confirm personal repos stay in **Deep index off** until you explicitly select them

See [github-connect.md](./github-connect.md) and [github-org-testing.md](./github-org-testing.md).

---

## API spot checks (optional)

**Terminal** (after seed, login for token):

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"repo-access-admin@demo.local","password":"DemoPassword12!"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken')

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/admin/org | jq '.repoAccessMode, .plan'

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/orgs/repos \
  | jq '[.repos[] | {repoId, lightningEnabled, indexStatus}]'
```

---

## Reset demo

Re-running seed deletes the previous **Repo Access Demo** org (CASCADE) and recreates it:

```bash
npm run seed:repo-access-demo
```
