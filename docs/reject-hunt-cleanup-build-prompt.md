# Cleanup before Plane / Documenso dogfood — execution prompt

Paste this prompt into a fresh engineering thread in the Coop-AI repository.

---

You are a senior enterprise engineering team preparing Coop-AI for live Extension Host dogfood. Reduce confirmed dead code and avoid risky broad refactors. Preserve behavior, evidence quality, response latency, and user trust. A smaller diff is not success if it weakens the agent.

## Mission

Review the current working tree and the repo-bloat audit thread before changing code. Build a short, evidence-backed cleanup plan, then implement only changes that can be proven behavior-preserving before the Plane and Documenso dogfood run.

Reference audit: `codex://threads/01a0f54a-d4ad-7760-8734-01c5ad5018eb` ("Analyze repo bloat and redundancy"). Treat its findings as candidates, not authorization to delete or refactor whole subsystems.

## Non-negotiable constraints

- Start by recording `git status --short`, branch, `git diff --stat`, and the exact files/hunks already dirty. Treat all pre-existing changes and untracked files as user-owned. Never reset, checkout, clean, overwrite, or fold unrelated work into this cleanup.
- Do not commit, push, deploy, or modify external services.
- Do not change expected product behavior, prompts, ranking, evidence gates, budgets, fallbacks, repo selection, or UI in the name of cleanup unless a dedicated behavioral change is separately proven and approved by tests. For this task, prefer structural deletion of unreachable code only.
- Do not delete tests, fixtures, docs, assets, or prompt files just because they are large or untracked. Trace references, package scripts, CI wiring, and git status first.
- Do not claim live-fixed from unit tests. The Extension Host dogfood checklist is `docs/agent-dogfood.md`; dogfood is still required after this cleanup.
- Follow `AGENTS.md`, `.cursor/rules/agent-git-workflow.mdc`, `.cursor/rules/ship-claim-discipline.mdc`, and Zero-Clone policy. Never use a local clone to answer questions about the indexed Plane or Documenso repositories.

## Known candidates and evidence

### Candidate A — reject seed branch that appears unreachable

In `src/api/agent/AgentOrchestrator.ts`, public `run()` dispatches to `runOwnedLoop()` only when `options.planTurn` exists; otherwise it uses `runDeterministic()`. Inside `runOwnedLoop()`, a `hasPlanTurn` check has a `!hasPlanTurn` branch that calls `seedRejectPlannedSearches()`. The no-plan path already goes through `runDeterministic()` / `huntWriteReject()`.

Prove this call graph again on the current tree. If the invariant holds, the no-plan branch and the now-unreachable private helper are candidates for removal. Simplify only those `hasPlanTurn` conditions inside `runOwnedLoop()` that become tautologies. Keep deterministic no-plan gathering (`huntWriteReject()`), fail-open behavior, finish evidence recovery, and all planned-run gather/consume behavior intact. If any hidden or test-only caller invalidates the invariant, retain the code and explain why.

### Candidate B — high-responsibility files from the six-month audit

The referenced audit found large, high-churn modules: `src/chat/CoopChatSession.ts`, `src/server/orgApi.ts`, `src/webview/ChatPanel.tsx`, `src/webview/components/settings/SettingsDetailViews.tsx`, `src/api/agent/AgentOrchestrator.ts`, and `src/prompts/systemPrompts.ts`. It found no production file safe to delete based on evidence then available. These are responsibility-extraction candidates, not deletions. Keep them out of the pre-dogfood cleanup unless the current tree reveals a small, self-contained, behavior-preserving extraction with clear tests and no shared-file conflict. Prefer to defer broad extraction until after dogfood.

### Candidate C — client layers that look similar

`SecureApiClient` and `CoopBackendClient` have overlapping responsibilities, and admin/ops each have a large `coopApi.ts`. The audit found meaningful differences and did not establish safe deletion. Do not merge/delete these clients in this pass. Only report specific duplicated, caller-free code if reference tracing proves it.

## Parallel work model

Use agents in parallel for independent **read-only** audits: (1) validate Candidate A call graph and search all references, (2) inspect the listed large modules for concrete dead exports/call sites, (3) inspect tests and CI scripts for orphaned test files. Agents must return file/line evidence and exact proposed deletion scope; they must not edit shared files concurrently.

After those reports, one implementation owner makes the smallest approved patch. Then assign a separate read-only integration reviewer to inspect the complete diff and verify every acceptance criterion. The reviewer must not rubber-stamp the implementer’s summary; inspect code and run checks independently.

## Build plan and gates

### Phase 0 — Establish a safe baseline

Inventory the current dirty worktree, exact branch, and package/test scripts. Identify which Candidate A hunks predate this task. Save a path-scoped before snapshot (or equivalent) so added/removed line counts can be attributed without resetting the tree. Trace every candidate symbol with `rg` and inspect all callers.

**Pass:** no unrelated change is overwritten; ownership/baseline for each candidate is recorded; each deletion candidate has a complete caller/reference search.  
**Fail:** cleanup would require resetting or broad staging; baseline attribution is unclear; or the call graph is inferred from naming alone. Stop and report the blocker.

### Phase 1 — Delete only proven unreachable code

If Candidate A is confirmed unreachable, remove its dead no-plan branch/helper and simplify only tautological control flow local to `runOwnedLoop()`. Keep all reachable deterministic and planned paths. Avoid opportunistic formatting, rename churn, abstraction layers, and drive-by cleanup.

**Pass:** diff contains only the proven dead branch/helper and directly necessary tests or comments; no behavior contract changes; no new production abstraction.  
**Fail:** a reachable path changes search order, evidence attachment, finish behavior, action routing, or budgets; rollback that portion and explain it.

### Phase 2 — Regression and build verification

Run the focused suites that exercise planned and deterministic reject runs, Parent exact/paraphrase, C2 both-evidence completion, calm State declaration grounding, wrong-field/UI/bgtask negatives, and search-query shaping. Run `npm run lint`, `npm run build:extension`, and `git diff --check`. Run any dedicated test file touched even if it is not in `test:reject-hunt-fidelity`; determine whether it is included in `test:agent-ship:a` / CI before proposing script changes.

**Pass:** all relevant checks exit 0; tests prove both the retained deterministic no-plan fallback and planned `planTurn` path still work; no regression test is deleted or weakened.  
**Fail:** any failure, untested touched path, missing executable test script, or inability to distinguish no-plan from planned execution. Fix within scope or leave the cleanup unapplied.

### Phase 3 — Independent review and dogfood readiness

The independent reviewer checks the diff against Phase 0 ownership and every pass/fail gate, searches for stale imports/constants/helpers, checks test coverage and CI wiring, and verifies there is no hidden behavior change. Then confirm the three live probes in `docs/agent-dogfood.md` remain intact and exact.

**Pass:** reviewer finds no unreferenced residual helper introduced by this cleanup; all automated gates pass; dogfood asks still target Plane `preview` and the connected Documenso fork; the output is labeled **Ready for Reload dogfood — live Pass still open**.  
**Fail:** reviewer identifies scope creep, orphaned code left behind, incomplete tests, or a dogfood prompt drift. Correct and repeat review.

## Explicit deferrals

Do not decompose `CoopChatSession`, `orgApi`, `ChatPanel`, settings details, `AgentOrchestrator`, or prompt assembly as part of this pass unless Phase 0 proves one small extraction is required to remove the unreachable Candidate A code. Propose larger decompositions as separate, sequenced plans with characterization tests and their own release gates. Do not consolidate admin/ops clients without proving contract and auth equivalence.

## Final report format

Report:

1. Candidate-by-candidate decision: remove, retain, or defer, with caller evidence.
2. Files changed and why; files inspected but intentionally left alone.
3. Exact before/after line delta for the scoped files, separating production code from tests. Exclude pre-existing dirty changes and untracked artifacts from the claimed delta.
4. Commands run and pass/fail output.
5. Independent reviewer’s findings.
6. Dogfood status using the exact claim tier: **Automated Pass** / **Ready for your Reload dogfood — live Pass still open**. Never claim Fixed/live Pass until the user runs the named Extension Host probes successfully.

If no safe cleanup is proven, make no code changes and report that result. Do not manufacture a deletion target to satisfy the task.
