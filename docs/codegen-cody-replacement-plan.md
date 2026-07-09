# Cody-replacement codegen plan

**Goal:** Cody-grade generate → accept → edit with repo-grounded intelligence. **No extension UI redesign** — same chat, settings, quick actions; more power under the hood.

**Boris bar:** See `AGENTS.md` § Boris bar. Every phase ends with explicit pass/fail; do not proceed if fail.

## Phases

| Phase | Focus | Key files |
|-------|--------|-----------|
| **0** | Foundation audit, doc drift, settings exposure | `docs/`, `package.json`, `website/content/docs/` |
| **1** | Wire semantic retrieval + autocomplete T1 graph | `CoopChatSession.ts`, `repoSemanticRetrieval.ts`, `inlineGraphContext.ts`, `autocompleteConfig.ts` |
| **2** | Telemetry + admin analytics | `CoopChatSession.ts` (emit only), `registerAutocomplete.ts`, `adminAnalyticsApi.ts`, `admin/.../analytics/` |
| **3** | Edit loop: parse/apply/undo patches | `src/edit/*`, commands in `registerAutocomplete` or `extension.ts` |
| **4** | Autocomplete trust (symbol filter, dogfood gates) | `completionFilter.ts`, `coopAutocompleteProvider.ts` |
| **5** | Agent tools (opt-in) | `src/api/agent/*` |

**Phase 5 status (2026-07-09):** `search_code` (indexBackend) and `read_file` (localFileContext) ship in `createAgentToolRegistry`. Opt-in via `coopAI.chat.agentMode` (`on` runs a deterministic `search_code` → `read_file` loop in `AgentOrchestrator.run()` and injects results into chat context). **Deferred:** LLM-driven tool selection and multi-step parsing beyond the interim 2-step loop.

## Phase workflow (each agent)

1. **Research** — Read code; document current state and gaps.
2. **Plan** — File-level tasks, tests, Boris risks.
3. **Build** — Implement minimal correct diff.
4. **Execute** — Run tests + `npm run build:extension`.
5. **Review** — Boris bar checklist; pass or fix until pass.

## Boris gate (all phases)

- Wired end-to-end on hot path (not orphan code)
- Graph-grounded where we claim repo intelligence
- Close the loop where applicable (apply, accept, telemetry)
- Tested hot path
- Claude Code quality, not vibe code

## Dependencies

```
0 → 1 → 2 → 3 → 4 → 5 (optional)
```

Phase 2 can parallel with late Phase 1 if no merge conflicts. Phase 3 depends on Phase 1 context wiring.

## Phase 0 status — complete (2026-07-09)

**Scope:** Foundation audit, doc drift, settings exposure. No `CoopChatSession` or edit-loop code changes.

### Research findings

| Area | Code truth | Doc drift (fixed) |
|------|------------|-------------------|
| `requestTimeoutMs` | Default **1500** (`package.json`, `autocompleteConfig.ts`) | `autocomplete.md`, `extension-settings.md`, `troubleshooting.md` said **400** |
| `autocomplete.model` | Default **`chat`** | Docs said **`haiku`** |
| `useGraphContext` | Default **false**; server slice in `inlineGraphContext.ts` (150 ms) | Roadmap §3 still listed as unchecked — updated to partial |
| Graph plan gating | No plan gate in `inlineGraphContext.ts` | Some docs said Pro-only — aligned to "Deep-Indexed repo" |
| `coopAI.chat.semanticRetrieval` | `semanticRetrievalConfig.ts` default **true** | Missing from `package.json` contributes — **added** |
| Semantic retrieval hot path | `repoSemanticRetrieval.ts` + tests exist; UI message only in `contextGatheringMessages.ts` | Not wired in `CoopChatSession` — **Phase 1** |
| Edit selection | Selection in chat via `coopAI.includeSelection`; no `src/edit/` | Manual implied inline diff shipped — **corrected** |

### Deliverables

- [x] `coopAI.chat.semanticRetrieval` in `package.json`
- [x] Autocomplete timeout/model defaults aligned across website docs
- [x] `docs/roadmap.md` § codegen + T1 partial status
- [x] Owner's Manual edit-selection honesty
- [x] `npm run build:extension` passes

### Handoff to Phase 1

1. Call `repoSemanticRetrieval` from `CoopChatSession` when `readSemanticRetrievalEnabled()` and gates pass.
2. Ensure autocomplete graph path is exercised end-to-end in dogfood (setting already exists).
3. Do not claim edit-selection or semantic retrieval on hot path until wired.

## Success metrics

- Semantic retrieval called on plain chat + edit when indexed
- Edit patch apply rate >60% internal dogfood
- Completion CAR ≥25% with graph on
- quick_action + edit events in `/analytics`

## Parity gaps (post Phase 0–5) — complete (2026-07-09)

| Parity | Status | Delivered |
|--------|--------|-----------|
| **P0** | ✅ | `edit-mode.md`, manual + product page aligned |
| **P1** | ✅ | Fuzzy SEARCH, `retryLastPatch` / `rejectPatch`, `edit.patch_rejected` |
| **P2** | ✅ | `codeEditIntent` + selection supplement; collection scope on semantic search |
| **P3** | ✅ | Index-ready discovery toast → **Enable autocomplete** (workspace) |
| **P4** | ✅ | Deterministic `search_code` → `read_file` agent loop (opt-in `agentMode: on`) |
| **P5** | ✅ | 250ms inline graph + 1–2 line snippets; `collectionId` on `graphSearch` |

**UI rule unchanged:** no ChatPanel layout changes.

**Still honest / deferred:** LLM-driven multi-step tool selection (`agentMode: auto` uses prefetch heuristics, not model-chosen tools); dogfood CAR ≥25% / apply-rate gates are tracked in admin analytics but not enforced in CI.

## Boris bar — full Cody parity (2026-07-09)

| Gate | Status |
|------|--------|
| Wired end-to-end | ✅ `/edit`, semantic retrieval, autocomplete auto-on, agent prefetch |
| Graph-grounded | ✅ Index + graph snippets when Deep-Indexed |
| Close the loop | ✅ Apply/undo/retry/reject; Tab-accept completions |
| Tested hot path | ✅ `test:patch`, `test:agent-routing`, `test:autocomplete`, `build:extension` |
| Honest scope | ✅ Agent prefetch documented; no Cody oversell in docs |

## Parity P0 status — complete (2026-07-09)

**Scope:** Docs/marketing drift after codegen phases 1–3 shipped. No extension webview or `src/edit/` changes.

### Deliverables

- [x] `website/content/manual/index.md` — `/edit` `/patch` `/fix`, apply/undo, auto graph when Deep-Index ready
- [x] `website/content/docs/edit-mode.md` — full guide (slash commands, apply, undo, selection context)
- [x] Edit mode wired into docs nav (`section: extension`, `order: 3`)
- [x] `website/src/app/product/page.tsx` — removed "edit selection in active development"
- [x] `website/content/docs/autocomplete.md` — auto graph when indexed (Phase 1)
- [x] `website` build passes
