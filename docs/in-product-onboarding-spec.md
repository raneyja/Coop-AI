# In-product integration onboarding — implementation spec

**Status:** Agent 1 research deliverable  
**Updated:** July 9, 2026  
**Branch:** `feat/in-product-onboarding`  
**Goal:** Customer org admins complete Connect → scope → invite → verify **inside the product** (admin portal + extension), without doc-hopping or visible operator steps.

**Related:** [in-product-onboarding-agent-runbook.md](./in-product-onboarding-agent-runbook.md), [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md), [slack-connect.md](./slack-connect.md), [integration-scope-smoke-test.md](./integration-scope-smoke-test.md)

---

## 1. User stories

### Platform operator (hosted — hidden from customers)

- As a Coop operator, I register OAuth apps once in vendor consoles and set `.env.backend` on the API host so install-url endpoints return URLs instead of 503.
- I do **not** appear in the customer onboarding wizard; failures surface as actionable in-product copy (“Contact your Coop administrator”) only when the server is misconfigured.
- Success: `GET /health` returns ok; each `GET /v1/{provider}/app/install-url` returns `{ url }` for configured providers.

### Org admin (`canInstallIntegrations: true`)

- As an org admin signing into the **admin portal** for the first time, I see a setup wizard on the dashboard that lets me connect integrations, configure Enterprise Slack scope, invite teammates, and verify health — without leaving the portal for `/integrations`.
- As an org admin using the **extension**, I see a first-run checklist (Account → Tools status → Workspace) with a deep link to the admin portal for scope configuration I cannot do in VS Code.
- I can mark onboarding complete only when required gates pass (see §7 acceptance criteria).
- Success: `onboardingCompleted` is true; GitHub connected; Enterprise Slack scope **Active** when Slack is connected.

### Developer (`canInstallIntegrations: false`)

- As a developer, I sign in with email/password, Google, or org SSO, set workspace repo defaults, and use chat — I never see Connect buttons or PAT fields in production mode.
- If integrations are missing, I see “Ask your org admin” messaging (existing behavior).
- Success: chat works when admin has connected tools; no connect affordances in Settings.

---

## 2. Current state vs target

### What exists today

| Step | Surface today | In-product? |
|------|---------------|-------------|
| Operator OAuth app + env | `.env.backend`, vendor consoles | Hidden (correct) |
| Admin sign-in | Admin portal `/login` (email/password, Google, SSO), extension Account | Yes |
| Enterprise SAML SSO | Admin **Settings → Single sign-on** (`/settings/single-sign-on`) — IdP config, **Test sign-in**, **Require SSO** policy | Yes (Enterprise) |
| Connect integrations | Extension Settings → Tools **or** admin `/integrations` | Partial — wizard links out |
| Enterprise Slack scope | Admin `/integrations` → Manage access | Yes, but not in wizard |
| Invite users | Admin `/users` | Partial — wizard links out |
| Issue automation API keys | Admin `/api-keys` (CI/scripts only) | Yes (manual nav) |
| Verify / Test | Extension per-tool Test; admin scope Test | Partial — no aggregated health |
| Mark onboarding done | Wizard “Finish setup” (no gates) | Yes but too permissive |

### Admin portal surfaces

| Component | Role |
|-----------|------|
| `OnboardingWizard` | 4 steps; step 1 links to `/integrations` instead of inline connect |
| `integrations/page.tsx` | Full `IntegrationCard` list with Connect, scope, refresh |
| `settings/page.tsx` + nested routes | Settings hub; Enterprise SAML at `/settings/single-sign-on` (`SsoSettingsPanel`) |
| `IntegrationCard` | OAuth via `fetchInstallUrl`, scope via `IntegrationScopePanel` |
| `IntegrationScopePanel` | Slack (live); Jira/Notion/Google UI with enforcement coming |
| Dashboard `IntegrationStatusList` | Read-only status summary |

### Extension surfaces

| Component | Role |
|-----------|------|
| `SettingsHub` | Account, Tools, Workspace, Preferences |
| `SettingsDetailViews` | Per-integration `IntegrationConnectionShell` + Connect/Test |
| `CoopChatSession` | Gates Connect on `canInstallIntegrations` |
| PAT / dev token fields | Shown only when `prefs.devMode` |

### API today

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/admin/integrations` | Bulk status: `installed`, `scopeStatus`, `scopeSummary`, `needsReconnect`, `scopeNeedsReconnect` |
| `GET /v1/admin/org` | `onboardingCompleted`, basic `integrationSummary` (installed list only) |
| `POST /v1/admin/onboarding/complete` | Sets `onboardingCompletedAt` (no validation) |
| `POST /v1/admin/integrations/{provider}/test` | Per-provider scoped test (Slack, Atlassian, Notion, Google) |
| `adminIntegrationTest.ts` | Code-host + integration test helpers (not wired to bulk endpoint) |

---

## 3. Wizard flow (wire narrative)

Replace current 4-step wizard with **6 steps** (Verify is explicit; Done is final).

```
Welcome → Connect → Scope → Invite → Verify → Done
```

### Step 0 — Welcome

- Copy: “Connect your tools once — every developer inherits access.”
- Primary: **Continue**
- No API calls.

### Step 1 — Connect tools (inline)

- Embed a **compact** integration list (reuse `IntegrationCard` logic via shared `IntegrationsStep` component).
- Show all providers from `INTEGRATIONS`; same Connect / Refresh / Disconnect / badges as `/integrations`.
- **Do not** link to `/integrations` as the primary action (secondary link “Open full integrations page” is OK).
- After OAuth in new tab, admin clicks **Refresh** on the row (existing pattern).
- Footer:
  - **Continue** enabled when GitHub is connected **or** admin clicks **Skip for now** (GitHub recommended, not hard-required for Pro/Free without code hosts).
  - Show inline hint if any connected scopable integration on Enterprise still shows **Scope required** (points to next step).

### Step 2 — Manage access (Enterprise scope)

- Shown for **Enterprise** orgs when Slack is connected.
- Inline prompt: “Choose which Slack channels Coop can search.”
- Primary: **Manage Slack access** opens existing `IntegrationScopePanel` modal (same as IntegrationCard).
- If Slack not connected: skip message + **Continue**.
- If Slack connected + scope **Active**: green check + **Continue**.
- If Slack connected + **Scope required**: block **Continue** until scope saved (or offer **Skip** with warning — spec chooses **block** for Enterprise Slack when connected).
- Jira/Notion/Google: one-line “Coming soon” stub (Phase D optional polish); do not block wizard.
- Pro/Free: auto-skip step (no scope gate).

### Step 3 — Invite team

- Embed lightweight invite UI **or** keep link to `/users` with inline status:
  - Preferred MVP: keep **Invite users** link to `/users` plus show `memberCount` from `fetchOrg()` / `fetchUsers()`.
  - Optional enhancement (out of Phase A): inline email invite field reusing `inviteUser()`.
- **Continue** / **Skip**.

### Step 4 — Verify

- Call new **`GET /v1/admin/integrations/health`** (see §5).
- Show per-integration row: name, status chip (`healthy` | `degraded` | `not_connected` | `scope_required` | `not_configured`), last test message.
- **Test all** button runs health fetch with `?refresh=true` (server runs tests for connected integrations).
- Surface user-facing error strings (§8) instead of raw API errors.
- **Continue** when:
  - At least GitHub **or** one collaboration tool connected, **and**
  - No `not_configured` for a connected provider, **and**
  - Enterprise: if Slack connected → scope **active**.

### Step 5 — Done

- Summary: connected count, scope status, link to invite users.
- **Finish setup** → `POST /v1/admin/onboarding/complete` → hide wizard.

---

## 4. Extension checklist (Phase C)

### When to show

- User has `canInstallIntegrations === true`
- `coopAI.devMode === false`
- Org `onboardingCompleted === false` (new field on `GET /v1/me` or derived client-side from admin API if extension already has org context)
- Dismissible per session; reappears until onboarding complete or user dismisses 3× (store in `globalState` key `coop.adminOnboarding.dismissCount`)

### Where

- Banner at top of **Settings hub** (`SettingsHub.tsx`) using `CoopNotice` + `coop-notice--info`.

### Checklist items

| # | Item | In extension | Deep link |
|---|------|--------------|-----------|
| 1 | Sign in | Account → email/password or Google → Test connection | — |
| 2 | Connect tools | Tools list subtitles show status | Admin portal `/integrations` for bulk connect |
| 3 | Slack scope (Enterprise) | Read-only hint if scope required | `{adminPortalUrl}/integrations` (Manage access) |
| 4 | Workspace defaults | Workspace → owner/repo/branch | — |
| 5 | Invite developers | Copy: invite teammates from admin Users page | `{adminPortalUrl}/users` |

### PAT / dev token fields

- Already gated on `prefs.devMode` in `SettingsDetailViews` — **no change** except verify checklist does not mention tokens.

### Admin portal URL

- Add `adminPortalUrl` to extension preferences (from `GET /v1/me` field `adminPortalUrl`, sourced from server `COOP_ADMIN_PORTAL_URL` / billing config).
- Fallback: `https://admin.coop-ai.dev`.

---

## 5. API contract

### 5.1 Extend `GET /v1/admin/integrations` (optional, minimal)

No change required for Phase A; existing fields suffice for wizard Connect + scope steps.

### 5.2 New `GET /v1/admin/integrations/health`

**Auth:** org admin (same as other `/v1/admin/*`).

**Query:**

| Param | Type | Description |
|-------|------|-------------|
| `refresh` | `boolean` | If `true`, run live tests for connected integrations |

**Response 200:**

```json
{
  "orgPlan": "enterprise",
  "onboardingGates": {
    "githubOrToolConnected": true,
    "slackScopeActive": true,
    "canCompleteOnboarding": true
  },
  "integrations": [
    {
      "provider": "github",
      "installed": true,
      "health": "healthy",
      "message": "GitHub API reachable.",
      "scopeStatus": "none",
      "configured": true
    },
    {
      "provider": "slack",
      "installed": true,
      "health": "healthy",
      "message": "Scoped Slack search succeeded (3 recent hits…).",
      "scopeStatus": "active",
      "configured": true
    }
  ]
}
```

**Health enum:**

| Value | Meaning |
|-------|---------|
| `not_connected` | Not installed |
| `not_configured` | Server missing OAuth env (install-url would 503) |
| `scope_required` | Connected, Enterprise, scopable, policy not active |
| `degraded` | Connected but test failed or needs reconnect |
| `healthy` | Connected and test passed (or scope test passed for Slack) |

**Implementation:** New handler in `adminIntegrationsApi.ts`; reuse `testAdminIntegration()` from `adminIntegrationTest.ts` when `refresh=true`. For `not_configured`, probe install-url builder without redirect (or catch 503 from existing app service helpers).

### 5.3 Extend `GET /v1/me`

Add optional fields for extension checklist:

```json
{
  "onboardingCompleted": false,
  "adminPortalUrl": "https://admin.coop-ai.dev",
  "integrationHealthSummary": {
    "connected": 3,
    "scopeRequired": 1
  }
}
```

`integrationHealthSummary` is cheap: count from connection store + scope resolve (no live tests).

### 5.4 `POST /v1/admin/onboarding/complete` (tighten)

**Optional validation (Phase A):** If `canCompleteOnboarding` from health gates is false, return `400` with `{ error, gates }`. Wizard should pre-check client-side to avoid surprise.

**Default:** Keep permissive **Skip** paths — only enforce Enterprise Slack scope gate when Slack is connected.

### 5.5 Error message mapping (client)

Add `formatIntegrationError(provider, status, body)` in `admin/src/lib/coopApi.ts` (and extension equivalent) — see §8.

---

## 6. Component plan

### Admin — create

| File | Purpose |
|------|---------|
| `admin/src/components/IntegrationsStep.tsx` | Shared compact integration list for wizard + optional reuse |
| `admin/src/components/OnboardingVerifyStep.tsx` | Health table + Test all |
| `admin/src/lib/integrationErrors.ts` | User-facing error strings |

### Admin — modify

| File | Change |
|------|--------|
| `admin/src/components/OnboardingWizard.tsx` | 6-step flow; embed IntegrationsStep, scope prompt, verify |
| `admin/src/app/(admin)/integrations/page.tsx` | Extract shared load/refresh hook if needed (`useIntegrations`) |
| `admin/src/lib/coopApi.ts` | `fetchIntegrationsHealth()`, error formatter |
| `admin/src/components/IntegrationCard.tsx` | Export nothing new; optionally accept `compact?: boolean` for wizard density |

### Server — modify

| File | Change |
|------|--------|
| `src/server/adminIntegrationsApi.ts` | `GET /v1/admin/integrations/health` |
| `src/server/adminOrgApi.ts` | Optional gate on onboarding complete |
| `src/server/orgApi.ts` | Extend `/v1/me` with onboarding + adminPortalUrl |
| `src/server/adminIntegrationTest.ts` | Export helpers if needed for health |

### Server — tests

| File | Purpose |
|------|---------|
| `src/server/adminIntegrationsHealth.test.ts` | Health aggregation, gates, not_configured |

### Extension — create

| File | Purpose |
|------|---------|
| `src/webview/components/settings/AdminOnboardingBanner.tsx` | Checklist banner |

### Extension — modify

| File | Change |
|------|--------|
| `src/webview/components/settings/SettingsHub.tsx` | Render banner |
| `src/webview/components/settings/types.ts` | `onboardingCompleted`, `adminPortalUrl` on Preferences |
| `src/chat/SecureApiClient.ts` | Parse new `/v1/me` fields |
| `src/chat/types.ts` | Types for me response |

---

## 7. Phase split for Build agent

### Phase A — Wizard embeds Connect + scope (MVP)

- `IntegrationsStep` + refactor `OnboardingWizard` steps 0–2
- Reuse `IntegrationCard` / `IntegrationScopePanel` without duplicating coopApi
- Enterprise Slack scope gate on step 2
- Per-integration status chips on connect step
- `useIntegrations` hook shared with `/integrations` page

### Phase B — Integration health

- `GET /v1/admin/integrations/health` + tests
- `OnboardingVerifyStep` + Test all
- `integrationErrors.ts` mapping
- Wire verify step gates before Done

### Phase C — Extension admin checklist

- `/v1/me` extensions
- `AdminOnboardingBanner` on Settings hub
- Deep links to admin portal

### Phase D — Optional stubs

- Wizard step 2 one-liner for Jira/Notion/Google “coming soon” (already in `IntegrationScopePanel`)
- No new enforcement

---

## 8. Error UX mapping

| Failure | User-facing copy | Recovery action |
|---------|------------------|-----------------|
| 503 install-url / not configured | “{Provider} is not set up on this Coop server. Contact your Coop administrator.” | None in-product |
| 403 admin required | “Only organization owners and admins can connect integrations.” | Sign in as admin |
| OAuth `redirect_uri` mismatch | “OAuth redirect failed. Your admin needs to add `{callback}` to the {Provider} app settings.” | Link to docs (external) for operator |
| Slack `Invalid permissions requested` | “Slack rejected the requested permissions. Your Coop administrator must add the required scopes in the Slack app settings, reinstall the app, then reconnect here.” | Disconnect + Connect |
| Slack `missing_scope` / empty channel picker | “Channel list unavailable. Reinstall the Slack app with bot scopes `channels:read` and `groups:read`, then disconnect and reconnect Slack.” | Reconnect button |
| Bot token unavailable / `scopeNeedsReconnect` | “Reconnect Slack once to refresh channel access.” | Reconnect (existing panel copy) |
| Google insufficient scopes | “Google Drive access is incomplete. Revoke Coop at myaccount.google.com/permissions, then connect again.” | Connect |
| Network / fetch failed | “Could not reach the Coop API. Check your network and API base URL.” | Retry |
| Test failed (generic) | Show server `message` if human-readable; else “Test failed. Try refresh, then disconnect and connect.” | Test / Refresh |

---

## 9. Reference products (what to copy)

| Product | Pattern | Coop adoption |
|---------|---------|---------------|
| **GitHub App install** | Admin picks repos at install; default-deny | Already matches code hosts; wizard should emphasize GitHub first |
| **Notion OAuth** | Page picker at connect time | Future: optional connect-time picker; now admin-time allowlist |
| **Glean / Okta admin checklist** | Hub checklist with green/red, deep links to fix | Extension banner + admin wizard steps |
| **Slack Enterprise Grid** | Channel allowlists | `IntegrationScopePanel` + enforce step in wizard |

**Coop should copy:** GitHub-style “connected / active” badges, Glean-style checklist with deep links, single wizard that doesn't dump admins to another page for the happy path.

---

## 10. Acceptance criteria

### Phase A

- [ ] Dashboard wizard step “Connect tools” shows inline `IntegrationCard` rows (not only link to `/integrations`)
- [ ] Connect opens OAuth in new tab; Refresh updates status without page reload
- [ ] Enterprise org with Slack connected shows step 2 scope UI; **Continue** blocked until Slack scope **Active**
- [ ] Pro/Free orgs skip scope step
- [ ] `/integrations` page unchanged in behavior (shared components)
- [ ] No duplicate OAuth state / double-connect regressions

### Phase B

- [ ] `GET /v1/admin/integrations/health` returns health per provider
- [ ] Wizard Verify step shows health table; **Test all** refreshes results
- [ ] Common Slack failures show mapped copy (not raw `missing_scope`)
- [ ] **Finish setup** disabled when Enterprise Slack connected but scope not active
- [ ] Server tests for health endpoint pass

### Phase C

- [ ] Extension shows admin checklist banner when `canInstallIntegrations && !onboardingCompleted && !devMode`
- [ ] Banner links to admin portal for scope
- [ ] Developers (`canInstallIntegrations: false`) never see banner or Connect buttons
- [ ] PAT fields remain devMode-only

### Phase D (optional)

- [ ] Jira/Notion/Google show “coming soon” in wizard scope step without blocking

---

## 11. Non-goals

- Customer-facing OAuth app registration
- Per-org BYO OAuth client ID (Phase C enterprise doc)
- Full inline invite form (link to `/users` is sufficient for MVP)
- Jira/Notion/Google scope **enforcement** changes (stubs only)
- Operator validation CLI / smoke panel
- Changing `.env.backend.example` beyond a comment if needed

---

## 12. Risks

| Risk | Mitigation |
|------|------------|
| OAuth popup blocked from wizard iframe | Use same `window.open` pattern as `IntegrationCard` |
| Duplicate Connect surfaces (wizard + /integrations) | Shared `IntegrationsStep` + `useIntegrations` hook |
| Enterprise plan gating drift | Reuse `orgPlan === "enterprise"` and `resolveIntegrationScope` via existing APIs |
| Wizard finish too strict | Allow skip on GitHub; only hard-gate Enterprise Slack scope when Slack connected |
| Extension can't know onboarding state | Extend `/v1/me` |
| Health endpoint slow | Test all runs sequentially with timeout; show per-row loading |

---

## 13. Extension vs admin portal — action ownership

| Action | Admin portal | Extension |
|--------|--------------|-----------|
| Connect OAuth | **Primary** (wizard + /integrations) | Supported (Settings → Tools) |
| Enterprise SAML SSO | **Primary** (`/settings/single-sign-on`) | **Sign in with SSO** (Account) |
| Enterprise scope | **Only** (Manage access) | Deep link only |
| Invite users | **Primary** (/users) | — |
| Issue automation API keys | **Primary** (CI/scripts) | — |
| Test integration | Verify step + scope panel | Per-tool Test |
| Workspace repo defaults | — | **Primary** |
| Developer sign-in | — | **Primary** (email/password, Google, SSO) |

**Principle:** Admin portal owns org-wide setup; extension owns developer daily use and mirrors connect for admins who live in VS Code.
