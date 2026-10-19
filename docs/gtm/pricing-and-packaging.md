# CoopAI Pricing & Packaging (Internal GTM)

**Version:** 1.0  
**Last updated:** June 10, 2026  
**Public reference:** [coop-ai.dev/pricing](https://coop-ai.dev/pricing)  
**Legal reference:** [Terms §8](https://coop-ai.dev/terms) — *“Enterprise pricing will be agreed separately.”*

This document is the internal source of truth for sales, marketing, and finance. The public pricing page is the customer-facing summary.

---

## Plan overview

| Plan | List price | Buyer | Deployment | Primary unlock |
|------|------------|-------|------------|----------------|
| **Developer** | Free (beta) | Individual engineer | Coop cloud | Zero-Clone remote code graph |
| **Pro** | **$20 / user / month** | Team lead / eng manager | Coop cloud | **Lightning Mode** (managed cloud indexing) |
| **Enterprise** | Custom (annual commit) | Security / platform / eng leadership | Coop cloud or self-hosted | Zero-retention, BYOK, SSO, compliance |

**Code reference:** `PRO_PLAN_PRICE_USD = 20` in `src/license/licenseChecker.ts`; plans `free | pro | enterprise` in `src/server/orgStore.ts`.

---

## Seat model

### Definition

A **seat** is one unique User who accesses the CoopAI Services (extension + authenticated API) during a rolling **30-day** period.

### How seats are tracked

| Mechanism | Details |
|-----------|---------|
| **Org API keys** | Each User authenticates with org-issued credentials tied to `orgId` |
| **License keys** | Optional format: `enterprise:…;seats=N` or `coop-ent-…;seats=N` (parsed in `licenseChecker.ts`) |
| **Plan enforcement** | `GET /v1/me` returns `plan`; Lightning APIs return **403** unless Pro+ |

### Seat policy (sales default)

| Rule | Value |
|------|-------|
| **Minimum commit (Pro)** | 5 seats (recommended; not enforced in product today) |
| **Minimum commit (Enterprise)** | 25 seats or **$36,000** annual platform minimum (whichever is greater) — *sales guideline* |
| **True-up** | Quarterly true-up for active seats above licensed count at prorated per-seat rate |
| **Overage** | 30-day grace, then invoice true-up or require purchase order amendment |
| **Non-seat users** | Read-only stakeholders (security reviewers) — no seat; no extension access |

> **Product gap:** Seat enforcement is not fully automated in billing. Sales should document committed seats on the Order Form; ops provisions via `admin-org.ts`.

---

## What's included by plan

### Developer (Free)

| Capability | Included |
|------------|----------|
| Zero-Clone remote code graph | ✓ |
| Webhook indexing (metadata only — no raw source in cache) | ✓ |
| Chat, quick actions, inline complete/edit | ✓ |
| Integrations (Slack, Jira, Confluence, Teams manual token) | ✓ |
| Workspace prompt library | ✓ |
| Cloud-hosted backend | ✓ |
| **Lightning Mode** (zoekt + scip cloud index) | ✗ |
| Graph symbol queries (`GET /graph/:repoId/*`) | ✗ |
| Enterprise SSO | ✗ |
| BYOK / zero-retention routing | ✗ |
| Compliance attestation PDF | ✗ |
| Self-hosted | ✗ |

### Pro ($20/user/month)

Everything in Developer, plus:

| Capability | Included |
|------------|----------|
| **Lightning Mode** — backend-managed zoekt + scip indexing | ✓ |
| Fast cross-repo symbol search | ✓ |
| `POST /v1/orgs/repos/:repoId/lightning/enable` | ✓ |
| Graph queries (Pro+) | ✓ |
| Shared prompt libraries | ✓ |
| Usage visibility & analytics | ✓ |
| Priority support (email) | ✓ |
| Enterprise controls (BYOK, zero-retention, SSO) | ✗ |

### Enterprise (Custom)

Everything in Pro, plus:

| Capability | Included |
|------------|----------|
| Zero-retention LLM routing (headers + `retention_policy`) | ✓ |
| BYOK (encrypted keys, 90-day audit logs without content) | ✓ |
| Server-side LLM key management (keys never in IDE) | ✓ |
| Multi-provider router (Anthropic, OpenAI, Gemini; DeepSeek by legal approval) | ✓ |
| SAML SSO (Okta, Azure AD, generic) | ✓ |
| Compliance attestation & signed retention reports | ✓ |
| DPA + security questionnaire support | ✓ |
| Self-hosted deployment option | ✓ |
| Dedicated onboarding (typically 8–16 hours, negotiable) | ✓ |

---

## Enterprise packaging (recommended)

### Standard Enterprise bundle

| Component | Typical value |
|-----------|---------------|
| Platform fee | $24,000 – $48,000 / year (covers SSO, compliance, support) |
| Per-seat fee | $30 – $45 / user / month (annual) — discount from $20/mo Pro for enterprise controls |
| Minimum annual commit | $36,000 |
| Minimum seats | 25 |
| Onboarding | $5,000 – $15,000 one-time (optional waiver for strategic accounts) |
| Pilot | 30–60 day paid pilot at 50% of annual commit, convertible to annual |

### Volume discounts (guideline)

| Seats | Discount off list per-seat |
|-------|---------------------------|
| 25–49 | 0% |
| 50–99 | 10% |
| 100–249 | 15% |
| 250+ | Custom |

### Add-ons (future / custom SOW)

| Add-on | Notes |
|--------|-------|
| Additional repos (Lightning) | Default: unlimited repos up to fair-use indexing cap |
| Premium SLA (99.9%) | Custom exhibit on Order Form |
| EU data residency region | Roadmap; self-host today |
| Professional services | Custom integration work, security workshops |
| BYOK-only tier | Enterprise without Coop-hosted LLM keys |

---

## Billing mechanics

| Topic | Current state |
|-------|---------------|
| Payment processor | Manual invoicing (no Stripe integration in product) |
| Billing period | Annual prepay default; quarterly available for Enterprise |
| Currency | USD |
| Tax | Customer responsible (see MSA) |
| Beta transition | Public Terms: advance notice before GA pricing changes |
| Pro list price | $20/user/month on website; beta participants get notice |

---

## Competitive positioning (talk track)

1. **Developer free tier** removes adoption friction — engineers try Zero-Clone without procurement.
2. **Pro at $20** anchors below GitHub Copilot Business (~$19) while adding graph-grounded context + integrations.
3. **Enterprise** sells on **security architecture** (zero-retention, BYOK, no keys in IDE) — not per-seat commodity AI.
4. **Lightning** is the Pro upsell wedge; **compliance** is the Enterprise upsell wedge.

---

## Provisioning checklist (post-signature)

1. `npm run admin:org -- create-org "[Customer]" enterprise`
2. `npm run admin:org -- create-api-key <orgId> primary`
3. If SSO: `npm run admin:org -- configure-sso <orgId> okta ...`
4. Create users: `create-user`, `set-user-role`
5. Enable Lightning on pilot repos: `POST .../lightning/enable`
6. Configure LLM providers per `docs/llm-provider-keys.md` and `docs/zero-retention-llm.md`
7. Deliver license keys if extension-side validation needed: `enterprise:…;seats=N`

---

## FAQ (sales)

**Q: Is Developer really free forever?**  
A: Free during beta. GA pricing may introduce paid Developer limits; beta users get advance notice per Terms.

**Q: Can a team buy 3 Pro seats?**  
A: Yes technically; we recommend 5-seat minimum to cover eng lead + ICs.

**Q: Does Enterprise include Pro features?**  
A: Yes — Enterprise is a superset.

**Q: Self-hosted pricing?**  
A: Same or +15% platform premium for support burden; no per-token markup from Coop (Customer pays LLM providers directly with BYOK).

**Q: What counts as a seat if someone only uses the web dashboard?**  
A: Today there is no separate dashboard seat — seats are extension/API users.

---

## Document maintenance

Update this doc when:

- Public pricing page changes (`website/src/app/pricing/page.tsx`)
- `PRO_PLAN_PRICE_USD` or plan enums change
- New enterprise features ship (check `enterprise/page.tsx`, `zero-retention-llm.md`)
- Minimum commit policy changes (finance approval)
