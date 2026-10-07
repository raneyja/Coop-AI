# Plane live dogfood failure analysis

**Date:** 2026-09-30  
**Scope:** Three Extension Host runs on `CoopAI-Corp/plane`, branch `preview`  
**Request:** Explain why questions 1 and 2 failed, why question 3 produced a partial answer, then execute the phased build plan with explicit gates. The original transcript analysis remains evidence-bounded; implementation status is recorded below.

## Executive assessment

This is **both an agent gather/prompt problem and a pipeline/evidence-contract problem**. The rails did one important thing correctly in questions 1 and 2: they refused to invent a server reject when the run had not established attachable evidence. But they also expose two gaps: the search loop can spend its budget without consuming results, and the finish fallback continues with more searches instead of turning evidence into reads. Question 1 is the sharper rail failure: the activity says the correct serializer was read, yet the turn still reached the canned miss.

Question 3 is a separate **definition-locate evidence** problem. It was not classified as an API reject hunt. The answer correctly surfaced the serializer's import of `State` and admitted the model body had not been opened, but it still answered the requested model location from indirect evidence and mentioned routing paths whose bodies were not read.

The transcripts do not contain raw `search_code` results, `preferredHits`, exact `read_file` payloads/line windows, the full prompt sent on each `planTurn`, the intent brief, or an extension build identifier. So the precise Q1 rejection point and the actual indexed State model path cannot be proved from these summaries alone. Findings below separate observed facts from likely causes.

## What the activity establishes

### Question 1 — Parent reject paraphrase

Ask: “A client sent a parent that isn’t in this project — the API returns an error. I don’t have this repo cloned. Where does the API reject a bad parent issue_id?”

- **Observed:** five searches; the search sequence included `parent_issue_id`, `"parent" "issue_id"`, `parent`, `parent_issue`, and the labeled finish query `parent is not valid (reject quote)`.
- **Observed:** it read `serializers/issue.py` twice and also read `bgtasks/issue_activities_task.py`.
- **Observed:** final answer was the canned API reject miss.
- **Confirmed diagnosis:** the request was recognized as a reject hunt (the miss copy is the reject-specific rail), but the evidence accepted by the final answer path did not contain an attached, matching Parent reject.
- **Likely gather issue:** searches mixed an identifier, broad field terms, and a late phrase recovery. The Bgtask read is not the server validation site; the activity does not show a successful read of the actual raise window.
- **Likely rail issue:** the summary says the right serializer was read, but the finish still missed. That means at least one of these remains possible: the read body/window did not include the raise; the remote body differed from the index hit or active branch; the body/snippet matcher rejected the unquoted paraphrase; the right path was not retained as a jump candidate; or pruning/final evidence checks dropped it. The activity list alone cannot distinguish them.
- **Prompt contribution:** the user omitted the exact error string and create/update wording. The general reject brief still says to find the asked field, but this prompt gave the agent less job context than the exact Parent gate. The prompt is a contributor, not a sufficient explanation for missing after a read of the correct path.

**Conclusion for Q1:** primarily an evidence-consumption/finalization failure after weak gathering. This is not explained by “the model chose bad search terms” alone. The next trace must show the exact returned serializer snippets and read windows to isolate matcher, branch/body, or finish-context loss.

### Question 2 — State transition reject

Ask: “Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?”

- **Observed:** seven searches and **zero reads**.
- **Observed:** first four searches were `"work item" state`, `work item`, `state transition`, and `backlog state`.
- **Observed:** the final three were labeled `(reject quote)` / `(reject invent)`: `transition is not valid`, `class IssueTransitionSerializer`, and `IssueTransitionSerializer`.
- **Confirmed diagnosis:** no write/reject body was attached, so the short miss was honest under the current evidence rail. The run failed the product task because gather never produced evidence.
- **Strong pipeline signal:** four unlabelled agent searches are followed by the quote/invent searches emitted by the finish fallback. This is consistent with the four-search reject streak cap ending the agent loop, followed by finish recovery. The fallback added searches, not reads, and did not improve evidence.
- **Prompt/quarterback failure:** the initial queries are topic-shaped but weak index queries; the later invented class name is a speculative symbol guess. The planner contract explicitly asks for index-ready server validation phrases, but this run did not converge on a read candidate.
- **Intent/evidence-shape mismatch:** the ask contains two deliverables—where the state is written and what rejects the transition. The reject brief's completion criterion is essentially “attach a write-reject for the asked field.” That can lose the write-site half, and a single generic field matcher does not represent both required artifacts.
- **Retrieval uncertainty:** without returned search hits, we cannot tell whether the index had a useful `state_id`, `validate_state`, or transition-validation hit that was ignored, or whether all searches were empty/irrelevant. The no-read activity makes that distinction decisive.

**Conclusion for Q2:** primarily agent-owned gather and query-quality failure, amplified by the four-search cutoff and finish-time search fallback. The miss rail itself behaved honestly; it did not rescue the task because no usable result was consumed.

### Question 3 — Calm state definition locate

Ask: “Where do work-item states live in the backend?”

- **Observed:** ten searches and one read: `apps/api/plane/space/serializer/state.py`.
- **Observed:** the read showed `StateSerializer` importing `State` from `plane.db.models`; the transcript explicitly says the model body and URL routing bodies were not opened.
- **Observed:** the answer identified the import/module relationship but also discussed API routing paths found through search without reading their bodies.
- **Confirmed diagnosis:** this stayed on the calm locate path; it did not emit the API reject miss. The answer was partly grounded, but it did not locate/open the model declaration requested by “where … states live.”
- **Pipeline/evidence gap:** the current calm-state success predicate can be satisfied by a generic matching read. The stricter model-definition predicate exists for the *compound auth + state* ask, but the plain state locate does not use an equivalent “opened the model declaration” gate. A serializer import therefore acts as enough grounding to answer.
- **Gather issue:** the search activity kept trying variants of `State` but did not produce or consume a model-definition hit. The run used ten searches for a one-file read, which points to weak stopping/adaptation and possible empty or low-value search results.
- **Answer-quality issue:** the answer disclosed its limitation, which is good, but then expanded into routing claims that were not supported by opened bodies. Evidence honesty is present but not enforced tightly enough in the final answer.

**Conclusion for Q3:** not a reject-rail problem. It is a definition-locate contract/ranking issue plus answer grounding: a serializer that imports a model is supporting evidence, not proof of the model's declaration location or route wiring.

## Is it the rails, pipeline, or prompt?

- **Prompt / quarterback:** yes. Q2 demonstrates that the chosen search progression did not turn the natural-language job into index-ready code terms. The task's own agent prompt tells the model what “done” means, but it does not guarantee that the next query is grounded in prior hits or that a useful hit is read.
- **Gather pipeline:** yes, most clearly in Q2. A search streak can terminate the agent loop without any read; finish then runs labeled query fallbacks. This produces a seven-search, zero-read turn. Search and consume are not enforced as a single loop invariant.
- **Evidence/finish rails:** yes, most clearly in Q1. The right serializer appears in activity, but the final context still fails the reject evidence check. We cannot name the exact sub-rail without raw read/search payloads. In Q2, the rails correctly avoid fabricating a reject but do not make gathering effective. In Q3, the state-locate gate accepts weaker evidence than the user asked for.
- **Index/backend availability:** unresolved. The summaries do not expose hit counts, file refs, snippets, index freshness, read branch/ref, or read payloads. Do not attribute the failures to Plane index quality until those are captured.
- **Build/version provenance:** unresolved. The repo currently has broad uncommitted changes, and the transcripts do not identify the Extension Host build or confirm reload after those changes. Source-level findings are therefore a strong explanation of the present path, not proof that these exact files produced these exact runs.

## Build plan

### Phase 0 — Capture evidence for one replay of each ask

Record, with secrets redacted: extension build/commit ID; full intent plan and brief; exact `planTurn` prompt and JSON response per round; search args and raw result metadata (`total hits`, file path, line, snippet, score, preferred vs raw); read args including branch and line window; returned body; skip/jump/matcher decisions; ledger before finish; finish reason and final answer context. Keep one trace for the exact Parent ask, the paraphrase, C2, and calm state locate.

**Gate:** we can identify whether each failing search was empty, poorly ranked, ignored by the model, filtered by rails, or read from the wrong body/ref.

### Phase 1 — Make intent completion match the ask

Represent compound state-transition asks as two explicit evidence needs: (1) server state write/update site and (2) validation/reject condition. Keep calm “where do states live?” as a definition job requiring the state model declaration. Keep Parent paraphrase as a field-reject job even without a quote. Treat search criteria as hints, not the completion contract.

**Gate:** tests show correct class, field, and evidence requirements for all three asks, plus negatives proving calm state locate does not become a reject hunt.

### Phase 2 — Enforce gather-then-consume behavior

For reject hunts, after every search with a candidate hit, attach the matching reject snippet or read the candidate before issuing another search. When no candidate exists, ask the agent to refine from returned search evidence; do not spend a hidden finish budget on quote/class-name guesses. Track the reason for each continued search and preserve a bounded ledger across merges. Keep the soft response clock; return partial, honest findings when exhausted.

**Gate:** no replay can show repeated searches with available actionable hits and zero reads/attachments; no finish-only search parade.

### Phase 3 — Close the Parent read-to-miss gap

Trace the exact file/ref/window from search hit through `read_file`, full-body fallback, same-file jump, snippet attachment, context pruning, and final gate. Add regression cases for the observed sequence: unquoted Parent paraphrase → broad search hits correct serializer → first read misses the raise window/body → later search overwrites context → finish must attach/jump or give a precisely bounded miss. Verify quote and message-only Zoekt shapes against the same matcher used by live code.

**Gate:** exact and paraphrased Parent asks both attach the actual server raise after the observed path sequence, or produce diagnostics that identify why the file is unavailable.

### Phase 4 — Tighten calm definition-locate evidence and answer grounding

For “where do states live,” require an opened declaration/model body (or label the response explicitly as an indirect import/serializer finding). Do not state route wiring from path names alone. Stop after the definition is found or a bounded index miss is established; avoid ten near-duplicate searches.

**Gate:** the calm ask cites the State declaration path/body; missing model evidence yields a short transparent partial answer without unsupported route claims.

### Phase 5 — Automated and live acceptance

Add Extension Host-shaped fixtures for all four dimensions: Parent quoted/unquoted, state write+reject, calm state model locate, and wrong-field/UI/bgtask negatives. Run lint and the targeted suites. Then reload the Extension Host and repeat on indexed `plane` / `preview` / no chip / fresh thread. Treat automated green as readiness only; call live pass only after the tool trace and answer meet the criteria.

## Suggested acceptance matrix

- **Parent paraphrase:** correct server raise attached/read; no reject miss; no unsupported essay.
- **State transition:** both the write site and the actual bad-transition rejection are attached; no UI-only result; no search-only completion.
- **Calm state locate:** actual model declaration opened, or the answer clearly labels the serializer import as indirect evidence; no ValidationError scavenger.
- **Across all runs:** report search count, read count, attach count, selected branch/ref, first useful hit round, and finish reason.

## Files to inspect in the build phase

- [AgentOrchestrator.ts](/Users/jonraney/Coop-AI/src/api/agent/AgentOrchestrator.ts) — prompt/loop, four-search streak cap, auto-consume, finish and reject miss recovery.
- [searchQuery.ts](/Users/jonraney/Coop-AI/src/api/agent/searchQuery.ts) — reject-vs-calm classification, field tokens, query selection, path filtering, evidence matcher, state-locate ranking.
- [parseAgentToolPlan.ts](/Users/jonraney/Coop-AI/src/api/agent/parseAgentToolPlan.ts) — per-round instruction construction and done/read rules.
- [planChatIntentModel.ts](/Users/jonraney/Coop-AI/src/chat/intentPlanner/planChatIntentModel.ts) and [planChatJobs.ts](/Users/jonraney/Coop-AI/src/chat/intentPlanner/planChatJobs.ts) — quarterback job/evidence-class and search criteria.
- [dogfoodContract.ts](/Users/jonraney/Coop-AI/src/api/agent/dogfoodContract.ts) — canonical asks and intended pass/fail boundaries.

## Phased implementation and acceptance results

| Phase | Pass/fail criteria | Result |
|---|---|---|
| 0. Capture replay telemetry | Raw prompt/intent, search hits, read bodies, branch/build ID, and finish reason identify the precise live failure point. | **Partial; fail.** Post-build live prompts, selected repo/ref, activity summaries, candidate filenames, skipped-read outcomes, and final answers were observed. The Extension Host does not expose raw/preferred hit pools, exact read payloads, intent/planner prompts, or drop reasons, so the first failing internal stage remains unresolved. |
| 1. Intent contract | Compound state transition requires both `write-site` and `write-reject`; calm state locate remains definition work; Parent paraphrase remains reject work. | **Pass.** Paired evidence markers now gate C2 completion; unit cases cover reject-only failure and both-artifacts success. |
| 2. Gather then consume | Reject searches consume actionable hits; planned runs do not add finish-only quote/invent search parades; empty-search streak is bounded. | **Pass in automated fixtures.** Tests cover candidate auto-read/attach, planned-run fallback behavior, and stopping after four empty searches. Live telemetry remains unavailable. |
| 3. Parent read-to-miss | Exact/paraphrased Parent evidence is attached through wrong-window/raw-hit recovery, or yields a bounded miss; no false miss while usable hit remains. | **Pass in automated fixtures.** Parent paraphrase and wrong-floor/raw-hit cases are covered. Live Extension Host result is not established. |
| 4. Calm definition locate | Serializer/import-only evidence cannot answer; opened State declaration can; unsupported route claims are excluded. | **Pass.** End-to-end Orchestrator regression first reproduced the leak, then passed after the final locate gate was tightened. |
| 5. Automated and live acceptance | Lint and targeted suites pass; live Extension Host replay passes before claiming product fix. | **Automated pass; live fail.** The 2026-10-01 post-build D1 and D2 replays completed in Extension Host against the visible `CoopAI-Corp/plane · preview` context, but both returned the reject-hunt miss without attachable source evidence. Calm state locate also failed; its visible activity showed 8 searches and 5 read events, but the reads were a frontend utility and unrelated story files, not the backend model declaration. Thus no live acceptance criterion passed. The webview continued to display “Syncing context…” while accepting prompts; that label alone was not a blocker. Automated verification remains green: `npm run lint`, `npm run build:extension`, `npm run build:webview`, `npm run test:reject-hunt-fidelity` (Orchestrator 83/83 and query 91/91), `npx tsx src/chat/intentPlanner/intentQuarterback.gates.test.ts` (11/11), `npx tsx src/api/agent/vendorLoop.test.ts` (14/14), `npx tsx src/api/agent/tools/searchCode.test.ts` (7/7), and `git diff --check`. |

### Scope and code-size accounting

The phase work changed the intent brief, evidence checks, search/gather behavior, and regression tests; no Plane-specific path or symbol exception was added. The pre-existing worktree already contained extensive modified files and untracked artifacts, so whole-worktree totals are not attributable to this task. The final tracked diff is 4,904 insertions / 184 deletions versus `HEAD`, and 5,437 lines of untracked material also exist; neither total is a valid task-only code count. Comparing the recorded pre-phase `git diff --numstat` snapshot with the same phase-owned files now gives a **net increase of 525 lines**: about **165 production lines** and **360 test lines**. In numstat terms, the changed diff has 532 more insertions and 7 more deletions than that snapshot. Because the files had overlapping dirty hunks, that insertion/deletion split is a diff-stat delta, not a claim that exactly 532 wholly new lines and 7 discarded lines were authored. Do not describe the aggregate worktree delta as this change's size.

No commit was made. No claim is made about the actual Plane model declaration path, index freshness, or exact payloads from the original live runs; those facts remain unavailable from the supplied transcripts.

## Addendum — D2 Extension Host replay before implementation (2026-10-01)

The user reran the exact state-transition ask in a single chat with `CoopAI-Corp/plane · preview` selected. This is a new live observation after the earlier report and must not be conflated with the earlier D2 transcript, which showed seven searches and zero reads.

**Observed:** four searches (`work item state`, `work item`, `backlog`, `work_item`); two remote reads (`bgtasks/work_item_link_task.py` and `serializers/project.py`); no attached source evidence; final answer: “I couldn't find where the API rejects that field: the indexed searches yielded no attachable reject snippet, and no opened file confirmed it. I won't guess a path.” The opened files did not establish either requested artifact: the state write site or the invalid-transition rejection.

**What this changes:** the new run rules out a pure no-read account for this replay. Gathering advanced to file reads, but converged on irrelevant files and still produced no evidence-backed answer. The final refusal was appropriately evidence-bound; it does not make the dogfood result a pass.

**What remains unproven:** this transcript does not include raw hit lists, hit counts, scores, index freshness, exact read bodies/ref, `preferredHits`, planner prompts and responses, whether reads were model-selected or auto-consumed, or the write-site/reject matcher decisions. Therefore it does not establish an index defect, a prompt defect, or an evidence-gate defect individually. The broad query progression and irrelevant reads make planner/query selection and retrieval ranking plausible contributors, while absent raw hits/read payloads prevent distinguishing them. The exact final evidence-gate behavior also cannot be audited from the user-visible transcript alone.

### Required diagnostic replay to isolate the first failing stage

Capture one correlated D2 turn with: extension build identifier; selected repository/ref and index status; full intent/quarterback result and each per-round planner prompt/JSON; each search query plus raw and decorated/preferred hit metadata (path, line, snippet, score, source, count, and drop reason); every selected or automatic read with ref/window and returned body; write-site and reject matcher results; evidence ledger and finish reason. Keep source snippets bounded and redact secrets.

Classify the first point relevant evidence disappears:

- No relevant raw hits on verified `preview`: retrieval/index coverage or query execution.
- Relevant raw hits omitted from preferred/model-visible candidates: ranking/filter pipeline.
- Relevant candidates visible but broad searches or irrelevant reads continue: planner prompt/model/tool selection.
- Correct file/body read but evidence not attached or predicate fails: read/attachment/matcher/finalization rail.

Until that trace is available, diagnosis is **gather failure confirmed; prompt/planner contribution plausible; retrieval/ranking and evidence-consumption root causes unproven**. This was the pre-implementation replay; subsequent implementation and automated evidence are recorded below.

## Addendum — Implementation and final acceptance (2026-10-01)

The implementation addressed four independently testable failure classes without adding Plane-specific paths or symbols:

- **Intent contract:** explicit API write-plus-reject questions retain both `write-site` and `write-reject` evidence requirements when the model planner omits or misclassifies one. Calm definition-locate remains distinct.
- **Gather/query behavior:** for reject hunts, the first search is deterministic and uses the exact quoted error when present, or an ask-derived validation criterion for paraphrases. Planned runs do not fall into a finish-time parade of speculative quote/class-name searches.
- **Prompt contract:** the per-round instructions now state that an exact quoted error overrides generic short-query guidance, and that compound write-plus-reject requests are incomplete until both evidence floors are met.
- **Evidence provenance:** search excerpts are marked as snippets; only remotely opened file bodies count as read/attached source evidence. Candidate search results are remotely opened before being attached as proof. A snippet without a successful remote read now leads to a bounded, explicit unverified-source response.

### Acceptance results

| Criterion | Result | Evidence |
|---|---|---|
| D1 exact Parent error | **Automated pass; live fail on paraphrase.** | Tests exercise the exact quoted query and require a remote body before source-backed success. The post-build paraphrased live ask still returned a miss; see the Extension Host dogfood addendum. |
| D2 paraphrased backlog transition | **Automated pass; live fail.** | Planner and orchestration regressions require both state-write and invalid-transition evidence; first query is ask-derived; snippet-only candidates cannot satisfy either floor. The post-build live ask still returned a miss; see the Extension Host dogfood addendum. |
| No speculative finish search parade | **Automated pass.** | Fidelity/vendor-loop tests cover planned-run finish behavior and bounded search handling. |
| Calm state definition locate | **Automated pass; live fail.** | Serializer/import-only evidence does not satisfy the model-declaration criterion; answer cannot claim unopened route wiring. In the live replay, search/read selection did not reach and open the backend model declaration. |
| Extension Host production behavior | **Live fail.** | The extension accepted prompts despite the “Syncing context…” label, but all three named live acceptance asks failed to produce the required source evidence. |

**Overall status at the time of this addendum:** automated implementation gates pass. Production readiness and “fixed/live pass” are **not claimed** until D1/D2 plus calm-locate dogfood asks pass against `CoopAI-Corp/plane · preview` with attached remote-read evidence.

**Independent review follow-up:** the reviewer found one remaining wording conflict in the compound prompt: a generic rule treated a read that was not itself a reject as insufficient, even when it supplied the write-site floor. The prompt now says that satisfying one floor is progress and only the missing floor should be gathered. A regression assertion confirms the contradictory wording is absent; `vendorLoop` remains 14/14 after this edit, `git diff --check` passes, and lint was rerun.

### Worktree accounting and limits

The worktree contains substantial unrelated/pre-existing dirty content. The report's prior snapshot comparison estimated the phase-owned changes at a net +525 lines, but the latest evidence-provenance and prompt edits changed that baseline. A clean task-only line count cannot be derived from `HEAD` because the phase-owned files already contained overlapping dirty work before this task. Current `git diff --numstat` for the principal implementation/test files is 4,513 insertions and 205 deletions versus `HEAD`; that aggregate includes prior dirty hunks and is **not** a measure of this task's authored code. No commit was made.

The earlier live trace at `/tmp/coopai-reject-hunt-trace.log` was diagnostic and has been removed after its findings were captured above. Temporary trace hooks were removed from source; a repository search found no `TEMP reject-hunt-trace`, `logRejectTrace`, `summarizeRejectTracePayload`, or `onTrace` instrumentation remaining.

## Addendum — Post-implementation Extension Host dogfood (2026-10-01)

The extension build was loaded in the Extension Development Host. The three canonical asks were run with the conversation visibly scoped to `CoopAI-Corp/plane · preview`; the repository chip and prompt transcript both showed that repo/ref. The webview continued to display “Syncing context…” but the composer was usable and the backend completed each submitted turn. This supersedes the earlier statement that the UI prevented live replay.

| Ask | Live observation | Result |
|---|---|---|
| D1 Parent paraphrase: “A client sent a parent that isn’t in this project — the API returns an error… Where does the API reject a bad parent issue_id?” | Completed in 11s. Final response: “I couldn't find where the API rejects that field: the indexed searches yielded no attachable reject snippet, and no opened file confirmed it. I won't guess a path.” | **Fail.** It did not locate or attach the serializer raise. The activity summary for this replay was collapsed before it could be inspected; raw hits and read payloads were not visible. |
| D2 backlog transition: “Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?” | Completed in 12s. The activity showed two searches (`state is not valid`, `work item state`), no successful file reads, and the concise reject-hunt miss. | **Fail.** Neither requested artifact was surfaced. The UI trace does not expose raw candidate hits, so it cannot establish whether retrieval returned the right files. |
| Calm locate: “Where do work-item states live in the backend?” | Completed in 28s. Activity showed 8 searches and 5 read events. It listed `packages/utils/src/work-item/state.ts` and four unrelated `packages/propel/...stories.tsx` files; each read event was marked `read_file skipped (mention)`. Final response: “I couldn't find that in this repo. Try a more specific name, or open the file.” | **Fail.** No backend `State` model declaration was opened or cited. Search drifted to a frontend utility and unrelated story files; the UI alone cannot distinguish ranking/filtering from planner/tool choice. |

### Updated diagnosis and remaining build plan

These post-build results prove the implementation has **not** achieved live acceptance. D1 and D2 still fail to produce a user-visible source read/attachment. Calm locate also fails and selects irrelevant candidates. The final responses remain bounded and avoid inventing a path, so the refusal behavior is working; the task failure is upstream in candidate discovery/selection/read execution or the hidden evidence handoff. Current automated fixtures do not faithfully cover these live candidate shapes.

The live UI does not expose raw candidate lists, hit counts/scores, exact tool arguments, read payloads, plan prompts/responses, or drop reasons. Therefore these replays cannot establish whether the primary defect is index coverage, search ranking/filtering, quarterback/prompt query selection, remote-read execution, or evidence attachment. Do not call this an index defect or a prompt-only defect based only on the visible trace.

Next diagnostic/build work:

1. Add a privacy-safe correlated trace for one D1 and one D2 replay: selected repo/ref/build, planner intent and prompt, raw/preferred search candidate path/line/snippet/score/count, read attempts and outcomes, evidence-ledger transitions, and finish reason. Avoid full source bodies and secrets in routine logs.
2. Replay against the exact live index/ref. Locate the first stage where expected server files disappear: absent raw candidates means query/index coverage; raw hits missing from preferred candidates means ranking/filtering; visible candidates followed by irrelevant reads mean planner/tool choice; correct reads without attached floors mean read/evidence rails.
3. Add regression fixtures from captured live payloads, including irrelevant frontend hits and skipped mention reads. Change only the failing layer and preserve the fail-closed answer behavior.
4. Repeat D1, D2, and calm locate in fresh Plane `preview` chats. Pass only when each requested artifact is remotely read and attached (or a precise bounded miss is supported by diagnostic evidence); calm locate must open the backend model declaration and avoid route claims without route reads.

**Current ship decision:** no production-ready or live-fixed claim. Automated checks pass; all three live acceptance asks fail.

## Addendum — User-reported Extension Host replay (2026-10-01, 1:37–1:40 PM)

The user ran three fresh dogfood turns against `CoopAI-Corp/plane · preview` and supplied the visible activity and responses. These are separate observations from the earlier post-build replay above; do not merge their activity counts with that run.

| Ask | User-provided observation | Result |
|---|---|---|
| D2 state write + bad-transition reject | Five searches (`validate_state`, `work item state`, `workitem`, `IssueState`, `state =`); opened intake base, intake view base, and the issue serializer. The response says it found the server-side state rejection but not the state write/update site. | **Partial / overall fail.** Reject evidence was located sufficiently to report it, but the compound ask requires both the state write site and the rejection. The state-write evidence floor remains unmet. This is progress over the prior D2 miss, but not a pass. |
| D1 Parent, first run | Four searches (`not valid issue_id`, `"parent issue"`, `parent_issue_id`, `parent_issue`); no file was opened. The response says no attachable reject evidence was found. | **Fail.** The hunt stopped before a source read. Visible activity cannot distinguish absent index candidates from ranking/filtering, planner/tool selection, or a failed read that was not shown. |
| D1 Parent, second run | Four searches (`not valid issue_id`, `parent_issue_id`, `parent`); activity details show `read_file skipped (no write/reject)` for `apps/api/plane/utils/porters/serializers/issue.py` and `apps/api/plane/bgtasks/issue_activities_task.py`. | **Fail.** Selected candidates were not accepted as a server-side field rejection. The activity confirms candidate/read-stage rejection, not a successful attached read. It still omits the raw hit pool and rank/drop metadata, so we cannot determine whether the correct `apps/api/plane/app/serializers/issue.py` was absent from search results or lost before selection. |

### What the new observations establish

- D2 is no longer a total hunt miss in this replay: the agent surfaced the server-side transition rejection after searching a code-shaped token (`validate_state`). The remaining miss is specifically the other half of the compound request—the state assignment/write path. This is consistent with an incomplete gather plan or ranking/selection of only the first useful sibling, rather than a finish rail incorrectly inventing success. The final answer correctly reports partial evidence instead of claiming the whole question was answered.
- D1 failed twice at different visible points: once before any read, once after candidate reads were explicitly skipped as having no write/reject. The second run selected a porter/import serializer and an activity task, not the known API issue serializer. This makes “the prompt alone is broken” and “the finish rail alone is broken” inadequate diagnoses. Discovery/selection is not reliably surfacing the relevant endpoint serializer; the evidence gate is doing its safety job by refusing to attach those candidates.
- The prompts are not identical evidence of a single query bug: D2 used a strong field-shaped query and found the reject; Parent used field-shaped and paraphrased queries but had no accepted candidate in one run and selected irrelevant candidates in the other. The explicit `no write/reject` skip rules out a finish-rail false positive and makes a bad read window less likely for the porter/background-task files, but the UI still omits the raw candidate set, ranking/drop metadata, and read windows. We therefore cannot decide whether the correct app serializer was absent from the index results or suppressed by ranking/filtering/quarterback selection.
- The report’s earlier controlled trace remains the only layer-attributed evidence: it showed relevant-looking raw hits being lost before preferred/model-visible candidates, and later skipped reads. The new user-provided transcripts are compatible with that retrieval/gather weakness but do not independently prove that the same internal failure recurred.

### Updated next diagnostic steps

1. Capture one D1 and one D2 attempt with a correlated, content-minimized trace: plan source/intent brief and queries; raw and preferred candidates with path, score/rank, and filter/drop reason; each read request, returned path/window, and outcome; evidence-ledger additions/rejections; and finish reason. Capture the exact build and repo/ref. Do not log full source bodies or secrets. For D1, specifically track whether `apps/api/plane/app/serializers/issue.py` appears at any stage relative to the selected `utils/porters/serializers/issue.py` candidate.
2. For D2, verify why the write-site target is not gathered after the reject site is found. Pass only when both a remotely read state assignment/update site and a remotely read invalid-transition check are attached and cited.
3. For D1, verify whether the exact app serializer containing the Parent validation raise appears in raw results, survives ranking/filtering, is selected, and returns the relevant read window. Pass only when the raise is remotely verified and cited; search snippets alone do not count.
4. Change only the first proven failing layer, preserve bounded/fail-closed answers, add a regression from the captured live payload, then rerun the same fresh chats. Do not claim production readiness until D1, D2, and calm backend-state locate all meet their attached-evidence criteria.

**Updated ship decision:** D2 shows partial live progress; D1 fails on both supplied attempts. No live pass or production-ready claim is justified. The underlying issue is demonstrably in the end-to-end evidence hunt, but the new transcripts alone still do not isolate index versus ranking/filtering versus planner/read/classifier responsibility.

## Addendum — Instrumented D1 replay and retrieval fallback change (2026-10-01)

The authenticated Extension Host was reloaded on build `0.1.10`, diagnostics were enabled, and the Parent paraphrase was rerun against `CoopAI-Corp/plane · preview`. The exact trace is in the `CoopAI Agent Diagnostics` Output channel. It narrows the failure as follows:

- The deterministic first query was `Parent is not valid issue_id` (the earlier captured baseline had used `not valid issue_id`). It ran through embedding search and returned 18 raw hits, all in the first 12 shown from web/UI components. `preferredHits` and `modelVisibleHits` were empty.
- The planner then spent its remaining four-search budget on `"parent" "issue_id"`, `parent_issue`, and `parent`. The first two again returned UI-heavy results with no preferred candidates. `parent` used Zoekt and surfaced server-side lookalikes: `apps/api/plane/utils/porters/serializers/issue.py` and `apps/api/plane/bgtasks/issue_activities_task.py`.
- Both candidates were remotely read. Diagnostics confirmed `rejectMatch:false`; the read tool correctly skipped them as “no write/reject.” The final answer was a bounded miss. No read of the known API issue serializer was attempted.
- The turn remained on build `0.1.10`, branch `preview`; this replay was run after the first-query improvement and before the code-host fallback change below. `requiredEvidence:[]` in this Parent turn is not itself a failure signal; this ask requires one reject artifact.

This pins a concrete shared fault before finish: semantic hits containing similar parent wording were treated as enough to suppress code-host full-text fallback even though they were client/UI paths and could not establish an API write reject. The prompt/model also spent later turns on low-information variants, but its miss was bounded and the read/finish rails correctly refused to accept the porter serializer or background task. This is therefore a retrieval-source eligibility/fallback defect plus query refinement weakness; this trace does not establish an index-coverage defect.

### Targeted change and current verification

- The first Parent seed now retains the field relationship (`Parent is not valid issue_id`) instead of searching the generic suffix (`not valid issue_id`).
- `search_code` now treats a reject-shaped query as unsatisfied until indexed hits include an actionable server-side write/reject body. If the index returns only UI matches or other non-write candidates, it tries the existing code-host search and remote-body enrichment path. When Lightning already returns an actionable server-side reject body, it does not issue the fallback request.
- Added a regression where a UI source contains the exact same reject wording: the test requires code-host fallback to return the API serializer body. Existing test coverage still verifies no fallback when a real serializer reject is already indexed.
- Focused tests: `AgentOrchestrator.test.ts` **83/83 passed**; `tools/searchCode.test.ts` **8/8 passed**. `npm run build:extension-dev` and `npm run lint` passed. The build emits only the repository’s existing Browserslist stale-data notice.

### Live replay after the first fallback change

The Extension Host was rebuilt/reloaded and D1 was rerun on `CoopAI-Corp/plane · preview`. It still returned a bounded miss. Diagnostics again showed embedding-only UI results on the first two searches, followed by `parent_issue` and `parent_id`; no preferred/model-visible hit survived. Unlike the previous replay, this attempt used the code-host fallback implementation, but the trace did not yet record whether the fallback was attempted or whether the provider returned paths. This showed that checking for any write-reject on an actionable server path remained too broad: a different-field or serializer lookalike could suppress fallback without satisfying the asked-field evidence contract.

The fallback gate is now aligned to the asked field: only an actionable server-side hit that `contentLooksLikeAskedFieldReject` accepts can suppress code-host search. Diagnostic events also record whether fallback was attempted and whether it supplied results, so a zero-result provider call can be distinguished from a skipped fallback on the next replay. New tests cover UI text and a different-field server reject as fallback triggers, while a correctly indexed Parent raise still suppresses the extra lookup. These latest edits have passed focused unit tests; the final build/reload and live replays are still pending. D2’s compound write-plus-reject criterion and the calm backend-state locate remain separate live ship gates. No production-ready or live-pass claim is made.

The next instrumented D1 run on the rebuilt candidate did record `codeHostFallbackAttempted:true` for all four reject-shaped searches, but every result retained `source:"embedding"` or `source:"zoekt"`, with no fallback hits. Thus the fallback was not skipped; the exact phrase search supplied no path (or was caught as a provider failure, which the existing wrapper collapsed to an empty result). I added one bounded retry using the same literal query without phrase quotes after an empty exact-phrase result, plus a regression for that retry. This last retry has passed its focused tests and build/lint, but still needs live D1/D2/calm replay. The current source remains unproven for production.

## Addendum — Final fallback observability candidate (2026-10-01)

After the 2026-10-01 Extension Host D1 replay still selected the porter serializer and activity task, I made one further bounded search change:

- Native code-host fallback now tries the exact phrase, the unquoted literal, and (when present) underscore-delimited field tokens such as `issue_id`, stopping at the first path set that can be enriched.
- Search results record a content-minimized fallback outcome: `not_attempted`, `no_paths`, `paths_no_match`, `results`, or `error`. No provider error message or source body is written to the diagnostic summary.
- The extension adapter no longer swallows native code-host errors into an indistinguishable empty result; the search tool classifies the error while continuing the remaining bounded query variants.
- Tests: `tools/searchCode.test.ts` **11/11 passed**, `AgentOrchestrator.test.ts` **83/83 passed**, `npm run build:extension-dev` passed, `npm run lint` passed, and `git diff --check` passed.

The Extension Host observations during this continuation are:

| Ask | Observation | Result |
|---|---|---|
| D1 Parent | Before the field-token retry, the completed run again searched Parent terms, remotely opened only `apps/api/plane/utils/porters/serializers/issue.py` and `apps/api/plane/bgtasks/issue_activities_task.py` (both marked `read_file skipped (no write/reject)`), and ended with a bounded miss. After rebuilding and reloading with the field-token retry, I ran D1 again, but the transcript included `file: .oxlintrc.json` from an incidental open remote file and still returned a bounded miss. | **Fail / latest candidate replay confounded.** The earlier clean run did not surface the app serializer; the latest candidate also failed visibly, but it is not a clean canonical replay because that unrelated file context was attached. Its diagnostics were not captured, so we do not know whether `issue_id` fallback errored, returned no paths, or returned unusable paths. |
| D2 state write + reject | A fresh Plane `preview` chat on the same prior candidate completed in 12s after searches for `validate_state`, `work item state`, and `workitem`; it opened no source files and returned the bounded miss. | **Fail.** Neither half of the compound ask was attached in this replay. |
| Calm state locate | Not rerun after the latest candidate. | **Unverified.** |

This narrows the next diagnosis but does not complete the repair. Native code search may return no paths, reject the request, or return paths that cannot be enriched; the new status distinguishes those cases in a clean diagnostics replay. The visible D1 trace still proves that the answer and evidence rails remain bounded, while source discovery has not reached the desired API serializer. No production-ready claim is supported. Required next step: remove the unrelated file context, start a fresh Plane `preview` chat, and inspect the fallback outcome for D1; then replay D2 and calm locate with attached-source pass criteria. If fallback status is `error` or `no_paths`, solve code-host search capability/querying; if `paths_no_match`, inspect returned paths and read outcomes; if `results` but wrong candidates remain, inspect preferred-hit filtering and read selection.

## Addendum — Rules-fallback evidence repair (2026-10-01)

The captured diagnostic trace is from the Extension Host build labeled `0.1.10` before this turn's source change. It provides stronger evidence than the user-visible transcript:

- The D2 `turn` event recorded `hunt: api-reject` but `requiredEvidence: []`.
- Its first three searches returned 18, 13, and 16 raw hits, respectively, but none were selected as preferred or model-visible. Their listed results were mostly UI, locale, seed, or generic type files.
- A later SCIP query surfaced `apps/api/plane/app/views/intake/base.py`, but the remotely read window did not match a write/reject and was correctly skipped.
- In the calm state run, a later `state_group` query exposed `apps/api/plane/db/models/state.py` as a preferred/model-visible hit, and that declaration was remotely read. The first calm run then answered with the model path. A duplicate run drifted into mention-only reads and failed; it is not a second independent pass.
- D1's first four query pools had no preferred/model-visible backend serializer candidate. This is consistent with a retrieval/query mismatch; it does not prove the index lacks the serializer.

The initial code inspection found that `ensureCompoundWriteRejectJobs` was applied after successful model classification, but the rules-only front-door path returned its rules plan without applying the same completion contract. This explains one concrete way a live run could produce `requiredEvidence: []`; the diagnostics do not include plan-source metadata, so they do not prove that this exact run took the fallback. The new fix applies the shared evidence repair at the front door for both model and rules paths. It also enriches each missing/present evidence job with generic, field-shaped search criteria (for this ask: state assignment/update and state validation/invalid transition), returns a copied jobs array, and keeps calm state-location asks outside the reject contract.

### Change and verification in this turn

- Added a front-door regression for the exact compound D2 wording. It verifies both evidence classes reach the formatted agent brief, both get useful and distinct criteria, and the calm state-location control is not promoted.
- The independent review found no import cycle. It warned that evidence labels alone would not improve weak search hints; the helper now adds targeted criteria as well as the evidence contract.
- The forced first reject query now favors field-shaped code terms over English explanations: `validate_state` for a state/transition ask and `not valid issue_id` when a Parent paraphrase explicitly names `issue_id`. The raw trace showed the prior prose-first queries landing in UI-heavy embedding results. The four-refinement search cap remains unchanged; the automated fixture allows the deterministic seed plus those bounded refinements.
- `frontDoor.gates.test.ts`: **19/19 passed**.
- `intentQuarterback.gates.test.ts`: **12/12 passed** (including a no-mutation assertion for evidence repair).
- `test:reject-hunt-fidelity`: **AgentOrchestrator 83/83 and searchQuery 91/91 passed**.
- `npm run lint`: passed.
- `npm run build:extension`: passed.
- `git diff --check`: passed.

At the time of the implementation addendum, the reloaded Extension Host rendered blank and a clean post-change replay was unavailable. The later user-reported 1:37–1:40 PM dogfood results above supersede that status: D2 made partial progress, while both D1 attempts failed. Their D2 first query (`validate_state`) is consistent with the new field-shaped seed, but the exact extension build identifier and diagnostics trace were not captured, so the transcript cannot prove which build executed. `coopAI.agentDiagnostics` had been disabled after the earlier trace; the user-visible activity does not replace the missing stage-by-stage trace. The source remains ineligible for a “fixed/live pass” or production-ready claim until the build is identified and D1, D2, and calm locate pass with remotely read, attached evidence.
