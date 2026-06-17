# Deploy Coop API on Railway (Phase 1)

Phase 1: **API + managed PostgreSQL** on [Railway](https://railway.app). Goal:

```bash
curl -s https://api.coop-ai.dev/health
# {"status":"ok",...}
```

**Phase 2 (later):** worker + Zoekt indexing — see [Phase 2 — worker + Zoekt](#phase-2--worker--zoekt-optional) below.

**Supersedes:** [deploy-oracle-always-free.md](./deploy-oracle-always-free.md) (Oracle Ampere capacity blocked San Jose).

**Surfaces:** **Browser** (Railway, DNS), **Terminal** (verify only). Secrets go in **Railway Variables** — never commit `.env.backend`.

---

## What Railway runs (Phase 1)

| Railway resource | Role |
|------------------|------|
| **PostgreSQL** plugin | Managed Postgres; injects `DATABASE_URL` |
| **coop-api** service | Dockerfile build → `node dist/webhookServer.js` |
| **Pre-deploy command** | `node scripts/run-migrations.mjs` before each deploy (`preDeployCommand` in `railway.toml`) |

No Caddy, no VM SSH, no Oracle networking. Railway terminates TLS on custom domains.

**Deferred in Phase 1:** background worker, Zoekt full-text search (Lightning Zoekt path degraded until Phase 2).

---

## Repo files (already in tree)

| File | Purpose |
|------|---------|
| `railway.toml` | Dockerfile build, start, pre-deploy migrations, `/health` check |
| `Dockerfile` | Production API image |
| `scripts/run-migrations.mjs` | Applies `migrations/*.sql` using `DATABASE_URL` |
| `.env.backend.example` | Variable names — copy values from local `.env.backend` into Railway |

---

## Part A — Railway project + Postgres

### A1. Browser — Railway

1. [railway.app](https://railway.app) → sign in with **GitHub**
2. **New Project** → **Deploy from GitHub repo** → select **Coop-AI** (or your fork)
3. Railway creates a service from the repo — rename it **`coop-api`** if you like

### A2. Browser — Add PostgreSQL

1. In the project → **+ New** → **Database** → **PostgreSQL**
2. Open the Postgres service → **Variables** → copy **`DATABASE_URL`** exists (auto)

### A3. Browser — Link Postgres to API

1. Open **`coop-api`** service → **Variables**
2. **+ New Variable** → **Add Reference** → select Postgres → **`DATABASE_URL`**

Railway injects the same URL the API uses at runtime.

### A4. Browser — Enable pgvector (required)

Migration `008_repo_embeddings.sql` needs the `vector` extension.

1. Postgres service → **Data** tab → **Query** (or connect with `psql` from Railway **Connect** panel)
2. Run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Success:** `CREATE EXTENSION` (or already exists).

---

## Part B — API environment variables

Set these on the **`coop-api`** service (**Variables** tab). Source for integration keys: your local **`.env.backend`** (gitignored — copy manually; do not commit).

### Required (Phase 1)

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `COOP_REQUIRE_API_AUTH` | `true` |
| `JOBS_WORKERS` | `0` |
| `JOBS_BACKEND` | `postgres` |
| `GRAPH_CACHE_BACKEND` | `postgres` |
| `CREDENTIALS_ENCRYPTION_KEY` | Generate: **Terminal** `openssl rand -base64 32` — **new key for prod** if you never deployed |
| `COOP_PUBLIC_BASE_URL` | `https://api.coop-ai.dev` |
| `WEBHOOK_DOMAIN` | `https://api.coop-ai.dev` |
| `COOP_CORS_ORIGINS` | `https://admin.coop-ai.dev,https://coop-ai.dev` |
| `COOP_ADMIN_PORTAL_URL` | `https://admin.coop-ai.dev` |
| `COOP_MARKETING_BASE_URL` | `https://coop-ai.dev` |
| `ANTHROPIC_API_KEY` | From local `.env.backend` |
| `OPENAI_API_KEY` | From local `.env.backend` |
| `RESEND_API_KEY` | From local `.env.backend` |
| `EMAIL_FROM` | `hello@coop-ai.dev` |
| `COOP_EMAIL_MOCK` | `false` |

`DATABASE_URL` — reference from Postgres (Part A3). **`PORT`** — leave unset; Railway sets it automatically.

### Integration OAuth (copy from local `.env.backend`)

`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SLACK_APP_*`, `ATLASSIAN_APP_*`, `NOTION_APP_*`, `GOOGLE_DOCS_APP_*`, etc.

Update redirect URIs in each vendor console after the API domain is live — [connect-integrations-production.md](./connect-integrations-production.md).

### Stripe (Phase 2 — self-serve Pro)

Add when ready per [deploy-self-serve-pro.md](./deploy-self-serve-pro.md):

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`

---

## Part C — Deploy

### C1. Browser — trigger deploy

1. **coop-api** → **Settings** → confirm **Root Directory** is repo root and **Builder** is Dockerfile (from `railway.toml`)
2. **Deploy** (or push to `main` if GitHub auto-deploy is on)

**Watch logs for:**

- Build: Docker stages complete
- Release: `Migrations complete.`
- Deploy: `CoopAI webhook server listening on port ...`

### C2. Browser — Railway URL smoke test

1. **coop-api** → **Settings** → **Networking** → **Generate Domain** (temporary `*.up.railway.app`)
2. **Terminal** (Mac):

```bash
curl -s "https://YOUR-SERVICE.up.railway.app/health"
```

**Success:** JSON with `"status":"ok"` (or equivalent).

---

## Part D — Custom domain `api.coop-ai.dev`

### D1. Browser — Railway

1. **coop-api** → **Settings** → **Networking** → **Custom Domain**
2. Add **`api.coop-ai.dev`**
3. Note the **CNAME target** Railway shows (e.g. `xxxx.up.railway.app`)

### D2. Browser — DNS (where **`coop-ai.dev`** is managed, e.g. GoDaddy)

| Type | Name | Value |
|------|------|--------|
| **CNAME** | `api` | Railway CNAME target from D1 |

Remove old **A** records pointing at AWS/oracle if present.

TTL 300 while testing.

### D3. Terminal — verify HTTPS

```bash
curl -s https://api.coop-ai.dev/health
```

**Success:** same health JSON over HTTPS.

---

## Part E — OAuth redirects (before Connect in prod)

Each vendor app must allow `https://api.coop-ai.dev` callbacks. See [connect-integrations-production.md](./connect-integrations-production.md).

---

## Phase 2 — worker + Zoekt (optional)

Lightning full-text search needs **worker** (indexes repos) + **Zoekt** (serves shards). On Railway:

1. Add a second service from the **same repo** + **same Dockerfile**
2. **Start command:** `node dist/workerEntry.js`
3. Set `ZOEKT_INDEX_PATH=/zoekt-indexes`, mount a **Railway Volume** at that path
4. Add a third service (or combined start script) for `zoekt-webserver -index /zoekt-indexes -listen 0.0.0.0:6070`
5. On API: `ZOEKT_URL=http://<zoekt-private-host>:6070`

Contact maintainers or follow [deploy-railway-phase2-lightning.md](./deploy-railway-phase2-lightning.md) when you enable Phase 2.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Pre-deploy fails on migration 008 | Run `CREATE EXTENSION vector;` on Postgres (Part A4) |
| `DATABASE_URL is required` | Add Postgres reference on coop-api service |
| SSL / connection errors | Railway URL includes `sslmode=require`; app enables SSL automatically |
| Build OOM / timeout | Railway Hobby: retry deploy; first Docker build is heavy (Go + Zoekt tools) |
| `/health` 502 | Check deploy logs; confirm `PORT` not hardcoded in env |
| CORS from admin | `COOP_CORS_ORIGINS` includes `https://admin.coop-ai.dev` |

---

## Local parity

```bash
docker compose up -d --build
./scripts/migrate.sh          # or: npm run migrate (needs DATABASE_URL)
curl -s http://localhost:8787/health
```

---

## Next steps

1. [deploy-self-serve-pro.md](./deploy-self-serve-pro.md) — Stripe, Resend domain, Vercel env, admin deploy
2. [connect-integrations-production.md](./connect-integrations-production.md) — production OAuth
3. Phase 2 worker + Zoekt when Lightning indexing is required in prod
