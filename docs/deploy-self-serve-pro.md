# Deploy self-serve Pro MVP

End-to-end guide for operators deploying Coop AI self-serve checkout (Stripe → org provisioning → admin portal). Follow surfaces explicitly: **File**, **Terminal**, **Browser**, **Extension UI**.

**Prerequisites:** Agent P1 complete (migrations runner, auth hardening, CI). Stripe product + price created. Resend account for welcome email.

**API hosting (Phase 1):** [deploy-railway.md](./deploy-railway.md) — Railway API + managed Postgres for `https://api.coop-ai.dev`. (Legacy VM path: [deploy-oracle-always-free.md](./deploy-oracle-always-free.md).)

---

## Goal

A customer can sign up on [coop-ai.dev/pricing](https://coop-ai.dev/pricing), pay via Stripe, receive an admin API key by email, sign into the admin portal, and open the Stripe billing portal.

---

## 1. File — `.env.backend` (repo root)

`.env.backend` is gitignored. Copy from `.env.backend.example` if you do not have one yet.

Add or update these production values:

```bash
NODE_ENV=production
COOP_REQUIRE_API_AUTH=true
COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev
COOP_CORS_ORIGINS=https://admin.coop-ai.dev,https://coop-ai.dev
COOP_ADMIN_PORTAL_URL=https://admin.coop-ai.dev
COOP_MARKETING_BASE_URL=https://coop-ai.dev
COOP_CHECKOUT_SUCCESS_URL=https://coop-ai.dev/welcome
COOP_CHECKOUT_CANCEL_URL=https://coop-ai.dev/pricing

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_BILLING_PORTAL_RETURN_URL=https://admin.coop-ai.dev/billing

RESEND_API_KEY=re_...
EMAIL_FROM="CoopAI <hello@coop-ai.dev>"
COOP_EMAIL_MOCK=false
```

| Variable | Source |
|----------|--------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → endpoint → Signing secret |
| `STRIPE_PRICE_ID_PRO` | Stripe Dashboard → Products → your Pro price ID |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys |

**Success looks like:** `docker compose config` shows the vars (values redacted) and the API starts without `billing_unavailable` on checkout.

---

## 2. Terminal — API + migrations

From repo root:

```bash
cd "/Users/jonraney/Desktop/Coop AI"
docker compose up -d --build api
./scripts/migrate.sh
```

Migration `015_stripe_webhook_events.sql` must apply for webhook idempotency.

**Success looks like:**

```bash
curl -s http://localhost:8787/health
# {"status":"ok",...}
```

---

## 3. Browser — Stripe webhook

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. URL: `https://api.coop-ai.dev/webhooks/stripe`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **signing secret** into `.env.backend` as `STRIPE_WEBHOOK_SECRET` and restart the API.

**Success looks like:** Stripe “Send test webhook” for `checkout.session.completed` returns HTTP 200.

---

## 4. File + Browser — Vercel (marketing site `website/`)

### File — `website/.env` on Vercel (not committed)

| Variable | Production value |
|----------|------------------|
| `COOP_API_BASE` | `https://api.coop-ai.dev` |
| `NEXT_PUBLIC_ADMIN_PORTAL_URL` | `https://admin.coop-ai.dev` |

Template: `website/.env.example`

### Browser — Vercel project settings

1. Import or select the `website/` project
2. **Settings → Environment Variables** — add both vars above for Production
3. Redeploy

**Success looks like:** `/welcome?session_id=cs_test_...` shows “Provisioning may take a minute” and admin portal links point to `admin.coop-ai.dev`.

---

## 5. File + Browser — Admin portal (`admin/`)

### File — `admin/.env.local` (local) or Vercel env (production)

| Variable | Production value |
|----------|------------------|
| `NEXT_PUBLIC_COOP_API_BASE` | `https://api.coop-ai.dev` |

Template: `admin/.env.example`

### Terminal — local smoke

```bash
cd admin
npm install
npm run dev
```

Dev server: **http://localhost:3001** (matches `billingConfig.ts` default).

### Browser — production deploy

Deploy `admin/` to Vercel (or host) at `https://admin.coop-ai.dev`. Ensure `COOP_CORS_ORIGINS` on the API includes that origin.

**Success looks like:** `/login` accepts email/password or Google and dashboard loads org name + plan badge.

---

## 6. Browser — end-to-end signup test

1. **Browser** → [coop-ai.dev/pricing](https://coop-ai.dev/pricing) → start Pro checkout (use Stripe test card `4242 4242 4242 4242` in test mode)
2. After payment → redirect to `/welcome?session_id=cs_...`
3. **Email** — welcome message with portal link (Resend; check spam). Checkout does not set a password.
4. **Browser** → admin portal `/login` → **Continue with Google**, or use **Forgot password** to set a password for the checkout email
5. **Browser** → admin **Billing** → “Manage subscription” opens Stripe customer portal

**Success criteria:**

- Welcome email arrives within ~1 minute with a portal sign-in link
- Admin login works; integrations grid loads
- Billing portal session returns a Stripe URL
- Audit log shows `billing.checkout.completed` under the correct org (not Stripe customer ID)

---

## Local dev port reference

| Service | Port | Config |
|---------|------|--------|
| Admin portal | 3001 | `admin/package.json` |
| Marketing site | 3001 | `website/package.json` — run one at a time locally |
| Coop API | 8787 | `docker-compose.yml` |

Defaults aligned in `billingConfig.ts`, `welcome/page.tsx`, and `admin/README.md`.

---

## Operator-only checklist

- [ ] Stripe live/test keys in `.env.backend` (never commit)
- [ ] Stripe webhook endpoint + four events configured
- [ ] Resend API key; `COOP_EMAIL_MOCK=false`
- [ ] `./scripts/migrate.sh` through `015_stripe_webhook_events.sql`
- [ ] Vercel env: `COOP_API_BASE`, `NEXT_PUBLIC_ADMIN_PORTAL_URL`
- [ ] Admin deploy env: `NEXT_PUBLIC_COOP_API_BASE`
- [ ] `COOP_CORS_ORIGINS` includes admin + marketing origins
- [ ] Test signup flow in Browser

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Checkout 503 | `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID_PRO` in `.env.backend`; API rebuilt |
| No welcome email | `RESEND_API_KEY`, `COOP_EMAIL_MOCK=false`, API logs for `[email]` |
| Admin CORS error | `COOP_CORS_ORIGINS` includes admin origin; restart API |
| Duplicate org on webhook replay | Migration 015 applied (`stripe_webhook_events` table) |
| Billing status stuck | `invoice.payment_failed` webhook received; org `billing_status` → `past_due` |
