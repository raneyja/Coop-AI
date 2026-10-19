# CoopAI Sales Demo Script & Stable Demo Org Runbook

**Version:** 1.0  
**Last updated:** June 10, 2026  
**Audience:** Sales, solutions engineering  
**Duration:** 30–45 minutes (full); 15 minutes (abbreviated)

---

## Overview

This runbook provisions a **stable, reusable demo organization** with Enterprise features (SSO-ready, Lightning, integrations) and provides a step-by-step **sales demo script**. The demo org is designed for live calls — not the marketing website auto-play demos (`website/src/lib/demoStories.ts`).

### Demo org profile

| Attribute | Value |
|-----------|-------|
| **Org name** | `Coop AI Demo` (or `coop-ai-demo`) |
| **Plan** | `enterprise` |
| **Primary repo** | `github:coop-ai/coop-ai-core` (or customer's public monorepo) |
| **Integrations** | GitHub webhooks, Slack `#epd`, Jira `COOP` project, Confluence `COOP` space |
| **SSO** | Pre-configured SAML (Okta test app or Azure AD) — optional for first calls |
| **Lightning** | Enabled on primary repo |
| **API base** | `https://api.coopai.dev` (or dedicated demo instance URL) |

---

## Part 1 — Provision the stable demo org

### Prerequisites

| Item | Where |
|------|-------|
| Postgres database | `DATABASE_URL` configured |
| Backend running | `npm run build:backend && npm run start:webhooks` |
| Encryption key | `CREDENTIALS_ENCRYPTION_KEY` set |
| GitHub App or webhook access | For `coop-ai/coop-ai-core` (or chosen repo) |
| Slack/Jira/Confluence sandboxes | Atlassian + Slack test workspaces |

### Step 1: Create org and API key

```bash
cd /workspace
npm run build:admin

# Create enterprise org
npm run admin:org -- create-org "Coop AI Demo" enterprise
# Save orgId from JSON output

# Create primary API key
npm run admin:org -- create-api-key <orgId> demo-primary
# Save rawKey — shown once
```

### Step 2: Create demo users

```bash
npm run admin:org -- create-user <orgId> demo-admin@coop-ai.dev owner
npm run admin:org -- create-user <orgId> demo-engineer@coop-ai.dev member
```

### Step 3: Configure SSO (Enterprise demo)

Use a dedicated Okta/Azure AD test application:

```bash
npm run admin:org -- configure-sso <orgId> okta \
  "http://www.okta.com/exk..." \
  "https://your-org.okta.com/app/.../sso/saml" \
  /path/to/idp-cert.pem
```

**Demo tip:** For calls without SSO setup time, skip SSO and authenticate with API key only. Mention SSO as Enterprise capability and show Settings → "Sign in with SSO" screenshot from `SettingsDetailViews.tsx`.

### Step 4: Enable Lightning on demo repo

```bash
# With API key from step 1
export COOP_API_TOKEN="<rawKey>"
export API_BASE="https://api.coopai.dev"

curl -s -X POST \
  -H "Authorization: Bearer $COOP_API_TOKEN" \
  -H "Content-Type: application/json" \
  "$API_BASE/v1/orgs/repos/github%3Acoop-ai%2Fcoop-ai-core/lightning/enable"
```

Verify status:

```bash
curl -s -H "Authorization: Bearer $COOP_API_TOKEN" \
  "$API_BASE/v1/orgs/repos/github%3Acoop-ai%2Fcoop-ai-core/lightning/status"
```

### Step 5: Seed integration demo data

Follow `docs/integration-onboarding.md` for credential setup, then run seeders:

```bash
cd scripts
cp .env.example .env
# Edit: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, JIRA_*, CONFLUENCE_*
# Set JIRA_DEMO_GITHUB_OWNER=coop-ai and CONFLUENCE_DEMO_GITHUB_OWNER=coop-ai

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

.venv/bin/python populate_jira.py
.venv/bin/python populate_confluence.py
.venv/bin/python populate_slack.py
```

**Seeded artifacts:**

| System | Artifacts |
|--------|-----------|
| Jira | `COOP-101`, `COOP-118`, … with `github:coop-ai/coop-ai-core` references |
| Confluence | Architecture, onboarding, ADR pages in **COOP** space |
| Slack | Decision threads in `#epd` channel |

### Step 6: Configure extension for demo laptop

In VS Code → Coop AI Settings:

| Setting | Value |
|---------|-------|
| CoopAI API key | `<rawKey>` from step 1 |
| API base URL | `https://api.coopai.dev` |
| Repository owner | `coop-ai` |
| Repository repo | `coop-ai-core` |
| GitHub token | PAT with `repo` read access |
| Slack / Jira / Confluence | Credentials for demo workspace |

**Pre-flight:** Run **Test connection**, **Test GitHub**, **Test Slack**, **Test Jira** before every demo.

### Step 7: Store credentials securely (team access)

Maintain demo credentials in the team password manager (1Password / Bitwarden):

| Secret | Notes |
|--------|-------|
| Demo org API key | Rotate quarterly |
| GitHub PAT | Read-only, `coop-ai` org |
| Slack user token (`xoxp-`) | Not bot token — for Trace Decision reads |
| Jira/Confluence API token | Shared Atlassian demo account |
| SSO test user | `demo-engineer@coop-ai.dev` / password in IdP |

> **Do not commit credentials to the repository.**

---

## Part 2 — Demo script (30–45 min)

### Audience tailoring

| Audience | Emphasize | Skip |
|----------|-----------|------|
| **VP Engineering** | Onboarding speed, tribal knowledge, Lightning cross-repo search | BYOK header details |
| **Staff+ IC** | Trace Decision, graph context, inline edit | Pricing |
| **CISO / Security** | Zero-clone, zero-retention, BYOK, no keys in IDE | Quick actions deep dive |
| **Procurement** | Seat model, DPA, SIG Lite | Live coding |

### Act 0 — Setup (before the call, 5 min)

- [ ] Extension connected; repo indexed
- [ ] Lightning status `ready` or `indexing` (start indexing 30 min early if possible)
- [ ] Close unrelated VS Code tabs; open `coop-ai-core` file relevant to scenario
- [ ] Second monitor: security page or architecture diagram optional

---

### Act 1 — The context gap (3 min)

**Talk track:**

> "Every team has the same problem: the code is in GitHub, decisions are in Slack, specs are in Jira, and docs are in Confluence — but your AI tools only see the open file. CoopAI connects the graph across your stack without cloning entire monorepos to every laptop."

**Show:** Enterprise integration graph on [coop-ai.dev/enterprise](https://coop-ai.dev/enterprise) (optional browser tab).

**Key phrase:** *Zero-clone architecture* — metadata indexed server-side via webhooks.

---

### Act 2 — Zero-Clone inquiry (7 min)

**Prompt (paste into chat):**

```
Why was the webhook signature validation changed in the last month? Who owns this area?
```

**What to highlight:**

1. Coop assembles context from **graph + git history + ownership scores** — not just the open file.
2. Response cites **files, authors, and PRs** from remote index.
3. No full repo clone required on the laptop.

**Fallback prompts** (from `HeroExampleCarousel.tsx` patterns):

- *"What would break if I change the auth middleware?"*
- *"Who last touched the job queue executor?"*

---

### Act 3 — Trace Decision (7 min)

**Prompt:**

```
Trace the decision behind COOP-101 — what was discussed in Slack and what's in Jira?
```

**What to highlight:**

1. **Decision archaeology** pulls Slack threads + Jira tickets linked to the repo.
2. Shows the *why* behind code, not just the *what*.
3. Seeded demo data (`COOP-101`, `#epd` threads) makes this reliable.

**If Slack fails:** Show Jira ticket alone and explain Slack token is per-user OAuth (`xoxp-`).

---

### Act 4 — Lightning Mode (7 min)

**Setup:** Open a large cross-package query.

**Prompt:**

```
Find all callers of sanitizeLlmRequestPayload across the repo and summarize the data flow.
```

**What to highlight:**

1. **Lightning** = managed zoekt + scip cloud index (Pro+).
2. Much faster symbol search on large monorepos vs Zero-Clone alone.
3. Backend enqueues index job — no local indexer install.

**Show:** Lightning panel status (enabled / indexing / ready).

**Talk track for security audience:**

> "Lightning indexes symbols and search metadata in Coop's cloud — not a full source copy for browsing. Raw source for chat still comes from scoped context assembly, same as Zero-Clone."

---

### Act 5 — Code creation (5 min)

**Action:** Select a function stub; use inline edit or quick action.

**Prompt:**

```
Add error handling consistent with how other API handlers in this package validate webhook signatures.
```

**What to highlight:**

1. Graph-grounded edits — patterns from *this* codebase, not generic LLM output.
2. Engineer reviews before commit (disclaimers in Terms §9).

---

### Act 6 — Enterprise controls (5 min) — *Security / Enterprise buyers*

**Cover:**

| Control | Demo / reference |
|---------|------------------|
| Zero-retention routing | Show headers in `docs/zero-retention-llm.md` or security page |
| BYOK | Keys on server only; extension has Coop API token only |
| SSO | Settings → Sign in with SSO (or IdP login flow) |
| Compliance attestation | Mention `retentionReport.ts` PDF export |
| DPA | `docs/gtm/dpa-customer-addendum.md` |

**Talk track:**

> "Provider API keys never live in VS Code settings. Developers authenticate with a Coop token; your security team controls LLM routing server-side."

---

### Act 7 — Close (3 min)

**Recap value:**

1. Context across code + decisions + docs
2. Zero-clone + optional Lightning for scale
3. Enterprise controls for regulated environments

**CTA by segment:**

| Segment | CTA |
|---------|-----|
| Pro interest | $20/user/month; book pilot with 5+ seats |
| Enterprise | Custom annual commit; security review + Order Form |
| Developer / beta | Waitlist at `/demo?intent=waitlist` |

**Offer to send:** SIG Lite questionnaire, architecture docs, pricing sheet (`pricing-and-packaging.md`).

---

## Abbreviated demo (15 min)

1. **Act 1** — context gap (2 min)
2. **Act 2** — one Zero-Clone inquiry (5 min)
3. **Act 3** — Trace Decision with COOP-101 (5 min)
4. **Act 7** — close (3 min)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Test connection fails | Check API key, `COOP_REQUIRE_API_AUTH`, backend health `/health` |
| Lightning 403 | Org plan must be `pro` or `enterprise` — `set-plan <orgId> enterprise` |
| Empty graph results | Verify webhooks delivering; check repoId format `github:owner/repo` |
| Slack Trace Decision empty | User token (`xoxp-`) not bot token; user must access `#epd` |
| Jira COOP keys mismatch | Re-run `populate_jira.py` on fresh project or update script keys |
| Slow Lightning | Start indexing before call; show "indexing" as background job story |
| SSO login fails | Check IdP cert path, entity ID, ACS URL in SAML config |

---

## Demo org maintenance

| Task | Cadence |
|------|---------|
| Rotate API keys | Quarterly |
| Re-seed Slack/Jira if threads deleted | As needed |
| Verify Lightning index health | Weekly |
| Update demo repo branch | After major product releases |
| Refresh LLM provider keys on server | Per provider rotation policy |
| Test full script end-to-end | Before conference / major campaign |

---

## Related assets

| Asset | Path |
|-------|------|
| Integration onboarding | `docs/integration-onboarding.md` |
| Jira seeder | `scripts/populate_jira.py` |
| Slack seeder | `scripts/populate_slack.py` |
| Confluence seeder | `scripts/populate_confluence.py` |
| Admin CLI | `scripts/admin-org.ts` |
| Marketing demo stories | `website/src/lib/demoStories.ts` |
| Pricing talk track | `docs/gtm/pricing-and-packaging.md` |
| Security questionnaire | `docs/gtm/security-questionnaire-sig-lite.md` |
