# Free-tier admin onboarding — handoff & Pro portal plan

**Created:** July 1, 2026  
**Updated:** July 9, 2026  
**Branch shipped:** `feat/in-product-onboarding` → merged to `main` (`9a78209`)  
**Purpose:** Document everything built for free-user onboarding and admin portal structure in this workstream, and provide a plan for finishing the **Pro** admin portal without repeating enterprise work.

**Related docs**

- [in-product-onboarding-spec.md](./in-product-onboarding-spec.md) — original spec (some references are stale; see § Stale references)
- [in-product-onboarding-smoke-test.md](./in-product-onboarding-smoke-test.md) — smoke checklist
- [integration-scope-agent-runbook.md](./integration-scope-agent-runbook.md) — scope governance backend
- [deploy-self-serve-pro.md](./deploy-self-serve-pro.md) — Stripe → Pro provisioning

---

## 1. Executive summary

### What we shipped

A **solo-developer free tier** with:

- Self-serve signup at [coop-ai.dev/signup/free](https://coop-ai.dev/signup/free)
- Password + Google auth into the admin portal
- A **distinct onboarding wizard** (connect → index 3 repos → install extension)
- Quota metering and upgrade CTAs on the dashboard
- Integration scope UI shared with enterprise (modal, not a separate panel)
- Backend enforcement: 3-repo Deep-Index cap, rolling AI credit quota

### The repeat-work problem

When building free-tier admin, several enterprise patterns already existed but were **reimplemented or forked**:

| Enterprise already had | Free tier added (parallel) |
|------------------------|----------------------------|
| `OnboardingScopeStep` + verify flow | Separate free-only indexing + extension steps |
| `IntegrationScopeModal` (replaced old panel) | Docs still reference deleted `IntegrationScopePanel` |
| Team invites, collections, unlimited indexing | Free-specific gates scattered as `plan === "free"` |
| `resolveIntegrationScope` enforcement | Pro inherits optional scope; free has no scope step |

**For Pro admin:** reuse the **enterprise path** (connect → access → invite → verify). Do **not** fork free-tier patterns (quota meter, 3-repo picker, extension step).

---

## 2. Admin portal architecture (current)

### Shell & routing

| Piece | Path | Role |
|-------|------|------|
| Layout | `admin/src/app/(admin)/layout.tsx` | Wraps admin routes |
| Shell | `admin/src/components/AdminShell.tsx` | Auth guard, member redirect, onboarding overlay |
| Sidebar | `admin/src/components/Sidebar.tsx` | Nav; hides Collections for free |
| Onboarding | `admin/src/components/OnboardingProvider.tsx` | First-run wizard + resume banner |
| Plan model | `admin/src/lib/planCapabilities.ts` | **Single source of truth for tier flags** (partially adopted) |

### Admin pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — stats, integration status, free quota + upgrade CTA |
| `/integrations` | Connect/disconnect tools; scope modal per provider |
| `/indexing` | Repo catalog, Lightning enable/disable, estate sync |
| `/collections` | Pro/Enterprise only — repo groupings |
| `/users` | Team invites (blocked on free) |
| `/analytics` | Chat + completion analytics |
| `/api-keys` | Org API key management |
| `/billing` | Stripe portal, upgrade checkout |
| `/audit` | Audit log |
| `/settings` | Settings hub — links to nested routes below |
| `/settings/account` | Account, org info, sign-out (all roles) |
| `/settings/repository-access` | Per-user vs all-indexed repo access mode (Pro/Ent admin) |
| `/settings/single-sign-on` | SAML IdP config, **Test sign-in**, sign-in policy — Enterprise admin (`sso_required_active` guard) |
| `/feed` | Member chat thread browser |

### Auth (added for free tier)

| Route / file | Purpose |
|--------------|---------|
| `admin/src/app/login/page.tsx` | Email/password + Google |
| `admin/src/app/forgot-password/page.tsx` | Password reset |
| `admin/src/app/api/auth/login/route.ts` | Cookie session proxy |
| `admin/src/app/api/auth/logout/route.ts` | Session clear |
| `admin/src/app/api/auth/session/route.ts` | Session check |
| `admin/src/lib/auth.ts` | Stored me, admin vs member roles |

**Role gating:** Admins see full nav (minus Collections on free). Members only see `/feed` and `/settings` (hub + `/settings/account`).

---

## 3. Plan tier behavior matrix

Authoritative flags in `admin/src/lib/planCapabilities.ts`:

| Capability | Free | Pro | Enterprise |
|------------|------|-----|------------|
| `showCollections` | false | true | true |
| `teamInvites` | false | true | true |
| `showUsageQuota` | true | false | false |
| `indexedRepoLimit` | 3 | null (unlimited) | null |
| `showOnboardingIndexingStep` | true | false | false |
| `showOnboardingExtensionStep` | true | false | false |
| `showOnboardingTeamStep` | false | true | true |
| `showOnboardingVerifyStep` | false | true | true |
| `showEnterpriseScopeStep` | false | false | true (**defined but unused in UI**) |

### Onboarding wizard steps (actual)

Defined in `admin/src/components/OnboardingWizard.tsx` via `ONBOARDING_STEP_DEFS`:

| Step ID | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Welcome | ✓ (solo-dev copy) | ✓ (org copy) | ✓ |
| Connect (`IntegrationsStep`) | ✓ | ✓ | ✓ |
| Index repos | ✓ | — | — |
| Manage access (`OnboardingScopeStep`) | — | ✓ optional | ✓ (Slack gate enforced) |
| Invite team | — | ✓ | ✓ |
| Verify (`OnboardingVerifyStep`) | ✓ | ✓ | ✓ |
| Extension install | ✓ | — | — |
| Done | ✓ | ✓ | ✓ |

**Pro already uses the enterprise onboarding path** for scope → invite → verify. Free is the outlier.

### Backend plan rules

| Rule | Free | Pro | Enterprise |
|------|------|-----|------------|
| Signup | `POST /v1/signup/free` | Stripe checkout | Stripe / sales |
| Team invites | Blocked | Allowed | Allowed |
| Indexed repos | Max 3 | Unlimited | Unlimited |
| Auto-index on catalog sync | No | Yes | Yes |
| Usage quota API | `GET /v1/admin/quota` | `unlimited: true` | `unlimited: true` |
| Scope enforcement (runtime) | No | No (optional UI) | Yes |
| SAML SSO | No | No | Yes |

---

## 4. Files shipped in this workstream

### Commits

| SHA | Message |
|-----|---------|
| `8c3ea39` | Ship integration scope enforcement, free-tier signup, and quota UX |
| `9a78209` | Merge feat/in-product-onboarding into main for production release |

Prior commits on the same branch (already on main before final day): admin chat feed, free-tier portal polish, marketing light theme, onboarding wizard embed, integration health endpoint, etc.

### Admin portal — new files

| File | Purpose |
|------|---------|
| `admin/src/app/error.tsx` | Route error boundary |
| `admin/src/app/global-error.tsx` | Global error boundary |
| `admin/src/components/FeedChatProse.tsx` | Chat prose rendering on `/feed` |
| `admin/src/components/IndexingRepoPickerModal.tsx` | Batch repo picker (free 3-repo workflow) |
| `admin/src/components/IntegrationScopeModal.tsx` | **Replaces** deleted `IntegrationScopePanel.tsx` |
| `admin/src/lib/chatProse.ts` | Prose block types |
| `admin/src/lib/chatProseParser.ts` | Prose parser |
| `admin/src/lib/chatProseTypes.ts` | Prose TypeScript types |
| `admin/src/hooks/useOrgPlan.ts` | Plan + capabilities hook for dashboard |

### Admin portal — modified files

| File | Changes |
|------|---------|
| `admin/src/app/(admin)/page.tsx` | Free: `UsageQuotaMeter`, `UpgradeCTA`; uses `useOrgPlan` |
| `admin/src/app/(admin)/indexing/page.tsx` | 3-repo cap, picker modal, plan-aware disable |
| `admin/src/app/(admin)/integrations/page.tsx` | IntegrationsStep wiring |
| `admin/src/app/(admin)/settings/page.tsx` | Account/org layout polish |
| `admin/src/app/(admin)/feed/page.tsx` | Chat feed prose |
| `admin/src/app/globals.css` | Admin design tokens, chips, panels |
| `admin/src/components/IndexingRepoSections.tsx` | `indexedRepoLimit` gating |
| `admin/src/components/IntegrationCard.tsx` | Scope modal trigger, plan badges |
| `admin/src/components/IntegrationStatusList.tsx` | Dashboard integration summary |
| `admin/src/components/IntegrationsStep.tsx` | Onboarding + integrations page shared step |
| `admin/src/components/OnboardingScopeStep.tsx` | Scope step in wizard |
| `admin/src/components/OnboardingWizard.tsx` | Plan-aware step defs, free vs org copy |
| `admin/src/components/OnboardingProvider.tsx` | Wizard overlay + resume banner |
| `admin/src/components/UpgradeCTA.tsx` | Free → Pro checkout CTA |
| `admin/src/components/UsageQuotaMeter.tsx` | Rolling credit window display |
| `admin/src/lib/coopApi.ts` | Quota, scope, health, signup helpers |
| `admin/src/lib/integrationErrors.ts` | Shared error copy |
| `admin/src/lib/integrations.ts` | Provider list, scope types |

### Backend — new files

| File | Purpose |
|------|---------|
| `src/server/freeSignupApi.ts` | `POST /v1/signup/free` — org + user + password identity |
| `src/server/freeSignupApi.test.ts` | Signup tests |
| `src/integrationScope/atlassianQuery.ts` | Jira/Confluence scope query filters |
| `src/integrationScope/notionQuery.ts` | Notion scope filters |
| `src/integrationScope/googleDocsQuery.ts` | Google Docs folder scope filters |
| `src/integrationScope/*.test.ts` | Scope query unit tests |
| `src/license/planSearchScope.ts` | Plan-based search scope |
| `src/chat/quotaNotice.ts` | Free quota exhausted UX helpers |
| `src/chat/chatMessageIntent.ts` | Chat intent detection |

### Backend — modified files (admin-relevant)

| File | Changes |
|------|---------|
| `src/server/adminIntegrationScopeApi.ts` | Scope CRUD, resource listing, test endpoint |
| `src/server/resolveIntegrationScope.ts` | Enterprise enforcement; Pro optional |
| `src/server/planQuota.ts` | Free rolling token cap |
| `src/server/indexedRepoQuota.ts` | 3-repo cap on free |
| `src/server/orgApi.ts` | Onboarding completion, org metadata |
| `src/server/users/userStore.ts` | `findActiveUserByEmail` |
| `src/server/billing/billingApi.ts` | Upgrade checkout session |
| `src/server/email/emailService.ts` | Welcome email for free signup |
| `src/webhooks/webhookServer.ts` | Route registration for signup + scope APIs |

### Website — free signup

| File | Purpose |
|------|---------|
| `website/src/app/signup/free/page.tsx` | Free signup form (light theme) |
| `website/src/app/api/signup/free/route.ts` | Proxies to `POST /v1/signup/free` |
| `website/content/manual/index.md` | Free signup + prompt library docs |

### Extension (quota UX tied to free tier)

| File | Purpose |
|------|---------|
| `src/webview/components/QuotaExceededNotice.tsx` | In-chat quota banner |
| `src/chat/CoopChatSession.ts` | Quota check before send |
| `src/webview/components/PromptDetailOverlay.tsx` | Prompt library detail |
| `src/webview/lib/inferPromptActionId.ts` | Slash command inference |

### Config / tooling

| File | Changes |
|------|---------|
| `.env.backend.example` | `NOTION_INTEGRATION_TOKEN` documented |
| `.gitignore` | Exclude macOS duplicate files (`* 2.*`, `* 3.*`, `* 4.*`) |
| `tsconfig.webview.json`, `tsconfig.backend.json` | Exclude duplicate backup files from tsc |
| `package.json` | New test scripts for scope + quota |

### Deleted

| File | Replaced by |
|------|-------------|
| `admin/src/components/IntegrationScopePanel.tsx` | `IntegrationScopeModal.tsx` |

---

## 5. API endpoints (admin + free signup)

### Free signup

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/signup/free` | Create free org, owner user, password identity, API key |
| `POST` | `website/api/signup/free` | Website proxy to backend |

### Admin — plan & quota

| Method | Path | Free | Pro/Ent |
|--------|------|------|---------|
| `GET` | `/v1/admin/org` | ✓ | ✓ |
| `GET` | `/v1/admin/quota` | Rolling usage | `{ unlimited: true }` |
| `POST` | `/v1/billing/upgrade-checkout-session` | Free → Pro | Pro → Enterprise |

### Admin — integrations & scope

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/admin/integrations` | Connection status per provider |
| `GET` | `/v1/admin/integrations/health` | Onboarding verify step |
| `DELETE` | `/v1/admin/integrations/{provider}` | Disconnect |
| `GET/PUT` | `/v1/admin/integrations/{provider}/scope` | Read/write scope policy |
| `GET` | `/v1/admin/integrations/{provider}/resources` | Scope picker resource list |
| `POST` | `/v1/admin/integrations/{provider}/test` | Test scoped search |

### Admin — indexing

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/v1/orgs/repos` | Repo catalog |
| `POST` | `/v1/orgs/estate/sync` | Enterprise estate sync |
| `POST` | `/v1/orgs/repos/{id}/lightning/enable` | Deep-Index enable |
| `POST` | `/v1/orgs/repos/{id}/lightning/disable` | Deep-Index disable |

Free orgs: backend enforces max 3 enabled repos via `indexedRepoQuota.ts`.

---

## 6. Key components — reuse map

Use this when building Pro admin to avoid duplicate work.

| Component | Tier | Reuse for Pro? |
|-----------|------|----------------|
| `IntegrationsStep` | All | **Yes** — shared connect UI |
| `IntegrationCard` | All | **Yes** — fix plan gates, don't fork |
| `IntegrationScopeModal` | All | **Yes** — scope UI (optional on Pro, enforced on Enterprise) |
| `OnboardingScopeStep` | Pro/Ent | **Yes** — Pro onboarding |
| `OnboardingVerifyStep` | Pro/Ent | **Yes** — health check table |
| `OnboardingWizard` | All | **Extend** — don't create Pro-specific wizard |
| `IndexingRepoSections` | All | **Yes** — Pro uses unlimited + auto-sync |
| `IndexingRepoPickerModal` | Free | **No** — free-only 3-repo picker |
| `UsageQuotaMeter` | Free | **No** — free-only |
| `UpgradeCTA` | Free | **No** on Pro dashboard |
| `PlanUpgradeNotice` | Free (users page) | **No** on Pro |
| `/collections` page | Pro/Ent | **Yes** — already built |
| `/users` page | Pro/Ent | **Yes** — add seat limits, don't rebuild |

---

## 7. Known drift & anti-patterns

### Stale references

- `docs/in-product-onboarding-spec.md` still mentions `IntegrationScopePanel` — use `IntegrationScopeModal`.
- `admin/README.md` may omit `/indexing`, `/collections`, `/feed`.

### Onboarding step label mismatch

`OnboardingProvider.tsx` hardcodes:

```ts
const FREE_STEP_LABELS = ["Welcome", "Connect", "Index repos", "API key", "Done"];
const FULL_STEP_LABELS = ["Welcome", "Connect tools", "Manage access", "Invite team", "Verify", "Done"];
```

But `OnboardingWizard.tsx` uses dynamic `stepsForPlan()` — free has **Extension** step, not **API key**. Resume banner will show wrong labels.

### Scattered plan checks

Several files use `plan === "free"` instead of `planCapabilities(plan)`:

- `admin/src/app/(admin)/indexing/page.tsx`
- `admin/src/app/(admin)/users/page.tsx`
- `admin/src/components/IntegrationCard.tsx`

### GitLab/Bitbucket policy inconsistency

Three different policies exist:

- `planGates.ts` — may include Pro
- `catalogSyncService.ts` — blocks Pro sync
- `IntegrationCard.tsx` — UI blocks Pro

Pick **one source of truth** before Pro launch.

### Duplicate macOS backup files

Pattern `* 2.*`, `* 3.*`, `* 4.*` under `admin/src/` and elsewhere — gitignored for new files but may still exist locally. Risk of editing wrong copy.

---

## 8. Pro admin portal — recommended plan

**Goal:** Finish Pro admin by **extending enterprise components**, not rebuilding free-tier forks.

### Phase 1 — Centralize plan gating (S, ~1–2 days)

| Action | Files |
|--------|-------|
| Extend `PlanCapabilities` with Pro flags: `showGitLabBitbucket`, `autoIndexOnCatalogSync`, `scopeEnforced`, `showSeatLimits` | `admin/src/lib/planCapabilities.ts` |
| Replace hardcoded `plan === "free"` checks | `indexing/page.tsx`, `users/page.tsx`, `IntegrationCard.tsx`, `page.tsx` |
| Export shared `onboardingStepsForPlan()` used by wizard **and** provider | `OnboardingWizard.tsx`, `OnboardingProvider.tsx` |
| Delete local `* 2.*` duplicate files if present | `admin/src/**` |

**Reuse:** existing `planCapabilities.ts`. **Do not build** a new plan module.

### Phase 2 — Pro onboarding = enterprise path (M, ~2–3 days)

| Action | Files |
|--------|-------|
| Pro steps: Welcome → Connect → Access (optional) → Invite → Verify → Done | `OnboardingWizard.tsx` |
| Fix resume banner to use shared step list | `OnboardingProvider.tsx` |
| Scope step: reuse `OnboardingScopeStep` + `IntegrationScopeModal`; copy says "optional" on Pro | existing components |
| Verify: reuse `OnboardingVerifyStep` + `fetchIntegrationsHealth` | no new component |

**Do NOT build:** new scope panel, new verify table, free indexing/extension steps for Pro.

### Phase 3 — Pro indexing & integrations (M, ~2–3 days)

| Action | Files |
|--------|-------|
| **Decision:** GitLab/Bitbucket on Pro — enable or document Enterprise-only everywhere | `IntegrationCard.tsx`, `catalogSyncService.ts`, `planGates.ts` |
| Pro indexing: `IndexingRepoSections` after sync; rely on `autoIndexOnCatalogSync` | `indexing/page.tsx` |
| Keep `IndexingRepoPickerModal` **free-only** | `indexing/page.tsx` |

### Phase 4 — Pro team & billing polish (S–M, ~1–2 days)

| Action | Files |
|--------|-------|
| Extend `fetchUsers` to surface `seats`, `seatsUsed` (backend already returns them) | `coopApi.ts` |
| Users page: "X of Y seats used"; block invite at limit | `users/page.tsx` |
| Pro dashboard: seat utilization stat | `page.tsx` |
| Hide free `UpgradeCTA` when `plan === "pro"` | `page.tsx` |

### Phase 5 — Docs & cleanup (S, ~0.5 day)

| Action | Files |
|--------|-------|
| Update tier matrix in admin README + website admin docs | `admin/README.md`, `website/content/docs/` |
| Fix `IntegrationScopePanel` → `IntegrationScopeModal` in specs | `docs/in-product-onboarding-spec.md` |
| Document Pro vs Enterprise: scope enforced only on Enterprise | docs + `resolveIntegrationScope.ts` |

---

## 9. Pro vs Enterprise — what Pro already has

Pro admins **already get** (no new build required):

- Full `/integrations` page with optional scope UI
- Team invites on `/users`
- `/collections` repo groupings
- Unlimited Deep-Index (no 3-repo cap)
- Analytics, audit, API keys, billing portal
- Enterprise-style onboarding (scope → invite → verify)
- `EnterpriseUpgradeRequestForm` for Pro → Enterprise sales handoff

### What Pro still needs (gaps)

| Gap | Priority |
|-----|----------|
| Centralized plan gating (stop scattered `plan === "free"`) | High |
| Onboarding resume banner step labels | Medium |
| GitLab/Bitbucket policy alignment | High |
| Seat limit UI on Users page | Medium |
| Pro dashboard differentiation (seats, team setup CTA) | Low–Medium |
| Collections page stale copy | Low |

---

## 10. Smoke test pointers

After Pro work, verify:

1. **Browser** — Stripe Pro checkout → admin portal → onboarding shows Connect → Access → Invite → Verify (no Index repos / Extension steps)
2. **Browser** — `/indexing` — unlimited repos, auto-sync after GitHub connect
3. **Browser** — `/users` — invite works; seat limit shown
4. **Browser** — `/collections` — accessible (not redirected to dashboard)
5. **Browser** — Free org unchanged: quota meter, 3-repo cap, upgrade CTA

See [in-product-onboarding-smoke-test.md](./in-product-onboarding-smoke-test.md) for free-tier baseline.

---

## 11. Quick reference — where to start for Pro work

| Task | Start here |
|------|------------|
| Plan flags | `admin/src/lib/planCapabilities.ts` |
| Onboarding flow | `admin/src/components/OnboardingWizard.tsx` |
| Resume banner fix | `admin/src/components/OnboardingProvider.tsx` |
| Integrations | `admin/src/components/IntegrationsStep.tsx` → `IntegrationCard.tsx` |
| Scope UI | `admin/src/components/IntegrationScopeModal.tsx` |
| Indexing | `admin/src/app/(admin)/indexing/page.tsx` |
| Team/seats | `admin/src/app/(admin)/users/page.tsx`, `src/server/adminUsersApi.ts` |
| Backend scope rules | `src/server/resolveIntegrationScope.ts` |
| Repo limits | `src/server/indexedRepoQuota.ts` |

**Rule of thumb:** If enterprise already has it, Pro inherits it. Only free tier gets custom UX (quota, 3-repo picker, extension step).
