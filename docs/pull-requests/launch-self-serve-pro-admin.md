# PR: launch/self-serve-pro-admin → main

**Status:** ✅ Merged (PR #3 → `8389bc2`)  
**Follow-up CI:** ✅ Merged (PR #4 → `41323f5`)  
**Branch:** deleted (`launch/self-serve-pro-admin`, `launch/ci-workflow`)

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

### Follow-up (completed)

- **`.github/workflows/ci.yml`** — merged in PR #4; GitHub Actions green on `main`

## Smoke test checklist (Local Test Org)

- [x] **A1** — `@` picker + cross-repo mention (Platform Team collection; zoekt/scip indexed)
- [x] **B** — Admin analytics (overview, chat, Lightning repos, users, CSV export)
- [x] **C** — Autocomplete enabled in editor; Completions tab shows `usage_events` (0 until Coop provider accepts)
- [x] **D** — Seat limit: second invite returns `seat_limit_reached`
- [x] Integrations: Jira OAuth test after scope fix; admin integrations page shows connected providers

## Test plan

- [x] `docker compose up -d --build api worker && ./scripts/migrate.sh`
- [x] `cd admin && npm install && npm run dev` — sign in with org API key; verify analytics + users
- [x] Extension dev host: `@` mention, autocomplete toggle, Test connection
- [x] `npm run lint` / CI (PR #4 on `main`)
- [x] Invite over seat cap → `seat_limit_reached`

## Remaining (operator — not this PR)

- [ ] Production deploy per [deploy-self-serve-pro.md](../deploy-self-serve-pro.md)
- [ ] Stripe live keys + webhook on `api.coop-ai.dev`
- [ ] Resend + DNS on `coop-ai.dev`; `COOP_EMAIL_MOCK=false`
- [ ] Deploy admin (`admin.coop-ai.dev`) and website (Vercel env vars)
- [ ] Production OAuth Connect per [connect-integrations-production.md](../connect-integrations-production.md)
- [ ] Rotate any `coop_` API keys pasted during local dev

## Migration notes

```bash
./scripts/migrate.sh
```

New migrations: `013_org_billing.sql`, `014_usage_events.sql`, `015_stripe_webhook_events.sql`.
