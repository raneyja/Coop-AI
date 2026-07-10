# CoopAI Roadmap

**Updated:** July 9, 2026

This document tracks what shipped in the Prompt 2 + pre-work pass, what is intentionally deferred, and the recommended order to build next. For API contracts, see [api-v1.md](./api-v1.md).

## Shipped (current baseline)

### Server (same host as graph / jobs / webhooks)

| Capability | Route / module | Notes |
|------------|----------------|-------|
| Multi-model router | `src/api/ModelRouter.ts` | Server-side; provider keys in env |
| Chat streaming | `POST /v1/chat` | SSE: `delta`, `done`, `error` |
| Inline completion | `POST /v1/completions/inline` | `useCase: inline_completion`; mock or provider keys |
| Health + LLM status | `GET /health` | `llm.mockMode`, `llm.configuredProviders` |
| Zero-retention routing | `requestFormatter`, `zeroRetentionConfig` | All provider calls |
| Mock dev mode | `COOP_LLM_MOCK=true` | No provider keys required |

### Extension

| Capability | Notes |
|------------|-------|
| Unified `coopAI.apiBaseUrl` | Chat, graph, jobs on one host; `jobsBaseUrl` deprecated |
| Live chat via `streamChat` | Calls `/v1/chat`; `coopAI.llm.enabled` |
| Provider / model / temperature settings | Keys stay on server, not in VS Code |
| Usage footer | Per-request + session cost estimate |
| Stream cancel | `AbortController` |
| Editor context menu | Trace, Find Owner, Blast Radius, Understand Repo, Knowledge Gaps |
| Open repo in editor (hybrid) | On remote explorer repo pick: local clone via `openFolder`, else GitHub Repositories (`coopAI.openRepoInEditor`) |
| Workspace prompt library | `.coop/prompts.json` + sidebar chips + Save / Run |
| API key UX | **Save API key** button (any length for local dev) |
| Inline autocomplete (T0) | `coopAI.autocomplete.enabled` default **off**; buffer-only ghost text |
| Autocomplete T1 (partial) | `coopAI.autocomplete.useGraphContext` default **off**; server graph slice when enabled |

### Enterprise

| Capability | Route / module | Notes |
|------------|----------------|-------|
| **Enterprise SAML SSO** | `/v1/auth/saml/*`, `/v1/sso/*` | **Shipped** — admin portal self-serve at **Settings → Single sign-on** (`/settings/single-sign-on`) + extension SSO handoff. Policy guard: `sso_required_active` when disabling SAML under **Require SSO**. Tests: `npm run test:sso` (24 tests, in `npm test`). **Known limits:** SP-initiated only (no IdP-initiated); no SCIM; no SAML refresh tokens (12 h session TTL); shared service provider for all Enterprise tenants (org resolved via RelayState). Operator sets `COOP_PUBLIC_BASE_URL`. See [Single Sign On (SSO)](../website/content/docs/sso.md), [sso-smoke-test.md](./sso-smoke-test.md). |

### Explicitly not in scope of that pass

- File `@`-mentions in chat
- Edit selection inline diff (accept/retry/undo) — Phase 3 codegen
- Semantic retrieval on chat hot path — Phase 1 codegen (`repoSemanticRetrieval.ts` exists, not wired)

---

## Deferred work

### 1. File-only @-mentions in chat

**Goal:** Let users attach file paths (and optional line ranges) in the composer; resolve context from the remote graph without cloning the repo.

**Trigger to start:** `/v1/chat` stable (done) + extension `CoopBackendClient.graphSearch()` wired.

**Build list:**

- [ ] `@` picker in `ChatComposer` (debounced search)
- [ ] Extension RPC: search `GET /graph/:repoId/search?pattern=...`
- [ ] `MentionAttachment` on `chat:send` and in `V1ChatRequestBody.mentions[]`
- [ ] Resolve mentions → ownership, recent changes, decision signals (reuse context fetch types)
- [ ] Inject structured `<attached_context>` block (see `systemPrompts.buildUserMessageWithContext`)
- [ ] Caps: e.g. 3 files, token budget per request

**Out of v1:** `@symbol`, Slack @users, cross-repo mentions.

---

### 2. Autocomplete T0 (buffer-only) — shipped

**Goal:** Inline ghost-text completions using the open file only—no graph yet.

**Status:** Shipped. Default `coopAI.autocomplete.enabled` is **off** until users opt in.

**Build list:**

- [x] Implement inline route on server (reuse `ModelRouter`, `useCase: inline_completion`)
- [x] `CoopAutocompleteProvider` in extension (`registerInlineCompletionItemProvider`)
- [x] Debounce + cancel in-flight requests
- [x] Honor `coopAI.autocomplete.enabled` (default **off**)
- [x] Zero-retention headers (`x-use-case: code-completion-only`)
- [x] Strip markdown fences from model output
- [x] Copilot coexistence (auto-disable Copilot inline when Coop autocomplete is on)
- [x] Accept/reject telemetry (Tab accept, Escape reject, superseded)

**Prompt shape:** Narrow completion system prompt in `systemPrompts.ts` (`inline_completion`).

---

### 3. Autocomplete T1 (graph-backed) — partial

**Goal:** Optional dependents / signature snippets from graph API when completing.

**Status:** Setting + server slice shipped; opt-in (`coopAI.autocomplete.useGraphContext` default **false**). Extension sends `repoId` + `file` when enabled. 150 ms graph budget; `x-graph-context: degraded` on timeout.

**Build list:**

- [x] Setting: `coopAI.autocomplete.useGraphContext`
- [x] Server: include small graph slice in inline request (dependents, ownership) — `inlineGraphContext.ts`
- [ ] Rate limits + degradation polish when graph offline at scale
- [ ] Dogfood CAR ≥25% with graph on

---

### 8. Cody-replacement codegen (Phases 0–5)

**Goal:** Cody-grade generate → accept → edit with repo-grounded intelligence. Plan: `docs/codegen-cody-replacement-plan.md`.

| Phase | Focus | Status |
|-------|--------|--------|
| **0** | Doc drift, settings exposure | **Complete** — timeout/model defaults aligned; `coopAI.chat.semanticRetrieval` in `package.json`; manual edit-selection honesty |
| **1** | Wire semantic retrieval + autocomplete graph on hot path | Next — `repoSemanticRetrieval.ts` exists but not called from `CoopChatSession` |
| **2** | Telemetry + admin analytics | Partial — completion events exist; edit/quick_action gaps |
| **3** | Edit loop: parse/apply/undo patches | Not started — no `src/edit/` |
| **4** | Autocomplete trust (symbol filter, dogfood) | Not started |
| **5** | Agent tools (opt-in) | Not started |

**Codegen defaults (code truth):**

| Setting | Default | Notes |
|---------|---------|-------|
| `coopAI.autocomplete.enabled` | `false` | Opt-in ghost text |
| `coopAI.autocomplete.useGraphContext` | `false` | Graph slice when Deep-Indexed |
| `coopAI.autocomplete.requestTimeoutMs` | `1500` | Docs were stale at 400 |
| `coopAI.chat.semanticRetrieval` | `true` | Plain-chat index snippets (Phase 1 wires hot path) |

---

### 4. BYOK on the router (enterprise)

**Goal:** Route inference through customer-owned keys via existing `byokHandler.ts`.

**Trigger to start:** Enterprise pilot needs customer keys without CoopAI holding provider secrets.

**Build list:**

- [ ] Request field: `customerId` + BYOK provider
- [ ] `ModelRouter` delegates to `ByokHandler` when configured
- [ ] Audit log remains PII-free (already required for router)

---

### 5. Real provider cutover (leave mock)

**Goal:** Production chat uses live OpenAI / Anthropic / Gemini—not mock stream.

**Ops checklist:**

- [ ] Set `ANTHROPIC_API_KEY` (and others) on server; **do not** set `COOP_LLM_MOCK`
- [ ] Confirm `/health` → `"mockMode": false`
- [ ] `COOP_API_TOKEN` in prod; extension uses real CoopAI key (not placeholder)
- [ ] DeepSeek only with `COOP_LLM_ALLOW_UNAPPROVED=true` + legal sign-off

---

### 6. Context fetch → live graph (not placeholders)

**Goal:** Quick actions and chat context use real GitHub/graph data instead of `localContextDataFor` placeholders in `CoopChatSession`.

**Trigger to start:** Graph populated (webhooks or index jobs) for target repos.

**Build list:**

- [ ] Extension calls graph/jobs APIs for ownership, blame, dependents, decision history
- [ ] Align with `runFeatureFallback` / degradation matrix

---

### 7. Polish & docs

- [ ] `docs/roadmap.md` — this file (maintain as items ship)
- [ ] Local dev quickstart in README (server + F5 + `apiBaseUrl` + mock)
- [ ] Optional: quota alerts (needs billing API; not v1 cost footer)

---

## Recommended build order

```text
Now (verified)     →  mock chat + settings + prompts + context menu + Autocomplete T0
Codegen Phase 0    →  doc/settings audit (complete)
Next (codegen 1)   →  wire semantic retrieval + graph on chat/edit hot path
Then               →  @-mentions + edit loop (Phase 3) + telemetry polish
```

```mermaid
flowchart TD
  shipped[Shipped_Prompt2_Prework]
  mentions["@-mentions_v1"]
  inlineApi["/v1/completions/inline"]
  autoT0[Autocomplete_T0]
  autoT1[Autocomplete_T1]
  byok[BYOK_router]
  graphLive[Live_graph_context]

  shipped --> mentions
  shipped --> graphLive
  mentions --> inlineApi
  inlineApi --> autoT0
  autoT0 --> autoT1
  shipped --> byok
```

---

## How to task implementation

When ready for a row above, use a prompt like:

**@-mentions**

> Add file-only @-mentions in chat: picker, graph search via `apiBaseUrl`, `mentions[]` on `/v1/chat`, resolve ownership/changes into context. See `docs/roadmap.md` §1.

**Autocomplete T0**

> Shipped: `POST /v1/completions/inline` + extension `InlineCompletionItemProvider` (buffer-only). Default `coopAI.autocomplete.enabled` false. See `docs/roadmap.md` §2.

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [api-v1.md](./api-v1.md) | Chat + inline request/response, auth, env vars |
| [webhook-backend.md](./webhook-backend.md) | Graph routes, webhooks, health |
| [job-queue.md](./job-queue.md) | Heavy scans (knowledge gaps, index) |
| [zero-retention-llm.md](./zero-retention-llm.md) | Enterprise LLM policy |
| [Single Sign On (SSO)](../website/content/docs/sso.md) | Enterprise IdP setup, sign-in surfaces, troubleshooting |
| [sso-smoke-test.md](./sso-smoke-test.md) | Operator smoke test for local/demo SSO |
