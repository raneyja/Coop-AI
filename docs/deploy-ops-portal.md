# Deploy ops portal — ops.coop-ai.dev

Internal operator console (`ops/`) for cross-org customer management. Separate from [admin.coop-ai.dev](https://admin.coop-ai.dev).

**Prerequisites:** API on Railway with operator env vars set (see [operator-customer-management-plan.md](./operator-customer-management-plan.md)).

---

## Part A — Vercel project

**Status:** Project **`coop-ai-ops`** is linked to this repo (`ops/` root directory). Production deploy: [https://coop-ai-ops.vercel.app](https://coop-ai-ops.vercel.app).

### A1. Browser — [vercel.com/new](https://vercel.com/new) *(already done)*

1. Import the **Coop AI** GitHub repo (same as admin/website)
2. **Root Directory:** `ops`
3. **Framework:** Next.js (auto-detected)

### A2. Browser — Vercel → **coop-ai-ops** → Settings → Environment Variables *(already done)*

| Variable | Value |
|----------|--------|
| `COOP_API_BASE` | `https://api.coop-ai.dev` |
| `NEXT_PUBLIC_COOP_API_BASE` | `https://api.coop-ai.dev` |
| `NEXT_PUBLIC_OPS_URL` | `https://ops.coop-ai.dev` |

### A3. Terminal — redeploy (optional)

```bash
cd ops
npx vercel deploy --prod --yes
```

---

## Part B — Custom domain

### B1. Browser — Vercel → Project → Settings → Domains

Add **`ops.coop-ai.dev`**

### B2. Browser — DNS (GoDaddy — where `coop-ai.dev` is managed)

Add a **CNAME** record (same pattern as `admin`):

| Type | Name | Value |
|------|------|--------|
| **CNAME** | `ops` | `030955c216bdb7c9.vercel-dns-017.com` |

**Success:** Vercel → **coop-ai-ops** → Domains shows `ops.coop-ai.dev` as verified (can take a few minutes).

---

## Part C — Google OAuth (one-time)

**Browser** → [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)

On the same OAuth client as `GOOGLE_AUTH_CLIENT_ID`, ensure this redirect URI exists:

```
https://ops.coop-ai.dev/api/auth/google/callback
```

Local dev URI (register once, never remove):

```
http://localhost:3003/api/auth/google/callback
```

---

## Part D — Railway API (already done if following handoff)

| Variable | Value |
|----------|--------|
| `COOP_OPS_PORTAL_URL` | `https://ops.coop-ai.dev` |
| `COOP_CORS_ORIGINS` | `https://admin.coop-ai.dev,https://coop-ai.dev,https://ops.coop-ai.dev` |
| `COOP_OPERATOR_ALLOWLIST_EMAILS` | Comma-separated operator emails |

Redeploy API after changes.

---

## Verify

1. **Browser** → [https://ops.coop-ai.dev/login](https://ops.coop-ai.dev/login)
2. **Continue with Google** (allowlisted email)
3. Attention queue and customer list load

**Terminal** (optional):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://ops.coop-ai.dev/login
```

Expect `200`.

---

## Local dev

```bash
cd ops && npm install && npm run dev
```

Open **http://localhost:3003**. Copy `ops/.env.local.example` → `ops/.env.local`.

Do **not** put localhost URLs in Railway — local config stays in `.env.backend` and `ops/.env.local` only.
