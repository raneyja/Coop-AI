# Repository hunt diagnosis and build plan

## Final October 2 status — 19:31 PDT

All21 live hunt cells (7 prompts × cold/warm/after-switch) pass on extension52e748e47f92bc479faa71d2076f0b4da16c3ade1f09e37a79c75038b7f7d016 and webview7d6dc75d48895b48069ad96d87953ed1ec623e5bd3433fbc6e4ae318982e7ab1. First answers4.584–9.004s. Stop/immediate recovery, draft preservation, remote citations and repeated startup are verified; automated pending-context gating and tests/lint/builds pass. Temporary diagnostics removed. See [final certification and exact results](repository-hunt-dogfood-2026-10-02.md). Earlier status sections below are historical and superseded.

The map failure was a rejected HTTP200 legacy preview map lacking provenance, not a missing map. Exact generation proof and the already-deployed API/worker fix restored discovery. Further repairs closed candidate ranking, false-premise verification, writer retention, selected-ref citations and UI hydration. The named acceptance scope is ready for release review; no extension publication, push or PR has occurred. Preserve all user changes and include deployed provenance source in a future authorized release.

If further dogfood fails, trace frozen ref/map→candidate→remote body→answer/citation→UI and fix the first divergence with a generic regression before replaying the final matrix. Reindex only for unprovable generation. The detailed chronological plan below is retained for investigation history.

Reviewed October 1, 2026. Sources: chat `01a0f43e-b9c7-78c1-a8da-eb4b0da69cde`, current main checkout, and `/Users/jonraney/.codex/worktrees/repo-research-rebuild/Coop-AI`. This is a code review and build plan; no new live replay or implementation verification was performed for this report.

**October 2 implementation update:** The bounded repair was implemented in main, preserving existing changes. Correlated live replay confirmed provider routing, field selection, compound read/attachment, and synthesis evidence-loss failures. The three named asks now return grounded source answers on the final candidate; the compound run took 58 seconds and remains a latency concern. See [repair and live verification](repository-hunt-dogfood-2026-10-02.md) for bundle identity, exact scope, removed behaviors, tests, and remaining limits. Historical findings below describe the pre-repair review.

## Assessment

The latest clean Extension Host observations in the linked chat fail all three acceptance asks: parent rejection, state write plus transition rejection, and backend state definition. An earlier parent pass did not reproduce. The narrow research rebuild does not establish a working general repository research system.

The proposed trace-first plan is correct, but insufficient by itself. Code inspection reveals contracts that need repair regardless of which retrieval stage fails first. Do not inspect every repo file or rewrite the whole application. Repair the bounded path from selected repository to rendered source evidence.

## Findings

1. **The build under review is not one coherent source tree.** The isolated worktree contains `repositoryResearch/engine.ts` and `task.ts`; the main checkout does not. Main has additional search fallback, diagnostics, and branch-resolution changes. The shared version label `0.1.10` cannot distinguish these candidates. Tests of one tree cannot certify the other tree's Extension Host.

2. **Agent tools lose repository branch context.** `AgentToolContext` exposes repository ID without a resolved target/ref. In the worktree, `extension.ts:481` reads with only `{ repoId }`, and `:487` searches filenames using coordinates without the active branch. Main resolves branch for reads at `extension.ts:482`, but filename and native content search still construct coordinates from repo ID alone at `:512` and `:521`. The Remote Workspace search explicitly passes `currentContext.branch` at `CoopChatSession.ts:10677`. This is a confirmed wiring mismatch, not proof that branch loss caused every observed miss.

3. **Search providers do not have interchangeable capabilities.** `githubClient.ts:538` constructs a code-search request without a branch constraint. `searchCodeAcrossRepos` can recover from unavailable content search using a tree filename search. `codeHostRouter.ts:361` returns these results as content-search paths without reporting that capability change. Passing a branch into this adapter will not alone make its code-search request branch-specific. Treat host search as candidate discovery and verify bodies on the resolved target; use the remote tree for selected-branch filename discovery where necessary.

4. **Finalization can discard required writer evidence.** The worktree research loop accepts `reject` and `state_writer` separately. `finishWithAnswer` at `AgentOrchestrator.ts:1071` then invokes `pruneContextToWriteReject`; its filter retains only bodies matching the requested rejection. A writer-only source can therefore be discarded after research declares completion. This is a concrete contract conflict; the reviewed live traces do not prove that this was the cause of their specific D2 misses.

5. **The research classifier is too narrow and can also accept weak proof.** `task.ts` hardcodes `issue.py`, `state.py`, and `serializer issue` for generic repository questions. It requires a field token within two lines of a rejection, which can miss valid multiline validation. Its state-writer regex can count a `state:` field or local `state_id` assignment without proving persistence or association with the rejected operation. Filename discovery must follow task terms and repository structure; evidence must establish the requested operation.

6. **Failures remain indistinguishable in parts of the proposed path.** The engine catches search exceptions without retaining an outcome. The filename fallback suppresses errors. The loop rereads classified evidence for attachment, creating another failure boundary. Main's native fallback has statuses, but `enrichCodeHostPaths` produces path-only hits even without matching bodies, so `results` does not mean verified evidence. These outcomes need distinct labels.

7. **Backend definition lookup remains a separate unresolved task.** The new task planner handles API rejection only. Plain state lookup still uses the existing locate path. The thread records irrelevant or import-only reads and inconsistent discovery of the actual model. Fixing the reject route cannot certify definition lookup.

## Ordered build plan

### 1. Establish a reproducible candidate

Inventory main and worktree changes and select one isolated candidate, preserving existing work. Integrate useful fixes deliberately. Record source revision, dirty-diff fingerprint, bundle fingerprint, build timestamp, repo, indexed ref, and resolved read ref in each diagnostic run. Capture the existing failure before changing retrieval behavior.

Gate: a replay can be tied to the exact source and bundle that executed.

### 2. Resolve the repository target once per run

Use the existing target resolver and `IndexedRepoWorkspace`. Carry a typed resolved target through all agent ports instead of reconstructing it from ID or reading mutable global preferences during each call. Preserve existing indexed-ref precedence and explicitly record any difference from UI selection. Search, read, cache identity, and citation provenance must use that target. Do not add local repository intelligence.

Gate: adapter tests use different contents on default and preview branches, plus a repo switch during an in-flight run. Reads and citations remain bound to the original resolved target.

### 3. Make discovery outcomes explicit and consume candidates

Return provider, capability, searched ref when known, candidate paths, and typed empty/error/unsupported outcomes. Keep content and filename search distinct. Trace raw hits, ranking/drop reasons, candidate selection, reads, and finish reason under one run ID. Do not routinely log source bodies or secrets.

Use bounded index/graph search first. When usable task candidates are missing, discover filenames through the selected remote tree or existing remote workspace service; verify remotely fetched bodies. Derive names from task terms and discovered symbols/imports, not Plane-specific literals. Do not keep issuing equivalent searches when useful candidates are waiting to be read. A failed index call should have an explicit policy for remote recovery.

Gate: tests cover UI-heavy hits, unavailable host content search, selected-branch-only files, provider errors, and useful candidates below irrelevant top hits. Traces distinguish no paths from unreadable bodies and rejected evidence.

### 4. Use one evidence contract from planning to answer

Represent the three tasks explicitly: field rejection; state persistence plus transition rejection; backend model declaration. Apply requirements to both model and rules plans. Store verified evidence with kind, target/ref, path, actual line range, source origin, and read identity.

Classify enclosing validation/definition/write blocks, using existing symbol information where available and bounded source windows otherwise. Require a relationship to the requested field and operation. A state property or serializer input alone is not persistence proof. An import alone is not a declaration.

Reuse the verified read for attachment. Preserve every required evidence kind during pruning and synthesis; do not apply reject-only pruning to writer evidence. Recheck completion against the exact final attached context and rendered source references. Partial answers identify the missing artifact plainly.

Gate: a writer and reject in separate files both survive finalization; multiline rejects pass; wrong-field rejects, unrelated writes, imports, and UI mentions do not satisfy completion. Same-file evidence retains both relevant ranges and real line numbers.

### 5. Verify the production path, then dogfood

Build regression fixtures from captured live search/read payloads. Exercise session routing, Extension Host adapters, ranking, remote reads, evidence acceptance, finalization, and source attachment together. Preserve existing auth/caller/vendor behavior and test another repository/language to catch Plane-specific assumptions.

Run targeted suites, `npm run lint`, and `npm run build:extension-dev`. Reload the fingerprinted bundle. Run fresh chats on `CoopAI-Corp/plane · preview` without incidental attached files:

- Parent: remotely read and cite the actual field validation/rejection.
- State transition: remotely read and cite both persistence/write and the relevant rejection.
- Backend states: remotely read and cite the actual model declaration.

Repeat clean runs to test the previously observed nondeterminism. A miss is a failed acceptance ask even when the answer correctly refuses to guess. Verify the opened citations show the selected source/ref and lines.

Gate: automated pass first; live pass only after the named Extension Host asks meet every attached-evidence requirement. Capture failures at their first divergent stage and add regression coverage before further tuning.

## Scope and confidence

### October 2 broader round: next gates

The original Plane fixtures and the additional Documenso signing guard have live evidence passes. Generic repairs now cover remote-read retention, domain-status checks, operation-specific reject evidence, frozen filename scope, search repetition, filename truncation, bounded traversal fairness, and early verification of operation candidates. Removed behavior includes local citation preference for explicitly selected remote repos, estate-wide filename lookup, forced generic `ValidationError` searches for fieldless asks, and treating PDF download rejection as signing rejection.

Remaining build gates:

The final 13:57 Plane parent replay missed despite its earlier live pass. Treat the original fixture as inconsistent until a correlated repeated run identifies and closes the divergent stage. Also investigate sidebar history/context hydration clearing early input or obscuring a submitted turn during repository switching.

1. Cold filename recovery: the bounded walk discovers the real handler but its first operation search took roughly 25 seconds. Route filename discovery through the durable indexed file map for the frozen repo/ref, preserving remote bodies for verification. Recheck cold and warm starts separately; warm results do not certify the cold response deadline.
2. False-premise correction: the Plane assignee fixture filters nonmembers rather than throwing the assumed membership error. Attached remote source produces the correct explanation; unassisted discovery must reach that evidence and correct the premise without inventing an exception.
3. Candidate lifecycle: avoid rereading/reclassifying disproven candidates in planner feedback, even when remote-body caching saves network calls. Record distinct unavailable, disproven, verified, and exhausted states.
4. Repeat the full live matrix on the final bundle: the three original Plane asks, signing, auth helper and remote citation, false premise, nonexistent symbol, Stop and immediate recovery, and repo/ref switching. Keep bundle identity and first divergent trace stage with each result.

Confirmed: source-tree divergence, missing branch context in agent ports, GitHub search capability ambiguity, writer evidence versus reject-only pruning conflict, narrow generic task rules, and incomplete diagnostics. The exact cause of each live miss still requires correlated replay; index coverage, ranking losses, and provider availability cannot be inferred from activity summaries alone.

The lasting solution is to make repository identity and evidence provenance explicit and test their preservation across the actual application boundaries. No finite build can guarantee zero future bugs; these gates make regressions reproducible and prevent mocked success from being mistaken for a working product.

## Continuation checkpoint — October 2, 2026, 15:20 PDT

Status: **blocked at Patch 3 live discovery; not fully fixed.** Patches 4–5 and the complete repeated certification matrix remain open. Production deployment and reindexing were not performed. No push or PR was made.

Final integrated extension SHA-256: `a6445a46ba300e1c2d43feef744287e9477c3b29e87d7455267d6179f3cb7630`.

### Preserved baseline and patch sequence

The dirty baseline rebuilt to the recorded `a33899e454827168c012479aff6976bd52c6495c3b4b80380e36b57321878b51`. Baseline lint, extension/webview builds, orchestrator 86/86, query/evidence 97/97, search fallback 17/17, remote-tree 6/6, remote-read 4/4, ranking 4/4 and target/cache isolation passed. The recoverable candidate checkpoint is `b24a78a9a167def38ad2c8c601eaf40d37b2817a`; original tracked and untracked snapshots are in `/private/tmp/coop-hunt-baseline-20261002/`. Unrelated dirty work was preserved. UI and retrieval implementation used separate worktrees and was integrated sequentially.

Patch 1 adds per-run diagnostics for frozen target/ref, exact task/query, index hits, filename criteria/results, remote reads, candidate decisions, stage timings and outcome. `scripts/repository-hunt-trace.mjs` compares exported traces without source bodies. The first successful-versus-failed divergence for the *same exact ask and same bundle* remains unproven: the historical successful trace used a different query/build. New failing traces consistently begin with `validate_parent`/`validateParent`, UI/email embedding hits, and unsupported native content search. On the earlier diagnostic bundle, cold filename discovery took 22.395 seconds and a repeat took 21.202 seconds; one miss finished around 96 seconds. These are failures, not latency passes.

Patch 2 preserves drafts during history/context hydration, adds thread/revision checks and submission IDs, shows user messages synchronously, gates Send while repo/ref resolution is pending, isolates stale streaming messages, and shares initialization. Live reload found two additional issues and prompted repairs: concurrent preferences refresh triggered a false account/thread reset, and completed Use-repo selection was not persisted. Auth hydration now preserves the draft; completed selections persist; restored explicit repo scope resists local-editor takeover.

Patch 3 wires agent filename discovery through `IndexedRepoWorkspace.findFiles`, requiring exact repository and explicit indexed branch provenance. The full durable path map is fetched once per frozen turn target, filtered before ranking/capping; file bodies still use remote selected-ref reads. Unknown/mismatched/stale maps are unavailable, never substituted by a slow remote walk or local clone. Backend graph metadata, deep-index persistence, branch-aware tree route and clients are updated together. Legacy unqualified tree consumers retain their API behavior.

### Named live results and concrete blocker

On UI bundle `4890ed8df3da4286b59f9c8348106bc17a1f6be1a00b4ed42f997dce168850c0`, the draft `Reload draft fixture — preserve me.` survived account hydration and reload. Plane `preview` selection survived reload instead of reverting to Untitled-2 Local. Send was disabled during selection and enabled after `preview` resolved. The exact parent question appeared immediately on Send; Stop displayed `Stopped.` and a subsequent question was submitted without reload. These are named UI checks, not the complete cold/warm/switch matrix. One automation misfocus submitted the draft and inserted text into Untitled-2; that turn was stopped and the scratch edit was undone before the exact fixture was rerun.

On final bundle `a6445a46ba300e1c2d43feef744287e9477c3b29e87d7455267d6179f3cb7630`, cold parent run `d25b0a11-c0db-4306-a41c-bcaa3f7a7dd2` selected/resolved `github:CoopAI-Corp/plane`, `preview`. First indexed filename lookup returned `indexed_map_unavailable` in **620 ms**; subsequent criteria reused the unavailable map in 0 ms. Outcome at **14.690 seconds** had no attached evidence and returned a short honest miss. Immediate repeat `c268f0ac-d705-4897-b876-561b732ac4ff` hit the same map gate in **615 ms**, with later criteria cached; the sidebar reported **15 seconds** and the same honest miss. No serializer rejection was found, so both parent correctness runs failed.

Concrete next gate: the running API did not provide a map accepted for the selected branch. The diagnostic deliberately reports unavailable without claiming whether the cause is absent map, missing/mismatched provenance, stale data or transport failure. Inspected baseline source does not write/expose `indexedBranch`; snapshots produced by that code require reindexing. Deploy the prepared backend/client contract and rebuild the selected repo maps with explicit provenance, then verify actual route responses before resuming candidate lifecycle and false-premise work. Do not mark deployment or reindexing complete from local tests.

### Final automated checks and remaining work

Final lint and extension/webview builds passed. Integrated checks passed: orchestrator/query fidelity, search fallback 18/18, ranking 4/4, frozen target diagnostics/cache isolation, workspace facade 13/13, new branch-aware file-map tests, hydration/startup tests, thread store 15/15, restore 6/6, trace harness and whitespace checks. Temporary `coopAI.agentDiagnostics` workspace setting was removed after captures. Diagnostic exports are in `/private/tmp/coop-hunt-baseline-20261002/` (`parent-replays.jsonl`, `indexed-map-cold.jsonl`, `indexed-map-replays.jsonl`).

Candidate lifecycle across all tools, generic assignee false-premise correction, final-bundle Documenso cold latency, citation opening, and all remaining repeated matrix cells are **not certified**. Primary retrieval/gather experiments remain isolated in `/private/tmp/coop-hunt-reliability`; they were not integrated or represented as shipped. Resume from the live map gate, then follow the requested patch order.


## Continuation — live map provenance gate cleared (October 2, 15:44 PDT)

This supersedes the earlier “blocked at Patch 3” diagnosis. Production returned HTTP 200 with the correct Plane file list (4,616 unique paths), but omitted indexedBranch/indexedCommit. The exact-org/repo inventory established preview at a8e53b6ac7b87bd8e3e931d21188f7679c7ab6c4; every map entry carried that same commit stamp. The cause was missing API provenance, not an absent map or a cold/warm transport failure.

The generic legacy-map proof requires exact selected branch, valid commit, full file-count parity, unique nonblank paths, and every file stamp matching inventory. Missing, mixed, stale, or mismatched evidence remains unavailable. New deep-index runs persist branch and head commit directly. Helper and HTTP-route tests cover both acceptance and rejection, including org/repo isolation.

A narrow clean-HEAD deployment artifact contained only graphCache, executors, graphHttp and the provenance helper/test. Its lint, API build, worker build and provenance tests passed. API deployment 3e585358-00e8-4a14-89ac-75f5fbef7e4b and worker deployment 5ff86337-8e6e-4b5c-a020-ecc22df14b6d report SUCCESS. No Git push was performed; source changes remain in the preserved working tree.

Live run 423c1629-6e9f-4908-bc1f-1c74486d95a7 on bundle f350da194c625c686194f775f3f90fff59d45d335bc895e2015419be11ada18a received explicit matching preview provenance, nonstale, 4,616 files. First map lookup took about 703ms; additional criteria reused it in 3–4ms. The exact parent question found the actual serializer rejection at apps/api/plane/api/serializers/issue.py:128–137; clicking the citation opened the selected remote preview source in Editor Group 2. Completion was 18.648s (UI19s); first-answer latency was not separately captured, so latency is not certified. Trace: /private/tmp/coop-hunt-baseline-20261002/map-provenance-confirmed.jsonl.

The actual remote serializer was saved to /private/tmp/plane-issue-preview.py solely as a regression-fixture capture. It must never become a runtime local intelligence source. Candidate lifecycle, faster generic entity discovery, unassisted false-premise correction, and the final repeated cold/warm/switch matrix remain in progress. Temporary diagnostics are currently enabled for certification and must be removed after capture.


## Integrated continuation candidate — Automated Pass; live certification paused

Final extension bundle: `861cd8b51e72735986ff1853903536b621cf8269cc7dbb6b13264068f6049163`. Lint, extension/webview build, hunt fidelity (orchestrator90/90, query97/97, retrieval22/22, repository-independent rules4/4), field-handling classifier, candidate ledger, gather handoff, frozen-target tests, and trace harness pass. The entire indexed-workspace suite and chat-thread/hydration/startup suite pass. Shared response-deadline/turn/history checks and whitespace checks pass. Two stale version assertions were changed to follow the actual build ID rather than hardcode0.1.0.

Integrated changes after the live map repair:

- Candidate statuses and request memory belong to each frozen turn. Equivalent hunts reuse their results; distinct lexical casing aliases and phrase/literal host queries retain their separate coverage. Ruled-out full-body candidates do not trigger another body fetch when criteria are refined. Final diagnostics retain the candidate snapshot.
- Indexed path nouns can suggest a bounded entity filename; shared package roots are stripped and all candidate bodies remain remotely fetched and verified. Every filename criterion verifies its candidates before further discovery.
- The alternative field-handling classifier requires an explicit remote-read complete validation/writer method showing input -> filter -> replacement -> return. The captured assignee method reaches synthesis with its full method preserved. The final instruction corrects the observed premise without claiming no other validation can fail. Compound reject/write questions still require actual rejection plus write evidence; filtering cannot produce an affirmative rejection claim.
- Shared gather time now covers target resolution, index readiness/search, filename/host search, body reads, directory/blame, tool planning and integration gathering/interpretation. Expiry stops waiting and starts synthesis with verified evidence; it does not abort the turn signal. First visible answer timing is recorded and correlated with retrieval runs. A target that cannot be resolved yields a short limitation instead of an unverified branch fallback.

The Mac locked during fixture-editor cleanup, and computer use reported it could not unlock automatically. A second check after final build confirmed it remains locked. The final bundle above has **not** been loaded or live-certified. The previously successful parent run belongs to f350da... and the deployed map repair, not this final candidate. No additional cold/warm/switch cells, final unassisted assignee pass, or final first-answer latency are claimed. The captured fixture tab may remain open; close it before unassisted tests. The explicit remote repo selection remained Plane/preview when access stopped.

Temporary `coopAI.agentDiagnostics` was removed from the workspace after captures, and the extra inventory-lineage probe was removed from the API client. Persistent opt-in content-minimized diagnostics remain. Existing user edits are preserved; no Git push or PR was performed. Production API/worker provenance fixes were deployed directly from the narrow artifact; they must be included in a future authorized commit/push so a later Git deployment does not replace them with older source.

### Resume and failure decisions

1. Unlock the Mac. The agent enables diagnostics for capture, reloads the Extension Development Host, verifies the exact final bundle, closes the saved local fixture tab, and keeps only the selected remote repo/branch (no attached source).
2. Run parent and assignee cold, warm, and after a different-repo switch. Open each remote citation. Then run Documenso signing, Coop bearer, State, transition/write, nonexistent-symbol, Stop/recovery, switching/draft and reload/startup cells from the exact acceptance matrix above. Capture first-answer timing separately from completion.
3. If the map becomes unavailable: inspect HTTP status and explicit provenance for that exact repo/ref. Reindex only that selected target if its stored generation cannot prove branch/commit/count parity; do not walk a local clone or search the full estate.
4. If the map is valid but discovery misses: compare criteria, ranked candidates and ruled-out reasons. Repair generic discovery/ranking and add the observed regression before repeating the failed cell.
5. If the correct remote body was read but the answer misses or misstates behavior: inspect evidence retention and final gates. Preserve the complete proven method, actual rejection precedence and verbatim line mapping; add an orchestration regression.
6. If correctness passes but first-answer timing exceeds15s: use stage timing to identify the wait outside the shared gather budget or unnecessary sequential work. Fix that wait; retain short honest missing-evidence answers and UserStop-only cancellation.
7. If repo/ref, draft, submitted prompt or stream state changes incorrectly: inspect the hydration/thread revision boundaries, fix the lifecycle race and repeat switch/reload/Stop checks. Do not accept waiting for hydration as the fix.
8. After all cells pass repeatedly: remove capture settings, update the live record, rerun checks only if source changed, and save the certified candidate. Until then status is Automated Pass, ready for agent-run Reload dogfood; full ship gate remains open.
