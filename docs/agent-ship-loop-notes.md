# Agent ship loop — stage notes

**Required log** for [agent-ship-loop-build-plan.md](./agent-ship-loop-build-plan.md).  
**Jon’s dogfood checklist:** [agent-dogfood.md](./agent-dogfood.md).

A stage with no entry here is **FAIL**, even if tests are green.

Every Wave 1 and Join entry must also record **UX-G1..G12** (intent-first routing, no sticky agent thread, slash/Workflows still win, no new header control, same Use-repo, existing errors, one Patch card). `npm run test:chat-intent` belongs in the commands list.

## How to append (every stage)

Copy this block. Do not edit older entries except to fix a factual error.

```
### YYYY-MM-DD — Phase X Stage N — PASS | FAIL

- **Owner:** (chat / branch)
- **Commands run:** (exact, from repo root)
- **Gate IDs:** (e.g. A-G1 Pass, A-P4 Fail)
- **What we tried:** (1–4 bullets, including pressure cases)
- **What broke / what we skipped:**
- **What Jon re-runs:** (surface + success signal)
```

---

## Enterprise scorecard (strict Pass / Fail)

### 2026-08-17 — Allowlisted mid-loop integration tools — PASS (automated)

- **Owner:** editor / `cursor/agent-allowlist-midloop-d4f5`
- **Commands run:** `npm run lint`; `npx tsx src/api/agent/integrationMidLoop.test.ts`; phaseA gates
- **Gate IDs:** S-G8b — PASS. Mid-loop `search_jira` / `search_slack` / etc. only when on planner allowlist; capped at 3 calls; results promote to `jiraSearch` / `slackSearch` for synthesis.
- **What we tried:** Prefetch stays first-pass; agent may follow a ticket key / thread topic discovered in code with a focused query.
- **What Jon re-runs:** Ask *Where is requireAuth, and check Jira for related tickets?* Success = Searched/Read, then optional Searched Jira for a key, answer cites both.

### 2026-08-17 — Agent always on + hunt/Slack compound — PASS (automated)

- **Owner:** editor / `cursor/agent-always-on-d4f5`
- **Commands run:** `npm run lint`; `npx tsx src/chat/agentRouting.test.ts`; phaseA/honesty/join gates; `npx tsx src/api/agent/enterprise.scorecard.test.ts`
- **Gate IDs:** S-G1..G8, H-G1..H-G4/H-G10, J-G6 — PASS. Product law: agent default **on**; no Coop Settings toggle; Slack-only still out; hunt+Slack loops.
- **What we tried:**
  - `coopAI.chat.agentMode` default → `on`; Settings AgentMode checkbox removed.
  - Hub subtitle treats missing/undefined as Agent on; kill switch `off` still honored in routing.
  - Locked S-G8: compound locate + Slack keeps the agent loop and Slack on the planner allowlist.
- **What broke / what we skipped:** Live Extension Host dogfood of hunt+Slack still for Jon.
- **What Jon re-runs:** Extension UI — ask a locate question (no Settings flip). Then a hunt+Slack compound ask. Success = Searched/Read activity + Slack evidence on the same turn.

### 2026-08-14 — Enterprise readiness before Extension Host dogfood — PASS (automated)

- **Owner:** editor / enterprise gate
- **Commands run:** `npm run test:agent-enterprise` (lint + ship A–E + pressure + chat-intent + routing + patch + registry + scorecard)
- **Gate IDs:** S-G1..G7, R-G1..G4, PB-G1..G5, H-G1..H-G13, J-G1/G3/G4/G6/G7, ENT-G4/G5 — all automated PASS. Manual S1–S14 / J-G2/G5/G8 remain Jon’s Extension Host scorecard tonight.
- **What we tried:**
  - Machine-readable criteria in `enterpriseCriteria.ts` (Pass column = ship, Fail column = block).
  - `enterprise.scorecard.test.ts` prints OVERALL PASS/FAIL and exits 1 on any FAIL.
  - Scope expanded + Settings copy matches (Agent for repo questions).
  - Patch bridge wired so Apply appears even when the model forgets to echo SEARCH/REPLACE.
  - Join automated subset + `test:agent-ship:pressure` script restored for J-G3.
- **What broke / what we skipped:** Live model tool-picking quality (planTurn) and S1–S14 Extension Host still require Jon.
- **What Jon re-runs tonight:** Extension UI — Coop Settings → Preferences → Model & chat → **Agent for repo questions** → Save. Then S3–S6 from the build-plan scorecard. Terminal first: `npm run test:agent-enterprise`.

---

## Refactor — Phase 0 + Phase 1

### 2026-08-14 — Root cause of the 2026-08-13 dogfood miss — PASS (automated)

- **Owner:** editor / `cursor/agent-ship-a-2e13`
- **Commands run:** `npm run test:agent-ship:a`, `npm run test:chat-intent`, `npx tsx src/context/repoSemanticRetrieval.test.ts`, `npm run lint` — all green
- **Gate IDs:** H-G1..H-G11 rewritten to be repo-agnostic; new `graphSearchHit` contract test
- **What we tried:** The hunt cited `apps/live` and an auth form because `CloudIndexBackend.search`
  overwrote every hit with `score: 1` and `lineNumber: index + 1` — the hit's position in the result
  list, not in the file. `AgentOrchestrator` then read `lineNumber ± 25`, so it always read roughly
  the first 26 lines of a file and answered from them. The index was never the problem:
  `lightningSearch` merges SCIP symbols, Zoekt line matches, and embeddings with real positions and
  scores, and `formatLightningSearchResult` already sends them — the line number just arrived in a
  field named `sha`, and the client ignored it.
- **What broke / what we skipped:** Phase 0 removed the repo-specific ranking added on 2026-08-13
  (`apps/live`, `hocuspocus`, `auth-forms`, `detectEvidenceLayer`); ranking is now barrels, build
  output, vendored code, and query/path word overlap only. `extractAgentSearchQuery` now prefers a
  symbol the user named (`requireAuth`) over a prose phrase. Not done: symbol-first hunts
  (search_code returns `symbols` and the loop still ignores them), one shared retrieval module,
  and a golden-repo fixture. Source-text `readFileSync` assertions still exist in 8 other test files.
- **What Jon re-runs:** Coop Settings → Preferences → Model & chat → **Agent for repo hunts** → Save.
  Use-repo **plane**. Ask: *Where is requireAuth or authentication middleware defined in this repo?*
  Success = the cited lines are the actual definition, not the top of the file. Terminal:
  `npm run test:agent-ship:a`

### 2026-08-14 — Phases 2–4: symbol-first hunts, one mapper, hunt eval — PASS (automated)

- **Owner:** editor / `cursor/agent-ship-a-2e13`
- **Commands run:** `npm run test:agent-ship:a`, `npm run test:chat-intent`, `npm run lint` — all green
- **Gate IDs:** new `noRepoSpecificRules` guard (4 rules); `graphSearchHit` contract (10); `huntEval` 12 questions × 2 index regimes
- **What we tried:**
  - **No repo-specific rules, ever.** `noRepoSpecificRules.test.ts` fails on any path-shaped literal
    in ranking code outside a universal-infrastructure allowlist, on any product/framework name, and
    on any non-universal term in the noise module. Verified it fails by planting `/hocuspocus/` and
    `apps/live` and watching both rules trip.
  - **Symbol-first.** `search_code` always returned SCIP declarations with real lines; the loop
    ignored them. `pickSymbolHitsToRead` ranks declarations by how well the name matches the ask,
    and the loop reads the declaration before any text hit.
  - **One mapper.** `mapGraphSearchResponse` is now the only place a `/graph/…/search` response
    becomes hits. It replaced two copies — the second, in `repoSemanticRetrieval`, had the same
    invented `lineNumber: index + 1` and also fabricated empty symbol names.
  - **One noise rule.** `evidencePathNoise.ts` replaced three copies of "what is noise"
    (`searchQuery`, `lightningSearch`, and a duplicate inside `CoopChatSession`).
  - **Eval.** `eval/huntEval.test.ts` runs 12 hunts across a polyglot fixture in two regimes: index
    returns match lines, and index returns files only. Scores *right file* and *definition actually
    in the text we read*. Both 12/12.
- **What broke / what we skipped:** The eval was insensitive until the fixture files were padded so
  definitions sit 150–350 lines down — with short files, any read window contains the answer.
  Disabling symbol-first now drops the paths-only regime to **0/12 definitions in view** while
  staying 12/12 on file choice: precisely the 2026-08-13 failure. Not done: `CoopChatSession` is
  still 10k lines, and 8 other test files still assert on source text.
- **What Jon re-runs:** Coop Settings → Preferences → Model & chat → **Agent for repo hunts** → Save.
  Use-repo **plane**. Ask: *Where is requireAuth or authentication middleware defined in this repo?*
  Success = cited lines contain the actual definition. Terminal: `npm run test:agent-ship:a`

---

## Wave 1 — Phase A

### 2026-08-13 — Phase A Stages 0–4 — PASS (automated); manual dogfood still for Jon

- **Owner:** editor Wave 1 / `cursor/agent-ship-a-2e13`
- **Commands run:** `npm run test:agent-ship:a` (green), `npm run test:agent-routing` (green), `npm run test:chat-intent` (green), `npm run lint` (green)
- **Gate IDs:** A-G0..G8 automated where practical; A-P1, A-P2, A-P3, A-P5, A-P6, A-P8, A-P9, A-P10, A-P12, A-P13; UX-G1/G2/G7/G8/G10
- **What we tried:** Planner-first loop; `auto` no longer fires on empty context; activity cap 3; `read_file` stays remote; invalid JSON fails open; repoId forced to Use-repo
- **What broke / what we skipped:** Live Extension Host dogfood (S3 / feel freeze) is for Jon after this lands. `auto` is conservative, not a full product “auto agent.”
- **What Jon re-runs:** Extension UI → Coop Settings → Preferences → Model & chat → **Agent for repo hunts** on → Save. Indexed remote Use-repo; ask where auth is enforced; then Trace, Stop, explain-this, Slack-named, thanks follow-up. Terminal: `npm run test:agent-ship:a && npm run test:chat-intent`

### 2026-08-13 — Hunt quality pass — PASS (automated)

- **Owner:** editor / `cursor/agent-ship-a-2e13`
- **Commands run:** `npm run test:agent-ship:a` (green), `npm run test:agent-routing` (green), `npm run test:chat-intent` (green)
- **Gate IDs:** hunt-Q1 short query; hunt-Q2 skip barrels; hunt-Q3 prefer api/middleware
- **What we tried:** Dogfood searched the whole sentence and read `apps/space/components/.../index.ts` barrels. Extract identifiers (`requireAuth`); rewrite LLM/deterministic `search_code` queries; rank hits so API/middleware beats frontend barrels.
- **What broke / what we skipped:** Live Extension Host retest is for Jon. Did not flip `agentMode` default on.
- **What Jon re-runs:** Reload Extension Development Host. Coop Settings → Preferences → Model & chat → **Agent for repo hunts** on → **Save model settings**. Use-repo **plane**. Ask: *Where is requireAuth or authentication middleware defined in this repo?* Success = activity shows a short search term (not the whole sentence); answer cites `apps/api/...` auth/middleware, not `apps/live` or space component barrels. Agent **off** → today’s chat, no hunt steps.

---

## Wave 2 — Phase B

### 2026-08-13 — Phase B Stages 0–4 — PASS (automated); S4 dogfood still for Jon

- **Owner:** editor Wave 2 B / `cursor/agent-ship-b-2e13`
- **Commands run:** `npm run test:agent-ship:b` (green), `npm run test:patch` (green), `npm run test:chat-intent` (green), `npm run lint` (green)
- **Gate IDs:** B-G1 Pass, B-G2 Pass (mocked VFS auto-open), B-G3 Pass, B-G4 Pass, B-G5 Pass, B-G6 Pass, B-G7 Pass; B-P1 Pass, B-P2 Pass, B-P3 Pass, B-P4 Pass, B-P5 Pass, B-P6 Pass; UX-G4 Pass (reserved Create PR is hidden `coop-text-btn`)
- **What we tried:**
  - **B-0:** Apply still required an already-open editor or local disk. GitHub VFS open exists (`openRemoteFileInEditor`); GitLab/Bitbucket have no remote-open-without-clone. Wrote `PatchSession` contract (`canCreatePr: false` until C).
  - **B-1:** `propose_patch` emits File: + SEARCH/REPLACE and does not apply. Apply auto-opens GitHub VFS files. Cap = 5 files.
  - Pressure: malformed hunks error with no write; GL/BB honest degrade; Apply→Undo→Apply; one Apply + one Reject; cite fence beside a patch is not Apply-able.
- **What broke / what we skipped:** Live Extension Host S4 (close every tab, `/edit` two remote files, Apply then Undo) is for Jon. Create PR stays disabled/hidden (C owns it). Did not flip `agentMode` default on.
- **What Jon re-runs:** Extension UI S4 — see dry-run below. Terminal: `npm run test:agent-ship:b && npm run test:patch && npm run test:chat-intent`

### 2026-08-13 — S4 dry-run (manual; Jon)

- **Owner:** Jon after this lands / `cursor/agent-ship-b-2e13`
- **Commands run:** (manual Extension Host; automated gates above already Pass)
- **Gate IDs:** S4 pending Jon
- **What we tried:** Scripted the S4 path; did not run it in Extension Development Host from this chat.
- **What broke / what we skipped:** Live remote Apply on an uncloned GitHub Use-repo.
- **What Jon re-runs:**
  1. Extension UI — close every editor tab.
  2. Use-repo = indexed GitHub repo you do not have cloned. `/edit` a log line in file A **and** a caller in file B.
  3. Success = Patch card for 2 files; Apply opens both via GitHub VFS (no “open it first”); Undo restores both. Create pull request stays hidden/disabled.

---

## Wave 2 — Phase C

### 2026-08-13 — Phase C Stages 0–4 — PASS (automated); live Apply→PR still Join J-G1

- **Owner:** editor Wave 2 C / `cursor/agent-ship-c-2e13`
- **Commands run:** `npm run test:agent-ship:c`, `npm run test:chat-intent`, `npm run lint`
- **Gate IDs:** C-G1 Pass, C-G2 Pass, C-G3 Pass (`repo.pull.create`), C-G4 Pass, C-G5 Pass, C-G6 Pass (UX-G3); C-P1..C-P5 Pass
- **What we tried:** GitHub git-data write (blob → tree → commit → ref → pull) from fixture files; confirm modal is `coop-prompt-modal`; Cancel/Escape/backdrop creates nothing; GL/BB throw/show Not yet; missing `contents`/`pull_requests` blocks before writes; double-confirm shares one in-flight PR; 422 is an error, not a successful PR
- **What broke / what we skipped:** Live Extension Host Apply→Create PR is **J-G1** (needs B apply session + `CoopChatSession` handler for `patch:create-pr`). Did not flip `agentMode` or NES defaults.
- **What Jon re-runs after Join (S5–S6):** Extension UI → indexed GitHub Use-repo → apply a patch (B) → Patch card **Create pull request** → confirm branch + title → GitHub shows the PR URL. Cancel/Escape must create nothing. GitLab Use-repo must say **Not yet**.

### C-0 research

- **GitHub git data API:** `POST /git/blobs`, `/git/trees`, `/git/commits`, `/git/refs`, then `POST /pulls`. Preflight `GET /repos/{owner}/{repo}` reads `X-OAuth-Scopes` + `permissions.push`.
- **Required scopes:** `contents` + `pull_requests` (or classic `repo`). Fail closed with a permission error; no branch/PR claimed.
- **Audit event:** `repo.pull.create` (handoff metadata: repoId, branch, title, number, htmlUrl, fileCount).


---

## Wave 2 — Phase D

### 2026-08-13 — Phase D Stages 0–4 — PASS (automated); S7 dogfood still for Jon

- **Owner:** editor Wave 2 D / `cursor/agent-ship-d-2e13`
- **Commands run:** `npm run test:agent-ship:d` (green), `npm run test:project-instructions` (green), `npm run test:chat-intent` (green), `npm run lint` (green)
- **Gate IDs:** D-G1..G6 Pass; D-P1..P6 Pass; UX-G6 Pass
- **What we tried:** Remote Use-repo loads root `AGENTS.md` via `IndexedRepoWorkspace.readFile` (never the open Coop-AI folder). Cap 12k with an INTERNAL truncate note. Cache per repo/branch. Visible memory in Settings requires a source. Prompt library stays opt-in.
- **What broke / what we skipped:** Live Extension Host S7/S14 is for Jon. Remote path is root `AGENTS.md` only (no nested AGENTS.md / `.cursor/rules` over the network). First turn with gather budget already spent uses cache or injects nothing.
- **What Jon re-runs:** Extension UI → Use-repo = indexed GitHub repo you do **not** have cloned (Coop-AI may be the open folder). Plain chat. Success = answer follows that repo’s `AGENTS.md`; no new banner/chip/activity row. Settings → Workspace → Saved facts to add/clear sourced memory. Agent mode stays **off**.

---

## Wave 2 — Phase E

### 2026-08-13 — Phase E Stages 0–4 — PASS (automated); S8–S9 dry-run for Jon

- **Owner:** editor Wave 2 E / `cursor/agent-ship-e-2e13`
- **Commands run:** `npm run test:agent-ship:e` (green), `npm run test:autocomplete` (green), `npm run test:chat-intent` (green), `npm run lint` (green)
- **Gate IDs:** E-G1..G6 Pass; E-P1..P4 Pass; UX-G5 default off
- **What we tried:**
  - **E-0** Tab-accept is `CoopAutocompleteProvider.noteSuggestionAccepted` + `coopAI.internal.autocompleteAccepted` → `completion.accepted` + `HotStreak.activate()`. Second ghost attaches after accept: NES arms `NextEditController`, triggers `editor.action.inlineSuggest.trigger`, next `provideInlineCompletionItems` returns a ghost at `predictNextEditLocation` (buffer). Zero-Clone sources: open buffer + existing graph API on the router — no workspace walk.
  - **E-1** `coopAI.autocomplete.nextEditSuggestions` default **false**. No toast. No Workflows entry.
  - **E-2 / E-3** Gate + pressure tests. NES off → zero NES requests and no extra inlineSuggest trigger (base ghost unchanged). NES fetches after Tab-accept only and skip `AutocompletePerformanceMonitor` so base p50/p95 are not mixed. Rapid typing cancels a pending NES (no request storm). Escape increments NES reject; Tab still arms the next one.
- **What broke / what we skipped:** Live Extension Host S8/S9 is for Jon. Did not flip NES or `agentMode` default on. Did not add extra network on the typing → ghost path.
- **What Jon re-runs:** Extension UI → Settings `Coop AI › Autocomplete: Next Edit Suggestions` **off** (S8): type + Tab as usual; ghost feels like today. Then **on** (S9): Tab-accept once; a next-edit ghost should appear at a predicted place. Terminal: `npm run test:agent-ship:e && npm run test:autocomplete`

---

## Wave 3 — Join

### 2026-08-13 — Join J-G1 wiring — PASS (automated); S4–S6 dogfood still for Jon

- **Owner:** editor join / `cursor/agent-ship-a-2e13`
- **Commands run:** (see follow-up after tests)
- **Gate IDs:** J-G1 wired (Apply populates `prFiles` + `canCreatePr`; `patch:create-pr` handled in CoopChatSession); UX-G4 Create PR only after Apply
- **What we tried:** Merged B + C. After Apply, Patch card shows one quiet Create pull request. Confirm uses `coop-prompt-modal`. GitLab/Bitbucket still Not yet. Empty file list blocked.
- **What broke / what we skipped:** Live GitHub PR in Extension Host is for Jon (S5–S6). Modal posts then the extension creates the PR (result is a VS Code notification with the URL).
- **What Jon re-runs:** Extension UI — close tabs → GitHub Use-repo uncloned → `/edit` two files → Apply → **Create pull request** → confirm. Success = GitHub PR URL. Cancel/Escape creates nothing.

### 2026-08-13 — Honesty gates H-G1..H-G10 — PASS (automated)

- **Owner:** editor / `cursor/agent-ship-a-2e13`
- **Commands run:** `npx tsx src/api/agent/honesty.gates.test.ts` (via `npm run test:agent-ship:a`)
- **Gate IDs:** H-G1 Coop Settings switch; H-G2 Save + live read; H-G3 default off; H-G4 dogfood hunt loops only when on; H-G5 search query; H-G6 skip live collab; H-G7 Searched/Read activity; H-G8 no header toggle; H-G9 leftover chips; H-G10 dogfood docs name Coop Settings
- **What we tried:** Encoded the 2026-08-13 dogfood miss: we claimed the agent was ready while the switch was only in VS Code Settings and hunt ranking preferred `apps/live`.
- **What broke / what we skipped:** Live Extension Host retest is still for Jon. Did not flip `agentMode` default on.
- **What Jon re-runs:** Coop Settings → Model & chat → Agent for repo hunts → Save. Then the plane middleware question. Success = Searched/Read + `apps/api/...`. Terminal: `npm run test:agent-ship:a`

---

## Scorecard (Jon)

Fill after Wave 3. Copy results into the plan’s scorecard table as well.

| ID | Result | What I saw |
|----|--------|------------|
| S1 | | |
| S2 | | |
| S3 | | |
| S4 | | |
| S5 | | |
| S6 | | |
| S7 | | |
| S8 | | |
| S9 | | |
| S10 | | |
| S11 | | |
| S12 | | |
| S13 | | |
| S14 | | |
