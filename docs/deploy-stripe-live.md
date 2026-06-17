# Switch Stripe to live mode (operator)

Use after **test-mode** checkout, webhooks, and admin billing all work on `https://api.coop-ai.dev`.

**You do this in:** Stripe Dashboard + Railway Variables. Agents cannot paste your live secrets.

---

## Goal

Real customers pay on [coop-ai.dev/pricing](https://coop-ai.dev/pricing), Stripe webhooks provision orgs, welcome emails send live keys, admin billing portal works.

---

## Part 1 — Browser — Stripe Dashboard (live mode)

### 1.1 Confirm you are in Live mode

1. Open [dashboard.stripe.com](https://dashboard.stripe.com)
2. Top-right toggle: switch from **Test mode** to **Live mode** (no orange “Test mode” banner)

**Success looks like:** Dashboard shows **Live** data (may be empty if first launch).

### 1.2 Live product + price

1. **Product catalog → Products**
2. Create or open your **Coop AI Pro** product
3. Add or copy the **live** recurring price ID → starts with `price_` (not the test price ID)

**Success looks like:** you have a live `price_…` ID for $20/mo (or your chosen amount).

### 1.3 Live API keys

1. **Developers → API keys** (still in **Live** mode)
2. Copy **Secret key** → starts with `sk_live_…`
3. Do **not** commit this anywhere

**Success looks like:** `sk_live_…` copied to clipboard temporarily.

### 1.4 Live webhook endpoint

1. **Developers → Webhooks → Add endpoint**
2. **Endpoint URL:**
   ```
   https://api.coop-ai.dev/webhooks/stripe
   ```
3. **Events to send:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. **Add endpoint**
5. Open the new endpoint → **Signing secret** → **Reveal** → copy `whsec_…` (live signing secret)

**Success looks like:** endpoint shows recent deliveries after a test (Part 3); signing secret copied.

---

## Part 2 — Browser — Railway Variables

1. [railway.app](https://railway.app) → your project → **Coop-AI** (API) service → **Variables**
2. Update these (replace test values):

| Variable | New value (source) |
|----------|-------------------|
| `STRIPE_SECRET_KEY` | `sk_live_…` from Part 1.3 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from Part 1.4 (**live** endpoint, not test) |
| `STRIPE_PRICE_ID_PRO` | live `price_…` from Part 1.2 |

3. Confirm these are still set correctly:

| Variable | Expected |
|----------|----------|
| `COOP_CHECKOUT_SUCCESS_URL` | `https://coop-ai.dev/welcome` |
| `COOP_CHECKOUT_CANCEL_URL` | `https://coop-ai.dev/pricing` |
| `STRIPE_BILLING_PORTAL_RETURN_URL` | `https://admin.coop-ai.dev/billing` |
| `COOP_EMAIL_MOCK` | `false` |
| `RESEND_API_KEY` | your Resend key |

4. Wait for redeploy (green deployment)

**Success looks like:** latest deployment succeeded; no `billing_unavailable` in API logs.

---

## Part 3 — Browser — live checkout smoke test

Use a **real card** or Stripe’s live test flow only if your account allows it. Prefer a small real charge you can refund.

1. **Browser** → [coop-ai.dev/pricing](https://coop-ai.dev/pricing) → start Pro checkout
2. Complete payment
3. Redirect to `/welcome?session_id=cs_live_…`
4. **Email** — welcome with `coop_…` admin key (check spam)
5. **Browser** → [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login) → paste key
6. **Billing** → **Manage subscription** → Stripe customer portal opens

### 3.1 Stripe webhook verification

1. **Stripe Dashboard → Developers → Webhooks** → your live endpoint
2. **Recent deliveries** → latest `checkout.session.completed` → **200**

**Success looks like:** HTTP 200; org created; email received within ~1 minute.

---

## Part 4 — Rollback (if something breaks)

1. Railway → restore **test** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`
2. Redeploy
3. Website checkout works in test mode again

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Checkout 503 | `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID_PRO` set; API redeployed |
| Webhook 400 signature | `STRIPE_WEBHOOK_SECRET` must match **live** endpoint secret |
| No welcome email | `RESEND_API_KEY`, `COOP_EMAIL_MOCK=false`, domain verified in Resend |
| Duplicate org on replay | Migration `015_stripe_webhook_events.sql` applied |

See also: [deploy-self-serve-pro.md](./deploy-self-serve-pro.md)
