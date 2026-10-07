# QA lane B — 730f5b1 Apply/Undo, Understand, autocomplete, grounding, Stop

Date: 2026-10-05 America/Los_Angeles  
Lane: B; read-only implementation audit  
Checkout: `/Users/jonraney/Coop-AI`  
Branch/HEAD: `checkpoint/dogfood-2026-10-03` / `bf8dc0d`  
Audit commit: `730f5b14bb15e99b948bd0e0f052cf48a6f2c5dc` (`Guard stale Undo and ground bounded source answers`)

## Disposition

Overall: **UNQUALIFIED**. The source supports several narrow contracts, but ordinary autocomplete cancellation has a source-observed linkage gap, focused TypeScript tests could not execute in this environment, and no live Extension Host behavior was qualified.

## Commands and execution evidence

All commands below were run from `/Users/jonraney/Coop-AI`.

| Command | Result |
|---|---|
| `git status --short` | Exit 0. Pre-existing dirty/untracked changes were present; this lane did not reset, edit, build, or clean them. |
| `git show --stat --oneline 730f5b1` | Exit 0. Confirmed the requested commit and its 12-file scope. |
| `git diff --stat 730f5b1..HEAD` | Exit 0. HEAD contains later follow-up work, including `src/chat/CoopChatSession.ts`; source observations below are current-checkout observations and are not live qualification. |
| `npm run lint` | **PASS**, exit 0. `tsc --noEmit` for extension, webview, and backend; no build artifacts written. Lint is a CI gate, not a product/live pass. |
| `npx tsx src/edit/phaseB.gates.test.ts` | **BLOCKED**, not executed: `tsx` was absent locally and npm returned `ENOTFOUND registry.npmjs.org`. |
| `npx tsx src/edit/patchApplier.test.ts` | **NOT_RUN/BLOCKED** for the same missing-runtime/network reason. |
| `npx tsx src/edit/handlePatchComplete.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/autocomplete/coopAutocompleteProvider.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/autocomplete/completionRouter.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/autocomplete/phaseE.gates.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/autocomplete/phaseE.pressure.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/prompts/repoSummarySynthesis.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/context/understandRepoBranchContract.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |
| `npx tsx src/context/understandRepoDomainAttach.test.ts` | **NOT_RUN/BLOCKED** for the same reason. |

Historical context only: `docs/dogfood/runs/2026-10-05-recovery/evidence/current-focused-tests-2026-10-05.md` records earlier `npx --yes tsx` passes for several of these files. Those are not re-run evidence for this checkout audit.

## Findings

### 1. Apply / Undo stale-state protection — PASS (source; automated re-run NOT_RUN; live NOT_RUN)

Evidence:

- `src/edit/patchActions.ts:387-445` resolves the message timestamp, rejects non-pending cards, validates ready hunks, and dispatches only the selected pending subset.
- `src/edit/patchActions.ts:476-491` serializes Apply per patch record via `updatingPatchRecords`; concurrent Apply/Undo/Reject for the same record is refused while an operation is in flight.
- `src/edit/patchActions.ts:543-587` applies a subset as one workspace operation, merges undo snapshots while retaining the earliest original content, and updates the card only after a successful result.
- `src/edit/patchActions.ts:673-756` gates Undo on the exact record and stored snapshots, calls `undoPatchApplication`, clears undo state only after success, and rehydrates a review/pending card.
- The 730f5b1 additions in `src/edit/phaseB.gates.test.ts` cover concurrent two-file Apply/Undo, second-file stale SEARCH refusal, intervening user/other-card edits, incremental same-file hunks, and rechecking earlier buffers after an awaited target opens (roughly lines 368-530 in the current file).
- `src/edit/patchApplier.ts:63-250` captures original/applied bytes and validates all targets before dispatching an undo edit. This is a good pre-dispatch stale-buffer guard.

Residual: source inspection does not establish a post-validation/pre-`WorkspaceEdit` race guarantee, nor native VS Code behavior. Do not call this live-fixed.

### 2. Applyable output / Patch card wiring — PASS (source; automated re-run NOT_RUN; live NOT_RUN)

Evidence:

- `src/edit/handlePatchComplete.ts:158-236` parses valid patch content into a patch card and suppresses raw markdown when an applicable patch is present.
- `src/chat/CoopChatSession.ts:9338-9353` publishes `handlePatchComplete` before completing the chat turn for edit/code-edit and chat paths, including `ignoreParseFailure` for ordinary chat.
- `src/edit/registerPatchCommands.ts:34-37` wires the primary Apply and Undo commands to `applyPendingPatch` and `undoLastPatchWithState`.
- `src/webview/PatchCard.test.ts` and `src/edit/handlePatchComplete.test.ts` contain applicable-output/card rendering coverage, but could not be executed in this run because the TypeScript test runtime was unavailable.

### 3. Understand behavior from 730f5b1 — PASS (source contract; automated re-run NOT_RUN; live NOT_RUN)

Evidence:

- `src/chat/CoopChatSession.ts:8654-8715` refuses an Understand answer when repository summary evidence is absent or when inventory/tree exists without entry-file bodies; it posts an explicit context warning and does not synthesize architecture from identity-only evidence.
- `src/chat/CoopChatSession.ts:8603-8607` isolates the repository summary for `understand-repo` before synthesis.
- `src/prompts/repoSummarySynthesis.ts` and `src/prompts/repoSummarySynthesis.test.ts` require tree/entry-file evidence, narrow-anchor confidence, source citations, and user-focus handling. The 730f5b1 test addition in `src/config/responseDeadline.test.ts` also limits the extra thinking phase only for a complete narrow source result.
- `src/context/understandRepoBranchContract.test.ts` and `src/context/understandRepoDomainAttach.test.ts` are the focused branch/domain contract tests selected for this audit; they were blocked before execution.

This is source-level evidence only. No Extension Host Understand answer was run on a named fixture, so live qualification is **NOT_RUN**.

### 4. Ordinary autocomplete cancellation / AbortController linkage — FAIL (source-observed candidate defect; regression test NOT_RUN; live NOT_RUN)

Evidence:

- `src/autocomplete/coopAutocompleteProvider.ts:450-510` creates the ordinary/base scheduled request. Its VS Code cancellation listener at lines 461-463 only sets `vscodeCancelled = true`; it does not call `AbortController.abort()`.
- The same base path invokes `this.executeRequest(...)` at line 488 without passing the VS Code token or an AbortSignal. `executeRequest` creates a separate controller at `src/autocomplete/coopAutocompleteProvider.ts:644-655` and passes that signal to the router at lines 682-716.
- `src/autocomplete/completionRouter.ts:176-205` correctly links the signal it receives to the router’s internal controller and passes the linked signal into streaming. The defect is therefore upstream: ordinary provider cancellation never reaches that signal.
- The token callback can retrigger inline suggestions after a late result (`coopAutocompleteProvider.ts:496-499`), but that is not cancellation of the underlying request.
- NES is different and correctly links the token at `coopAutocompleteProvider.ts:594-603`; this makes the missing linkage specific to the ordinary/base path.

Impact: a canceled ordinary completion can continue network/model work and resolve late. The provider may suppress or supersede the visible result through context checks, but the source does not prove request abort or cancellation-safe side effects. Classification is **FAIL / candidate P1 state-cancellation defect**, not a live claim.

Additional residual: graph symbol-manifest lookup in `src/autocomplete/completionRouter.ts:222-224,279-343` uses a fresh 120ms controller at lines 312-315 and does not receive the request’s linked signal, so even a correctly aborted network request would not cancel that auxiliary lookup.

### 5. Graph grounding and codegen scope — PASS (bounded source scope); FIM/codegen parity NOT_SUPPORTED/NOT_RUN

Evidence:

- `src/autocomplete/coopAutocompleteProvider.ts:273-287` marks the request as `indexed-repo` and allows graph context only when `autocompleteAllowsGraph` permits it for the resolved file/session scope.
- `src/autocomplete/completionRouter.ts:279-298` refuses graph symbol hints when `allowGraphContext === false` or graph use is disabled; `src/autocomplete/completionRouter.ts:368-395` sends `useGraphContext`, repo id, and repository-relative file only on the eligible route.
- `src/autocomplete/completionRouter.test.ts:286-427` covers enabled/disabled graph fields, healthy-index auto-enable, and file-assistant/L-session omission. These tests were not re-run here.
- `src/api/inlineCompletionApi.ts` and `src/api/inlineCompletionApi.test.ts` deliberately keep FIM separate from graph-slice retrieval; the tests explicitly assert that FIM output is unchanged and does not fetch graph context.
- `src/prompts/systemPrompts.ts:509-528` defines edit mode as a code-generation/patch-output assistant, while the graph provenance language at lines 2507-2572 describes SCIP/Zoekt evidence for evidence synthesis. I found no source evidence that all codegen/edit output is graph-grounded.

Disposition: bounded indexed-repo autocomplete graph grounding is **PASS by source contract**; graph-grounded FIM or blanket graph-grounded codegen is **NOT_SUPPORTED by the inspected scope**, and live graph/codegen behavior is **NOT_RUN**. Do not expand the claim beyond the ordinary eligible autocomplete/chat-fallback path.

### 6. Stop behavior — PASS (source wiring); live and focused runtime tests NOT_RUN

Evidence:

- `src/chat/CoopChatSession.ts:1416-1509` handles user Stop: aborts intent suggestion, cancels active jobs, calls `threadRuns.abort(threadId)`, clears intent feedback, emits canceled job progress, and persists either partial assistant text or `Stopped.`.
- `src/chat/CoopChatSession.ts:2315-2318` routes `chat:stream-cancel` to the active thread.
- `src/chat/chatStopped.ts:2` defines the canonical `Stopped.` message.
- Multiple synthesis checkpoints in `src/chat/CoopChatSession.ts` test `isCancelled()` before further publication (`:9213`, `:9257`, `:9266`, `:9384`), which supports output suppression after Stop for the chat stream.

Important boundary: this Stop path is chat-turn cancellation, not the missing ordinary autocomplete token-to-abort linkage in Finding 4. No live Stop/retrieval/stream test was run.

## Final QA status

- Apply/Undo: **PASS source-only; automated re-run BLOCKED; live NOT_RUN**.
- Applicable output: **PASS source-only; automated re-run BLOCKED; live NOT_RUN**.
- Understand: **PASS source-only; automated re-run BLOCKED; live NOT_RUN**.
- Ordinary autocomplete cancellation: **FAIL candidate source defect**.
- Bounded graph grounding: **PASS source-only**; graph-grounded FIM/full codegen: **NOT_SUPPORTED/NOT_RUN**.
- Chat Stop: **PASS source-only; live NOT_RUN**.

No implementation repair was made. No `dist` or shared build artifact was written. This lane must not be promoted to Automated Pass or Fixed/live Pass until the base autocomplete abort linkage is addressed or explicitly accepted, focused tests execute on an immutable candidate, and the named Extension Host checks are completed.
