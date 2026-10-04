# Dogfood failure remediation plan

This plan was executed in small repair batches. The latest evidence is in [runs/2026-10-03-continuation/README.md](runs/2026-10-03-continuation/README.md). All 15 automated gates pass. The disposable environment verifies authentication, quota boundaries, real model streams and controlled faults; packaged activation is verified. These results do not certify the full application.

The approved production backend deployment is `a9fd94df-f99c-4be5-adaf-f6cd269c6322`. Startup, migrations and health passed. Coop's known source lookup against the external Plane test fixture still fails in cold and warm runs. The current continuation ledger contains 116 NOT_RUN, two FAIL and two BLOCKED checks, plus separately scoped supplemental evidence. Older candidate attempts remain historical evidence. See [the overnight handoff](overnight-handoff-2026-10-03.md) for the next working session.

## 1. Establish reproducible evidence and restore the test gates

Before editing, preserve the dirty working tree and distinguish existing changes from repairs. Record the loaded extension/webview hashes, backend deployment and independently verified remote refs. Reproduce critical failures on that candidate and save the exact ask, selection, thread, run ID, final answer and applied target. Investigate existing hot-path implementations before adding another routing or workspace abstraction.

Repair the failing frontDoor slash-routing gate and honesty H-G9 gate. The first currently relies on a source regex; determine whether routing behavior is broken or the assertion is stale. Preserve the intended invariant with meaningful behavior coverage rather than loosening the check to obtain green. H-G9 must prove leftover Owner/Blast context cannot steal the user's new intent. Run later chained gates independently so an early failure cannot hide their status.

Qualify the dogfood harness: refresh editor state before grading writes; associate diagnostics with the exact run rather than a whole thread; record actual prompts separately from scenario descriptions. Distinguish answer-start timing from UI operation timing. Preserve missing timing as incomplete evidence, never manufacture a value. Reconcile supported feature scope: Teams currently exposes an unavailable path, so test that honestly rather than require a positive retrieval from an unimplemented connector.

Exit: known candidate and fixture identities, trustworthy evidence capture, both previously failing automated gates green, and no silent unexecuted chained checks.

## 2. Isolate cancelled turns and restore thread context

Priority: prevent an old request from changing the meaning of a new edit.

Failures: DF-027, DF-055, DF-056 and DF-075.

Trace cancellation through turn history, pending tool results, proposal state and completion callbacks. A stopped request may remain visible in history, but its unfinished instructions and artifacts must not enter the next proposal. Bind updates to their originating thread and run; discard late results from cancelled runs without aborting unrelated threads.

Review `CoopChatSession.ts`, `chatThreadStore.ts`, `chatThreadRestore.ts`, `threadSync.ts` and composer state. Persist repo/provider/ref and drafts per thread, including unsent new conversations. Restore the prior thread's repo before accepting a follow-up. Capture explicit selection when New chat starts, while preserving the existing protection against unrelated passive editor context.

Regression and live acceptance:

- Stop the structured-token/all-callers edit, then request only a variable rename. The next patch changes exactly the requested variable references and no other file or return type; no late first-turn write occurs.
- Switch thread and repo during streaming. The answer stays in its origin, both drafts survive, and each thread restores its own repo/ref.
- Reopen the Coop authUserId conversation after a Plane conversation. “Which function did you mean?” resolves authUserId with Coop source and makes no unrelated Plane search.
- Select the parser, create New chat, and explain it without losing its selection or asking which function.

## 3. Preserve patch targets and citation provenance

Failures: DF-021 and DF-058. Also rerun successful safety checks DF-020 and DF-024–026.

Trace why sanitization turns a disposable editor target into literal `[INTERNAL_PATH]`. Keep privacy protection for displayed or transmitted text, while retaining an authorized, structured target identity for application. Do not globally disable sanitization or guess a filesystem path from model prose. Review `dataSanitization.ts`, `agentProposedPatch.ts`, patch target resolution and the Apply call sites.

Trace citation opening and editor context extraction separately. The actual focused source has 264 lines, while attached ranges grow to L1–519/L1–531. This suggests a range/context extraction defect, but the cause is not yet proven. Use the actual document and selection as the oracle; retain remote repo, provider, ref, path and exact cited range through opening and attachment.

Exit: local seeded off-by-one repair applies to the correct disposable file and passes independent empty, negative, mixed and positive assertions; no unrelated file changes. Clicking authUserId 203–208 opens that method and attaches a valid range. Rename, Reject, Undo, stale-content refusal and duplicate-Apply protection remain live green.

## 4. Repair remote retrieval and intent routing

Failures: DF-003–004 and DF-006–011. These affect ordinary questions across GitLab, GitHub and Bitbucket.

Inspect the indexed-map response contract and selected-ref validation. The observed Plane map returned data but discovery reported `indexed_map_unavailable`; determine whether backend provenance is absent, extension validation is incompatible, or the selected index is genuinely unavailable. Fix producer and consumer together where needed. Never make an unidentified map acceptable by removing provenance checks.

Keep all repository intelligence through `IndexedRepoWorkspace`. Verify filename discovery, body reads and provider-native content search capabilities. An unsupported provider search request must lead to a supported remote retrieval path or a precise limitation, not an invented source or local clone fallback.

Route inventory asks through repo facts, with fixed index-stats → manifest → tree order. Separate definition lookup, request-flow explanation, rejection investigation and compound questions. A false premise must not prevent finding the real filtering behavior. Read enough actual source to support each half of a compound answer.

Exit: Coop request-flow reads middleware plus a real endpoint; inventory returns authoritative totals or explicitly unavailable totals. Plane Parent, state write, assignee filtering, State model and API-key/state compound asks identify the correct server evidence. Documenso reads the selected fork's signing guard and PENDING condition. All run without a clone in cold, warm and after-repo-switch modes.

## 5. Deliver the requested artifact and preserve it through completion

Failures: DF-019, DF-036, DF-043 and DF-068.

Trace frontDoor intent, tool output, synthesis and final UI delivery. Investigate why successful propose_patch calls produce a locate miss, and why a streamed source-backed Compare answer is replaced by a canned final miss. Finalization must reflect actual evidence and artifacts; a generic failure template must not overwrite a valid answer or proposal.

Define and test Compare's argument grammar for natural phrasing and explicit repo identifiers. Resolve both repositories independently and keep their citations separate. For COOP-101, continue from retrieved ticket evidence to remote code where supported; distinguish a real association from an unavailable decision link and demo seed content.

Exit: the exact two-test codegen ask yields one minimal applicable patch, preserves the existing suite and passes both new behavioral assertions. Compare retains its evidence-backed answer after completion. COOP-101 includes verified code and distinct ticket/decision citations or a precise missing-link explanation. Keyboard editing reaches a usable preview; the already working keyboard Send, Stop, citation and settings controls remain usable.

## 6. Ground quick actions in inspectable evidence

Failures: DF-031 slash, DF-032 slash/workflow, DF-033 slash, DF-034 slash and DF-035 slash. Unexecuted workflow/context-menu variants must also be tested.

- Understand: fetch enough source for the requested scope; directory names and import strings do not count as verified implementation files. Distinguish a truncated attachment from a defective repository file.
- Owner: resolve identity aliases with evidence; distinguish authorship, maintainership and ownership. Absence of another author does not establish sole knowledge or an escalation policy. Make commit/review evidence inspectable.
- Blast: separate module importers from actual function callers. Read call sites before asserting behavioral impact; label possible impact and incomplete coverage.
- Trace: independently inspect the cited historical decision and reconcile it with selected current source before claiming the design is active. Preserve the successful honest-unavailable selected-parser behavior.
- Gaps: keep results specific to the requested code, grounded and deduplicated. Empty evidence yields a short honest result. Activity UI should show concise operations rather than internal instruction-conflict discussion.

Investigate slow gathering with the existing soft 15-second start-answer budget. Begin an evidence-bound response when the budget is spent; never abort solely because time elapsed.

Exit: each action passes via slash, workflow and editor context menu with its appropriate repo or selected-code scope. No guessed owner, invented caller behavior, unsupported architecture or generic gap filler.

## 7. Complete the prerequisites and certify the rebuilt candidate

Prepare disposable remote fixtures for denied access, branch differences, rename/reindex, long/Unicode files, prompt injection and multi-file edits. Provide sandbox accounts for org isolation, expired authentication and free/paid limits; controlled network/429/5xx/index faults; integration markers and denied scopes; billing test mode; and a disposable PR destination. Creating external messages or changing production grants requires the relevant explicit authorization. No real charges are part of this suite.

Resolve Coop autocomplete provenance by temporarily isolating Copilot only with permission, then restoring it. Test dismissal, pending-document/repo switching, disable/reload/reenable and suggestion cycling. A correct accepted ghost alone cannot establish which provider generated it.

After each repair batch, run its meaningful regression tests, lint, extension build and affected live asks. Keep changes small and complete across call sites/types/clients. Record a new candidate after rebuilding or deploying; old candidate passes do not certify the new one. No production deployment or commit/push is implied by creating this plan.

Final exit: complete all supported scenario/mode checks and automated gates on one recorded candidate; inspect evidence; test the exact packaged VSIX in a clean Extension Host; verify backend and remote fixture identities. BLOCKED and NOT_RUN stay visible and prevent certification for their scope. Mark a failure “Fixed / live Pass” only after its named live retest succeeds.

## Execution order

Start with evidence qualification and automated gates, then cancellation/thread isolation, then patch target/citation integrity. Repair retrieval/routing before artifact delivery and broad quick-action synthesis so those paths have dependable source evidence. Finish with the full candidate rerun, including prior passing safety checks and the remaining scenarios. Mac unlock is needed for live retests; source investigation and regression work can proceed while UI access is unavailable.
