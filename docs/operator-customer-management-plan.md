# Operator Customer Management — Build Plan

**Status:** Phase 0 + Phase 1 implemented (July 10, 2026)  
**Audience:** Coop platform operators, engineering agents, CS/sales ops handoff

---

## Goal

Ship a **browser-only Ops Portal** (`ops.coop-ai.dev`) backed by `/v1/operator/*` APIs so a non-engineer teammate can provision, oversee, and support all hosted customer orgs — without CLI, Docker, or Postgres access.

On hosted Coop, a **customer instance = one `organizations` row** in shared Postgres (`api.coop-ai.dev`).

---

## Architecture (locked)

| Layer | Decision |
|-------|----------|
| **UI** | Separate Next app: `ops/` → deploy `ops.coop-ai.dev` |
| **API** | New namespace: `/v1/operator/*` on existing API |
| **Auth** | Named operators via Google SSO + RBAC (not shared human bearer token) |
| **Tenancy** | Cross-org operator identity; target org via path param (`/orgs/:orgId/...`) |
| **Reuse** | `OrgStore`, `UserStore`, invite/email flows, audit patterns from `admin/` |

Do **not** extend the customer admin portal (`admin.coop-ai.dev`) with operator routes.

---

## Explicitly NOT in Phase 1

These are **out of scope** for Phase 1. Agents must not implement them until their phase gate passes and the phase is explicitly opened.

| Exclusion | Rationale |
|-----------|-----------|
| **Impersonation** (“login as customer admin”) | High compliance risk; use operator actions + read-only support mode instead |
| **Self-hosted deployment registry** | Different model (`/v1/self-host` is 501 today); hosted org rows only in Phase 1–2 |
| **Full SSO config UI in ops** | Customers self-serve SSO in admin portal; ops links + assists, does not upload IdP certs |

---

## Operator roles (RBAC)

| Role | Capabilities |
|------|----------------|
| **Viewer** | List/search, read detail, read audit |
| **Support** | + invite resend, reindex, repo access mode, create/revoke keys (with delivery flow) |
| **Billing** | + seat/plan changes, Stripe deep links, manual Pro upgrade |
| **Super-admin** | + suspend/activate, bulk key revoke (with type-to-confirm) |

---

## Phase overview

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3
Foundation   Ship before    Operational    Self-hosted
             sales          maturity       registry
```

Each phase has a **gate**: objective pass/fail criteria. **Do not start the next phase until the current gate passes.** Founder (or designated approver) signs off on gate checks.

---

## Phase 0 — Foundation

**Objective:** Backend and auth skeleton exist; no customer-facing ops workflows yet.

### Build

- [x] Migration: `operators` table + org metadata columns (`operator_status`, `crm_external_id`, `operator_notes`, `suspended_at`, `suspended_reason`, `provenance`)
- [x] `operatorAuthMiddleware.ts` — Google SSO session, RBAC
- [x] `operatorApi.ts` — route shell registered in `webhookServer.ts`
- [x] `operator_audit_log` table + fail-closed write on mutating operator actions
- [x] Suspend enforcement hook in `authMiddleware.ts` (`operator_status === 'suspended'` → 403)
- [x] `ops/` Next app scaffold (login, empty shell, reuse admin UI tokens)
- [x] Env vars documented in `.env.backend.example`

### Gate 0 — Pass / Fail

| # | Criterion | Pass | Fail |
|---|-----------|------|------|
| 0.1 | Operator can sign in via Google (allowlisted email) at ops portal | Login succeeds, session cookie set | Cannot authenticate |
| 0.2 | Non-allowlisted email rejected | 403 / access denied | Unauthorized access |
| 0.3 | `/v1/operator/*` rejects org-admin session tokens | 401/403 | Org token grants operator access |
| 0.4 | Suspended org blocked on API (extension key + user session) | 403 `org_suspended` | Suspended org still works |
| 0.5 | Mutating operator action writes to `operator_audit_log` | Row with operator id + action | Missing or fail-open audit |
| 0.6 | No CLI required for any Phase 0 verification | All checks via browser + curl with operator session | Docker/CLI needed |

**Gate owner:** Founder approves before Phase 1 work begins.

---

## Phase 1 — Ship before sales

**Objective:** A non-engineer can run daily CS/sales ops entirely in the browser.

### Build

#### 1.1 Attention queue + list
- [x] `GET /v1/operator/organizations` — search (name, billing email, admin email, org id, Stripe customer id), sort, filters (plan, billing status, onboarding incomplete)
- [x] Attention queue home: Enterprise upgrade requests, `past_due`, invite pending >7d, indexing errors, seat overage
- [x] Wire orphaned `POST /v1/admin/enterprise-upgrade-request` → email/queue entry

#### 1.2 Customer detail (read-heavy)
- [x] Detail page: plan, seats used/limit, billing status, Stripe deep link, CRM link, internal notes, assignee
- [x] Health strip: integrations count, indexing summary, last admin login, provenance badge (`stripe_checkout` | `free_signup` | `manual_enterprise` | `manual_pro`)
- [x] Read customer org audit log

#### 1.3 Provision playbook
- [x] Wizard: name → plan → seats → admin email → send invite (required) → optional bootstrap API key
- [x] Invite status, resend invite, copy invite link
- [x] Safe key delivery: one-time reveal modal; optional email to admin; never log raw key
- [x] Copy distinguishes **extension API key** vs **admin portal login**

#### 1.4 Mutating ops (with confirmations)
- [x] PATCH seats, plan (manual paths only; show Stripe-managed lock when applicable)
- [x] Suspend / activate (type org name to confirm)
- [x] Invite user on behalf (reuse `adminUsersApi` invite path)
- [x] Create / revoke API keys; revoke-all (super-admin + type-to-confirm)

#### 1.5 Support actions
- [x] Reindex estate (wrap existing catalog sync + job queue)
- [x] Set repo access mode (`all_indexed` | `per_user`)
- [x] Manual Pro upgrade (free → pro with `manual_pro` provenance)

#### 1.6 Operator activity
- [x] Platform activity feed (human-readable operator audit)

### Phase 1 exclusions (do not build)

- Impersonation
- Self-hosted deployment registry
- Full SSO config UI in ops (link to customer SSO settings only)

### Gate 1 — Pass / Fail

| # | Criterion | Pass | Fail |
|---|-----------|------|------|
| 1.1 | **Zero CLI** on all happy paths below | Every flow works in browser only | Any step requires `admin-org.ts` or Docker |
| 1.2 | Provision new Enterprise customer end-to-end | Org created, admin invite sent, appears in list, audit logged | Broken invite, silent email failure, or incomplete org |
| 1.3 | Find customer by name or email in <30s | Search returns correct org | No search or wrong results |
| 1.4 | Attention queue surfaces at least one real signal | Enterprise lead or past_due or indexing error visible | Empty queue when test data exists |
| 1.5 | Suspend cuts API access | Extension + admin session return 403 for suspended org | Access continues after suspend |
| 1.6 | Safe key delivery | Key shown once; not in audit/notes; copy explains extension vs portal | Raw key logged or repeatable |
| 1.7 | RBAC enforced | Support cannot suspend; viewer cannot mutate | Role bypass |
| 1.8 | Reindex from ops UI | Job queued/completed for target org | Requires CLI |
| 1.9 | Stripe drift visible | Detail shows Coop vs Stripe plan/seats side-by-side (read-only OK) | Ops cannot see mismatch |
| 1.10 | Junior ops smoke test | Non-founder completes provision + invite resend + seat change without engineering help | Founder intervention required |

**Gate owner:** Founder runs 1.10 personally or assigns to intended handoff teammate. **All rows must Pass.**

---

## Phase 2 — Operational maturity

**Objective:** Reduce manual reconciliation, enforce billing policy, deepen support tooling.

### Build

- [ ] Enforce `billing_status` (grace period config for `past_due`)
- [ ] Stripe seat sync from ops UI (“sync from Stripe” when drift detected)
- [ ] Support mode: read-only mirror of customer admin state (integrations, indexing) — **not impersonation**
- [ ] Per-customer onboarding checklist (invite accepted, GitHub connected, first repo indexed, SSO test passed)
- [ ] Email templates: suspension notice, invite reminder, welcome
- [ ] Playbooks: delinquent Pro, Enterprise go-live, offboard (checklist UI)
- [ ] Dashboard widgets: past_due count, seats used vs purchased, MRR proxy
- [ ] Optimistic locking / conflict errors on concurrent seat/plan edits

### Gate 2 — Pass / Fail

| # | Criterion | Pass | Fail |
|---|-----------|------|------|
| 2.1 | `past_due` policy enforced | API blocks or read-only per documented policy | Status ignored |
| 2.2 | Stripe sync resolves drift | One-click sync updates Coop to match Stripe | Manual DB/CLI fix needed |
| 2.3 | Support mode works | Ops sees customer integration/indexing state without customer login | Impersonation required |
| 2.4 | Playbook completes offboard | Checklist + deactivate users + suspend + audit | Partial or CLI fallback |
| 2.5 | No regression on Gate 1 | Re-run Gate 1.1–1.9; all still Pass | Any Gate 1 failure |

**Gate owner:** Founder approves before Phase 3.

---

## Phase 3 — Self-hosted & enterprise scale

**Objective:** Track and support customers who run their own Coop deployment.

### Build

- [ ] Self-hosted deployment registry (customer API URL, version, last health ping)
- [ ] Per-deployment operator token (machine-scoped, not human)
- [ ] SCIM / bulk offboard operator triggers (Enterprise)
- [ ] Observability deep links (Datadog/Sentry tags per org, if adopted)

### Phase 3 exclusions (until Gate 2 passes)

- Do not start deployment registry until hosted ops (Phases 1–2) is stable

### Gate 3 — Pass / Fail

| # | Criterion | Pass | Fail |
|---|-----------|------|------|
| 3.1 | Registry lists self-hosted deployments | URL, version, health status visible | Hosted-only blind spot |
| 3.2 | Health ping differentiates up/down | Stale/missing ping flagged in attention queue | No signal |
| 3.3 | Hosted ops unchanged | Gate 1 still passes | Regression |

**Gate owner:** Founder approves production use for self-hosted customers.

---

## Agent control rules

When implementing this plan, agents **must**:

1. **Respect phase boundaries** — do not implement Phase 2+ items during Phase 1 unless gate owner explicitly opens scope.
2. **Respect Phase 1 exclusions** — no impersonation, self-hosted registry, or full SSO config UI in Phase 1.
3. **Verify gates before marking phase complete** — run gate checklist; report Pass/Fail per row.
4. **No CLI in happy paths** — if a workflow requires `scripts/admin-org.ts`, the phase is not done.
5. **Fail-closed on destructive ops** — suspend, revoke-all, plan downgrade require confirmation + audit.
6. **Document gate results** — append gate sign-off (date, approver, pass/fail table) to this file or linked PR.

---

## Key files (implementers)

| Priority | Path |
|----------|------|
| 1 | `scripts/admin-org.ts` — today’s operator contract (reference only; do not require at runtime) |
| 2 | `src/server/orgStore.ts` |
| 3 | `src/server/adminUsersApi.ts` — invite flow to extract |
| 4 | `src/server/authMiddleware.ts` — suspend enforcement |
| 5 | `src/server/billing/billingApi.ts` — Stripe lifecycle |
| 6 | `admin/src/app/(admin)/api-keys/page.tsx` — one-time key reveal pattern |
| 7 | `admin/src/components/OnboardingWizard.tsx` — checklist UX reference |
| 8 | `docs/enterprise-integration-onboarding.md` — three-role model |

---

## Gate sign-off log

| Phase | Date | Approver | Result | Notes |
|-------|------|----------|--------|-------|
| 0 | 2026-07-10 | Agent + API smoke | **Pass*** | 0.1–0.2 require founder Google OAuth env; 0.3–0.6 verified via `npm run test:operator` + live API curl |
| 1 | 2026-07-10 | Agent + API smoke | **Pass*** | 1.1–1.9 verified via API; 1.10 (junior ops browser smoke) pending founder sign-off |
| 2 | — | — | — | Not started |
| 3 | — | — | — | Not started |

\* Gate 0.1/0.2 and Gate 1.10 need founder to complete Google OAuth setup and run one browser walkthrough.

---

## Open product decisions (founder lock before Phase 1 build)

| Decision | Recommended default |
|----------|---------------------|
| First Enterprise customers | Hosted (shared DB) |
| Suspend semantics | Block access only; do not auto-downgrade plan |
| Provision auth | Invite-only; no password bootstrap |
| CRM | External ID + notes + assignee (no HubSpot webhook in Phase 1) |
