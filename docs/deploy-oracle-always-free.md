# Deploy Coop API on Oracle Cloud Always Free

> **Superseded for new deploys:** use [deploy-railway.md](./deploy-railway.md). Keep this doc if you later obtain Ampere capacity or prefer a VM.

Phase 1 operator guide: run the full Docker Compose stack (Postgres, API, worker, Zoekt) on an **Always Free** Ampere A1 VM, terminate TLS with Caddy, and serve **`https://api.coop-ai.dev`**.

**After this works:** continue with [deploy-self-serve-pro.md](./deploy-self-serve-pro.md) (Stripe, Resend, admin, website env).

**Surfaces:** **Browser** (OCI console, DNS), **Terminal** (SSH on the VM), **File** (`.env.backend` on the server — never commit).

---

## Goal

```bash
curl -s https://api.coop-ai.dev/health
# {"status":"ok",...}
```

---

## What you are deploying

| Service | Role | Public? |
|---------|------|---------|
| `api` | HTTP API on 8787 | Via Caddy on 443 only |
| `postgres` | Database | **No** — internal Docker network |
| `worker` | SCIP + Zoekt indexing | **No** |
| `zoekt` | Full-text search | **No** |

The VM shape: **VM.Standard.A1.Flex** (ARM64), **4 OCPUs / 24 GB RAM** (uses the full Always Free Ampere quota on one instance).

---

## Part A — Oracle Cloud account + VM

### A1. Browser — create account

1. [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) → **Start for free**
2. Complete signup (email + card for verification — stay on **Always Free** shapes only)
3. Pick a **home region** close to users (e.g. **US East (Ashburn)** or **US West (Phoenix)**)

**Only if blocked:** try another region or availability domain — free Ampere capacity varies.

### A2. SSH key

**Reference file (keep open):** [oracle-ssh-reference.md](./oracle-ssh-reference.md)

**Terminal** (your Mac):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/coop-oracle -C "coop-api" -N ""
cat ~/.ssh/coop-oracle.pub
# or: pbcopy < ~/.ssh/coop-oracle.pub
```

Copy the **public** key line (`~/.ssh/coop-oracle.pub`) into the OCI console.

### A3. Browser — networking (VCN)

OCI Console → **Networking** → **Virtual cloud networks** → **Start VCN Wizard** → **Create VCN with Internet Connectivity**.

Defaults are fine. Note the VCN name.

### A4. Browser — security list (firewall)

VCN → **Security Lists** → default → **Add Ingress Rules**:

| Source | Protocol | Port | Notes |
|--------|----------|------|-------|
| `0.0.0.0/0` | TCP | 22 | SSH (tighten to your IP later) |
| `0.0.0.0/0` | TCP | 80 | HTTP (Caddy → HTTPS redirect) |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

**Do not** open 5432, 6070, or 8787 to the internet.

### A5. Browser — create compute instance

**Compute** → **Instances** → **Create instance**

| Field | Value |
|-------|--------|
| Name | `coop-api` |
| Image | **Ubuntu 24.04** (or 22.04) — **Always Free eligible** |
| Shape | **Ampere** → **VM.Standard.A1.Flex** |
| OCPUs | **4** |
| Memory (GB) | **24** |
| Boot volume | **100 GB** (within free allowance) |
| Public IPv4 | **Assign** |
| SSH keys | Paste your `coop-oracle.pub` |

**Create.** Copy the **public IP** when status is **Running**.

**Success:** `ssh -i ~/.ssh/coop-oracle ubuntu@<PUBLIC_IP>` logs in.

---

## Part B — Server setup (SSH)

All commands below run **on the VM** unless noted.

### B1. Terminal — OS updates + firewall

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### B2. Terminal — Docker + Compose

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu
newgrp docker
docker --version && docker compose version
```

**Success:** `docker compose version` prints v2.x.

### B3. Terminal — clone repo

```bash
sudo mkdir -p /opt/coop && sudo chown ubuntu:ubuntu /opt/coop
cd /opt/coop
git clone https://github.com/raneyja/Coop-AI.git .
git checkout main
```

---

## Part C — Production `.env.backend`

### C1. File — `/opt/coop/.env.backend` on the server

Create on the VM (copy structure from `.env.backend.example`). **Do not commit this file.**

**Required production lines** (fill secrets from your local `.env.backend` or regenerate for prod):

```bash
PORT=8787
NODE_ENV=production
COOP_REQUIRE_API_AUTH=true
COOP_DEV_MODE=false

# Generate on server: openssl rand -base64 32
CREDENTIALS_ENCRYPTION_KEY=

COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev
WEBHOOK_DOMAIN=https://api.coop-ai.dev
COOP_CORS_ORIGINS=https://admin.coop-ai.dev,https://coop-ai.dev
COOP_ADMIN_PORTAL_URL=https://admin.coop-ai.dev
COOP_MARKETING_BASE_URL=https://coop-ai.dev
COOP_CHECKOUT_SUCCESS_URL=https://coop-ai.dev/welcome
COOP_CHECKOUT_CANCEL_URL=https://coop-ai.dev/pricing

# LLM keys (server-side only)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Integration OAuth (same apps as local — update redirect URIs in vendor consoles first)
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
SLACK_APP_CLIENT_ID=
SLACK_APP_CLIENT_SECRET=
ATLASSIAN_APP_CLIENT_ID=
ATLASSIAN_APP_CLIENT_SECRET=
NOTION_APP_CLIENT_ID=
NOTION_APP_CLIENT_SECRET=
GOOGLE_DOCS_APP_CLIENT_ID=
GOOGLE_DOCS_APP_CLIENT_SECRET=

# Email
RESEND_API_KEY=
EMAIL_FROM=hello@coop-ai.dev
COOP_EMAIL_MOCK=false

# Stripe (Phase 2 — add when ready)
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# STRIPE_PRICE_ID_PRO=
```

`DATABASE_URL` is set by `docker-compose.yml` to the internal Postgres service — leave the compose override as-is.

**Terminal** — generate encryption key:

```bash
openssl rand -base64 32
```

Paste into `CREDENTIALS_ENCRYPTION_KEY`.

---

## Part D — Bind API to localhost only

By default `docker-compose.yml` publishes Postgres and Zoekt on the host. OCI security list blocks them, but bind the API to localhost for defense in depth.

### D1. File — `/opt/coop/docker-compose.prod.yml`

```yaml
services:
  api:
    ports:
      - "127.0.0.1:8787:8787"
  postgres:
    ports: []
  zoekt:
    ports: []
```

### D2. Terminal — build and start (ARM64 — first run ~15–25 min)

```bash
cd /opt/coop
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
./scripts/migrate.sh
curl -s http://127.0.0.1:8787/health
```

**Success:** JSON with `"status":"ok"` (or equivalent) on localhost.

**If build fails on ARM:** check Docker build logs for a missing binary; Node/Go/Zoekt images support `linux/arm64`.

---

## Part E — TLS with Caddy

### E1. Terminal — install Caddy

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

### E2. File — `/etc/caddy/Caddyfile`

```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
api.coop-ai.dev {
  reverse_proxy 127.0.0.1:8787
}
EOF
sudo systemctl reload caddy
```

Caddy obtains Let's Encrypt certs automatically once DNS points here.

---

## Part F — DNS

### F1. Browser — DNS for `api.coop-ai.dev`

Wherever **`coopai.dev`** DNS is managed (registrar or Cloudflare):

| Type | Name | Value |
|------|------|--------|
| **A** | `api` | `<VM public IP>` |

TTL 300 while testing.

**Success:** `dig +short api.coop-ai.dev` returns your VM IP.

### F2. Browser — verify HTTPS

```bash
curl -s https://api.coop-ai.dev/health
```

**Success:** same health JSON over HTTPS.

---

## Part G — OAuth redirect URIs (before Connect in prod)

Update each vendor app to allow **`https://api.coop-ai.dev`** callbacks. See [connect-integrations-production.md](./connect-integrations-production.md).

---

## Part H — Persist data across reboots

Docker Compose volumes (`coop_pg_data`, `coop_zoekt_indexes`) persist on the boot disk. Optional:

**Terminal** — enable compose on reboot:

```bash
sudo tee /etc/systemd/system/coop-compose.service <<'EOF'
[Unit]
Description=Coop AI Docker Compose
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/coop
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml down
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable coop-compose
```

---

## Part I — Backups (minimum viable)

**Terminal** — weekly Postgres dump (cron example):

```bash
mkdir -p /opt/coop/backups
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U coop coopai | gzip > /opt/coop/backups/coopai-$(date +%F).sql.gz
```

Copy backups off the VM (OCI Object Storage free tier or your Mac).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Out of capacity** creating A1 | Try another AD in the region, or another home region at signup |
| Build OOM | Ensure 24 GB shape; `docker system prune` between retries |
| `health` works locally, not HTTPS | DNS not propagated; Caddy logs: `sudo journalctl -u caddy -f` |
| CORS errors from admin | `COOP_CORS_ORIGINS` includes `https://admin.coop-ai.dev`; restart API |
| OAuth redirect mismatch | Vendor console must use exact `https://api.coop-ai.dev/v1/.../callback` |
| Disk full | `docker system df`; prune; enlarge boot volume in OCI if needed |

---

## Cost guardrails

Stay on **Always Free** only:

- **Shape:** VM.Standard.A1.Flex within 4 OCPU / 24 GB total
- **Do not** create paid load balancers, extra block volumes, or x86 shapes without checking pricing
- OCI **Budgets** → set alert at $1

---

## Next steps

1. [deploy-self-serve-pro.md](./deploy-self-serve-pro.md) — Stripe, Resend domain verify, Vercel env, admin deploy
2. [connect-integrations-production.md](./connect-integrations-production.md) — production Connect flows
3. When first paying customers land — plan move to paid OCI or AWS with managed Postgres
