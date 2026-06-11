# PR: launch/self-serve-pro-admin → main

**Branch:** `launch/self-serve-pro-admin`  
**Commit:** `339e4fb`  
**Open:** https://github.com/raneyja/Coop-AI/compare/main...launch/self-serve-pro-admin?expand=1

## Summary

Launch infrastructure for self-serve Pro: org admin portal, usage telemetry with seat enforcement, Lightning cross-repo `@` mentions, autocomplete fixes, billing/Stripe/Resend scaffolding, migrations, and operator documentation.

Validated locally via Agent Launch Playbook smoke tests (Tests A1–D).

### Admin portal (`admin/`)

- Next.js org console on port 3001: dashboard, integrations, collections, users, API keys, billing, audit, settings
- **Analytics** tabs: overview, chat/actions, Lightning repo status, completions (wired to `usage_events`), integrations, users
- API-key auth against `/v1/admin/*` endpoints

### Backend

- `usage_events` + `UsageTracker`; `POST /v1/usage/events` from extension
- Admin APIs: analytics, users (invite + seat limit), integrations status, org billing stubs
- Stripe checkout/webhook scaffolding (`migrations/013–015`, `scripts/migrate.sh`)
- Resend welcome/invite email service (mock locally without `RESEND_API_KEY`)
- Org OAuth apps: Notion, Google Docs, Teams (backend); CORS for admin + marketing origins
- **Lightning / indexing:** Zoekt indexer job, mention-scoped search API, worker esbuild/tree-sitter fixes
- **Jira OAuth:** test connection uses issue search (`read:jira-work`) instead of `/myself` (`read:jira-user`)

### Extension

- `@` picker: repo-scoped results, dedupe, empty-state UX
- Autocomplete: toggle sync on webview load; explicit enable/disable (fixes double-disable bug)
- Completion accept/reject usage events

### Website

- Signup, welcome, and checkout API routes for Stripe funnel

### Docs

- `docs/agent-launch-playbook.md`, production readiness, enterprise onboarding, deploy-self-serve-pro, connect-integrations-production

### Follow-up (not in this push)

- **`.github/workflows/ci.yml`** is present locally but omitted from this branch push because the git credential lacks the `workflow` OAuth scope. Add in a follow-up commit with a workflow-scoped token or via GitHub UI.

## Smoke test checklist (Local Test Org)

- [x] **A1** — `@` picker + cross-repo mention (Platform Team collection; zoekt/scip indexed)
- [x] **B** — Admin analytics (overview, chat, Lightning repos, users, CSV export)
- [x] **C** — Autocomplete enabled in editor; Completions tab shows `usage_events` (0 until Coop provider accepts)
- [x] **D** — Seat limit: second invite returns `seat_limit_reached`
- [x] Integrations: Jira OAuth test after scope fix; admin integrations page shows connected providers

## Test plan

- [ ] `docker compose up -d --build api worker && ./scripts/migrate.sh`
- [ ] `cd admin && npm install && npm run dev` — sign in with org API key; verify analytics + users
- [ ] Extension dev host: `@` mention, autocomplete toggle, Test connection
- [ ] `npm run lint` / CI (after workflow file lands)
- [ ] Invite over seat cap → `seat_limit_reached`

## Migration notes

```bash
./scripts/migrate.sh
```

New migrations: `013_org_billing.sql`, `014_usage_events.sql`, `015_stripe_webhook_events.sql`.
