# Handoff — Oracle API deploy (paste into new Cursor chat)

Copy everything below the line into a **new Agent chat**. Repo path: `/Users/jonraney/Desktop/Coop AI`.

---

## Your role

You are continuing **Phase 1 operator deploy** for Coop AI. The **agent build phase is complete** (merged to `main`). The human has **not** deployed production yet. Guide them step-by-step with explicit **File / Terminal / Browser / Extension UI** labels per `.cursor/rules/user-instructions.mdc` and `.cursor/rules/clear-user-requests.mdc`.

**Do not commit** unless the user asks. **Never read, commit, or paste** `.env.backend` contents into chat. Use `.env.backend.example` for variable names only.

---

## Product context (what Coop AI is)

- VS Code extension + backend API (`api.coop-ai.dev`) + admin portal (`admin.coop-ai.dev`) + marketing site (`coop-ai.dev`)
- Self-serve Pro: Stripe checkout → org provisioning → welcome email with admin API key
- Docker Compose stack: **postgres**, **api** (8787), **worker** (indexing), **zoekt** (search)
- Canonical domains in `AGENTS.md` — marketing is **coop-ai.dev**; API is **api.coop-ai.dev** (different domain, not a typo)

---

## What is already done (do not redo)

| Item | Status |
|------|--------|
| Launch PR #3 (admin, analytics, billing, migrations, extension fixes) | ✅ Merged to `main` |
| CI PR #4 (`.github/workflows/ci.yml`, lint fixes) | ✅ Merged; green on `main` |
| Local smoke tests A1–D (Local Test Org) | ✅ Passed |
| Git | ✅ On `main`, feature branches deleted |
| Agent launch playbook (P1, D, C, A, B, P2 code/docs) | ✅ Complete |
| Hosting choice | ✅ **Oracle Cloud Always Free** (not Hetzner/Railway/Fly) |

---

## Oracle account state (human progress)

| Item | Status |
|------|--------|
| Oracle Cloud account | ✅ Created — `jonathanaraney@gmail.com` |
| Home region | ✅ **US West (San Jose)** — fixed for tenancy |
| VCN / VM / security lists | ❌ **Not created yet** |
| DNS `api.coop-ai.dev` | Points to AWS IPs; **no TLS, no app** (expected until deploy) |
| Production `.env.backend` on server | ❌ Not created |

---

## SSH key on human's Mac (may already exist)

A previous chat generated keys at:

```text
/Users/jonraney/.ssh/coop-oracle       (private — never share)
/Users/jonraney/.ssh/coop-oracle.pub   (paste into Oracle Console)
```

**Verify in Terminal:**

```bash
ls -la ~/.ssh/coop-oracle ~/.ssh/coop-oracle.pub
cat ~/.ssh/coop-oracle.pub
```

If missing, regenerate per `docs/oracle-ssh-reference.md`.

**Important:** Copy key in **Terminal** (`pbcopy < ~/.ssh/coop-oracle.pub`). Paste key in **Browser** (Oracle Console → Create instance → Paste public keys). These are two different surfaces.

---

## Repo docs for this work

| Doc | Purpose |
|-----|---------|
| `docs/deploy-oracle-always-free.md` | **Primary runbook** — VM, Docker, Caddy, DNS, `.env.backend` |
| `docs/oracle-ssh-reference.md` | SSH key commands only |
| `docker-compose.prod.yml` | Production overrides (API on 127.0.0.1:8787; no public Postgres/Zoekt) |
| `docs/deploy-self-serve-pro.md` | **After API is live** — Stripe, Resend, Vercel, admin deploy, E2E signup |
| `docs/connect-integrations-production.md` | OAuth redirect URIs for production |
| `docs/agent-launch-playbook.md` | Launch status section at top |
| `docs/pull-requests/launch-self-serve-pro-admin.md` | Smoke checklist + remaining operator items |

---

## Local dev (for reference)

- API: `docker compose up -d --build` from repo root → `localhost:8787`
- Admin: `cd admin && npm run dev` → port **3001**
- Local `.env.backend` exists (gitignored) with integration OAuth + Resend filled; **`COOP_REQUIRE_API_AUTH=false`** locally; Stripe not set locally
- Human should **rotate** any API keys ever pasted in chat

---

## Immediate next steps (in order)

Human has **only registered Oracle**. Execute from step 1:

### 1. Browser — OCI Console (US West San Jose)

- Create **VCN with Internet Connectivity** (wizard) if none exists
- **Security list** ingress: TCP **22, 80, 443** from `0.0.0.0/0` (tighten SSH later)
- **Create instance:**
  - Name: `coop-api`
  - Image: **Ubuntu 24.04** (Always Free eligible)
  - Shape: **VM.Standard.A1.Flex** — **4 OCPU / 24 GB RAM**
  - Boot volume: ~100 GB
  - **Assign public IPv4**
  - SSH: paste contents of `~/.ssh/coop-oracle.pub`
- If **out of capacity**: try another Availability Domain or retry later

**Success:** Instance **Running**; public IP visible.

### 2. Terminal — SSH from Mac

```bash
ssh -i ~/.ssh/coop-oracle ubuntu@<PUBLIC_IP>
```

**Success:** `ubuntu@...` shell on VM.

### 3. Terminal — on VM (follow `docs/deploy-oracle-always-free.md` Part B–D)

- Install Docker + compose plugin
- Clone `https://github.com/raneyja/Coop-AI.git` to `/opt/coop`, `git checkout main`
- Create `/opt/coop/.env.backend` with **production** values:
  - `COOP_REQUIRE_API_AUTH=true`
  - New `CREDENTIALS_ENCRYPTION_KEY` (`openssl rand -base64 32`)
  - `COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev`
  - `WEBHOOK_DOMAIN=https://api.coop-ai.dev`
  - `COOP_CORS_ORIGINS=https://admin.coop-ai.dev,https://coop-ai.dev`
  - Copy integration OAuth + LLM + Resend from local `.env.backend` (human edits file on server — do not exfiltrate secrets into chat)
- Run:

```bash
cd /opt/coop
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
./scripts/migrate.sh
curl -s http://127.0.0.1:8787/health
```

**Success:** health JSON on localhost. First ARM build may take 15–25 min.

### 4. Terminal + File — Caddy TLS on VM

- Install Caddy; `/etc/caddy/Caddyfile` → `api.coop-ai.dev { reverse_proxy 127.0.0.1:8787 }`

### 5. Browser — DNS

- Where **coopai.dev** is managed: **A record** `api` → VM public IP

### 6. Terminal — verify

```bash
curl -s https://api.coop-ai.dev/health
```

**Success:** HTTPS health OK → **Phase 1 API deploy complete**.

---

## After Phase 1 API (Phase 2 — same operator thread or follow-on)

Follow `docs/deploy-self-serve-pro.md`:

1. Stripe keys + webhook `https://api.coop-ai.dev/webhooks/stripe`
2. Resend domain verify for `coop-ai.dev`
3. Vercel env: `COOP_API_BASE`, `NEXT_PUBLIC_ADMIN_PORTAL_URL`
4. Deploy admin to `admin.coop-ai.dev`
5. Update OAuth redirect URIs in vendor consoles (`docs/connect-integrations-production.md`)
6. E2E signup test: pricing → checkout → welcome email → admin login

---

## Common human confusion (address proactively)

| Confusion | Clarification |
|-----------|---------------|
| Terminal vs Oracle for SSH key | **Terminal** copies key; **Browser/OCI** pastes key when creating VM |
| `cd` + command on one line | Must use `&&` or separate lines |
| `api.coop-ai.dev` down | Expected until VM + Caddy + DNS are done |
| Railway/Fly free tier | Rejected; Oracle chosen for $0 + full compose |
| `coop-ai.dev` subdomains | Marketing `coop-ai.dev`, API `api.coop-ai.dev`, admin `admin.coop-ai.dev` |

---

## Agent behavior

- Lead with **Do this now** numbered steps; label **File / Terminal / Browser**
- Run commands yourself when possible (SSH to VM only after human provides public IP)
- Minimize scope — deploy only, no feature work
- One linear happy path; put alternatives under **Only if blocked**
- When human pastes errors or IPs, continue from exact step failed

---

## Success criteria for this handoff thread

- [ ] Oracle VM running (A1 Flex 4/24)
- [ ] SSH works
- [ ] `docker compose` stack healthy on VM
- [ ] `https://api.coop-ai.dev/health` returns OK
- [ ] (Optional next) Stripe + Resend + admin deploy per deploy-self-serve-pro.md

---

## Start message for human to send after pasting this handoff

> I pasted the Oracle API deploy handoff. Oracle account is registered (San Jose); nothing else done on OCI yet. Walk me through creating the VM step by step — one surface at a time (Terminal vs Browser). SSH keys may already exist at ~/.ssh/coop-oracle.
