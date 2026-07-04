# Railway Phase 2 — Lightning search (worker + Zoekt)

**Optional** after Phase 1 API is live. Enables full-text repo search (Lightning / Zero-Clone indexing) in production.

Phase 1 alone works for chat + integrations; Lightning Zoekt path stays degraded until Phase 2.

**You do this in:** Railway (new services + volume). Agents provide config; you click in Railway UI.

---

## What gets added

| Railway service | Role | Start command |
|-----------------|------|---------------|
| **coop-worker** | Indexes repos, writes Zoekt shards | `node dist/workerEntry.js` |
| **coop-zoekt** | Serves search index | `zoekt-webserver -index /zoekt-indexes -listen 0.0.0.0:${PORT}` |

Both share a **Railway Volume** mounted at `/zoekt-indexes`.

API service gets: `ZOEKT_URL=http://coop-zoekt.railway.internal:6070` (or Railway private networking URL).

---

## Part 1 — Browser — Railway volume

1. Railway project → **+ New** → **Volume**
2. Name: `zoekt-indexes`
3. Mount path: `/zoekt-indexes`
4. Attach volume to **coop-worker** and **coop-zoekt** when you create those services (below)

**Success looks like:** volume exists and is attachable to services.

---

## Part 2 — Browser — coop-worker service

1. **+ New** → **GitHub Repo** → same Coop-AI repo as API
2. Rename service **`coop-worker`**
3. **Settings → Deploy**
   - **Build:** Dockerfile (same as API)
   - **Start command:** `node dist/workerEntry.js`
4. **Variables** — copy from **Coop-AI** (API service):
   - `DATABASE_URL` (reference Postgres)
   - `CREDENTIALS_ENCRYPTION_KEY`
   - GitHub / integration vars needed for cloning private repos
   - `ZOEKT_INDEX_PATH=/zoekt-indexes`
5. **Settings → Volumes** → attach `zoekt-indexes` at `/zoekt-indexes`
6. Deploy

**Success looks like:** worker logs show job polling; no crash on startup.

---

## Part 3 — Browser — coop-zoekt service

Zoekt is built into the Docker image (see `Dockerfile`).

1. **+ New** → **Empty service** or same repo with custom start
2. Rename **`coop-zoekt`**
3. **Settings → Deploy**
   - **Build:** same Dockerfile as API (includes `zoekt-webserver` binary)
   - **Start command:**
     ```
     zoekt-webserver -index /zoekt-indexes -listen 0.0.0.0:$PORT
     ```
4. **Variables:**
   - `PORT=6070` (or use Railway’s injected `PORT`)
5. **Volumes** → attach `zoekt-indexes` at `/zoekt-indexes` (same volume as worker)
6. **Networking** → enable **Private networking** (recommended — Zoekt not public)

**Success looks like:** service healthy; logs show Zoekt listening.

---

## Part 4 — Browser — link API to Zoekt

1. Open **Coop-AI** service → **Variables**
2. Add:
   ```
   ZOEKT_URL=http://coop-zoekt.railway.internal:6070
   ```
   (Use Railway’s **Private DNS** name from the zoekt service **Settings → Networking** if the hostname differs.)
3. Redeploy API

**Success looks like:** `curl -s https://api.coop-ai.dev/health` still returns `"ok":true`.

---

## Part 5 — Extension UI — enable Lightning for a repo

1. **VS Code** → Coop → sign in to production API
2. **Workspace** → set owner / repo / branch
3. Use **Zero-Clone** or Lightning enable flow in sidebar (indexes repo via worker)

**Success looks like:** indexing job completes; chat quick actions can search code in prod.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Worker can’t write index | Volume mounted on worker at `/zoekt-indexes` |
| Zoekt empty / 404 | Worker ran at least one index job; same volume on zoekt service |
| API can’t reach Zoekt | `ZOEKT_URL` uses Railway private hostname; both in same project |
| Build OOM | Retry deploy; first Docker build is heavy |

See also: [deploy-railway.md](./deploy-railway.md) Phase 1 baseline.
