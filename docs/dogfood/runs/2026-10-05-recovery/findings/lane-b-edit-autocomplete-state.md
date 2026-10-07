# QA lane B — edit, autocomplete, state, cancellation

Date: 2026-10-05 America/Los_Angeles  
Lane: B (read-only implementation audit)  
Candidate: checkout HEAD `36cf801040cf6666c68f93c7cd579802a4ccec43`; dirty follow-up source is present but no immutable candidate hash was exposed.  
Status: **Automated checks not qualified; live UI BLOCKED**

## Commands and exits

- `git status --short` — exit 0. Checkout is dirty with unrelated and implementation-owned changes; no files were reset or changed by this lane.
- `npx tsx src/autocomplete/phaseE.gates.test.ts && ...` (phase E gates/pressure, phase B gates/pressure, model assignments, inline graph/API tests) — manually interrupted after no output for about 30 seconds; no exit or pass evidence. **NOT_RUN/INCONCLUSIVE**, not a pass.
- `npx tsx src/config/featureModelAssignments.test.ts` — manually interrupted after 10 seconds with no output; no exit or pass evidence. **NOT_RUN/INCONCLUSIVE**.
- Attempted `timeout 20s ...` isolation loop — shell exit 0, each test command exit 127 because `timeout` is unavailable on this macOS shell. This is harness setup evidence only, not a test result.

## Observed source evidence

### Edit Apply / Undo

`src/edit/patchApplier.ts` captures `originalContent` and exact `appliedContent` for every changed file. `undoPatchApplication()` opens all targets first, then validates every target's current bytes against `snapshot.appliedContent` before constructing/dispatching the `WorkspaceEdit`. A mismatch returns an explicit preservation error and dispatches no undo edit. This supports the pending handoff claim for pre-dispatch stale-buffer safety.

The guard is source-reviewed only in this lane because the focused edit tests did not produce a completed exit. It does not cover typing or another edit that occurs after validation and before VS Code applies the undo; that remains an explicit residual race.

`src/edit/patchActions.ts` serializes per-message Apply operations through `updatingPatchRecords`, and `mergeUndoSnapshots()` retains the earliest original content. This is consistent with multi-hunk/sequential Apply safety, but no completed automated result was obtained here.

### Autocomplete identity and stale-result isolation

`src/autocomplete/completionRouter.ts` scopes cache and in-flight keys with repo id, branch, graph permission, context hash, and file path. A changed context supersedes the prior controller and deletes the document key. `src/autocomplete/coopAutocompleteProvider.ts` also clears alternatives/in-flight hashes when the session repo/branch scope changes and checks the requested scope after network work before returning items. These are positive source findings for repo-switch stale-result suppression.

### Cancellation / Stop — candidate defect

In `CoopAutocompleteProvider.scheduleRequest()`, the VS Code cancellation token only sets local `vscodeCancelled = true`; it does not abort the `AbortController` created inside `executeRequest()`. `executeRequest()` calls `router.fetchCompletions(..., abort.signal, ...)`, but that controller is never linked to the token for the base completion path. The token callback can cause a later retrigger (`editor.action.inlineSuggest.trigger`) if items arrive, but cannot cancel the underlying request or guarantee no late request-side work. The NES path separately links its token to an abort controller, so the asymmetry is specific to the normal/base path.

Classification: **candidate P1 cancellation/state defect, source-observed; live behavior and regression test unverified**. Expected contract: Stop/cancellation should prevent a canceled completion from continuing to mutate/produce a result for the canceled request. Minimal focused retest: use a delayed `CompletionRouter` dependency, invoke base `provideInlineCompletionItems`, cancel the VS Code token before resolution, assert the router signal is aborted and no completion is returned/retriggered for the canceled request.

### Model assignment and graph grounding

`resolveRuntimeAutocompleteModel()` returns the configured autocomplete assignment outside dev mode; `resolveHonoredChatModel()` maps inline completion to that assignment and rejects non-picker/free selections. `src/api/inlineCompletionApi.ts` deliberately selects FIM first and skips graph-slice fetch on the FIM route. Graph context is fetched only on the non-FIM fallback route when `useGraphContext`, repo id, and file are present. This confirms the handoff's known limitation: **FIM is not graph-grounded**; do not claim graph-grounded FIM or competitor parity.

## Unexecuted / blocked checks

- Live Extension Host checks for ghost text, Tab acceptance, settings/Reload, repo/branch switching, Stop during retrieval/stream, stale output suppression, and model display: **BLOCKED** by serialized live-UI ownership protocol.
- Apply/Undo stale-buffer, partial/multi-file atomic refusal, double dispatch, reload/history restoration, and post-dispatch typing: **not independently automated in this lane**; focused tests did not complete.
- Base autocomplete cancellation behavior: **no dedicated passing regression test found or run**; source audit identifies the candidate defect above.
- Exact account tier/operator assignment and production backend/candidate identity: **not verified**.

## QA disposition

Do not promote this lane to Automated Pass. Positive source findings are useful evidence only. The cancellation candidate must be either fixed and retested on an immutable candidate or explicitly accepted as a residual risk; live product behavior remains unqualified.
