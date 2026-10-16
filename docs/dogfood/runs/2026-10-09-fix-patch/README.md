# /fix patch lifecycle — October 9, 2026

Status: Fixed / live Pass based on Jon's direct confirmation that `/fix` Apply,
Undo, Reject, and Create PR all work as intended. The live Apply item is closed.
The confirmation did not supply a candidate hash or repository/ref; none is
inferred. His completed live `/edit` baseline remains completed. Reopen only an
observed regression or explicitly requested requalification.

The findings and replay instructions below describe the earlier investigation
and automated qualification. They do not override the latest user confirmation.

The supplied screenshot was readable. It shows the proposed status interpolation
in the editor, an unsaved indicator, and an applied Patch card. It establishes an
editor change at that moment, but does not establish persistence or correct source
ownership. It does not identify the cause of Jon's reported failure. No Extension
Host controls, reloads, real PR creation, commits, pushes, or deployments were
performed here. Existing and concurrent checkout changes were preserved.

## Verified findings and changes

- `src/context/slashCommands.ts` resolves both `/fix` and `/edit` to composer
  mode `edit`. Both completion routes in `CoopChatSession` use
  `handlePatchComplete`, the same parser, Patch card, and action handlers.
- `src/webview/lib/patchStreamDisplay.ts` recognized `/edit` and `[edit]` in
  history but omitted `/fix`. It now uses the shared slash-command resolver,
  covering `/fix`, `/repair`, and `/patch` for streaming and restored replies.
  This display divergence is verified; it is not a proven cause of Test 8 Apply.
- Patch cards previously omitted originating repository/ref and local-file
  scope. Apply inferred targets from mutable settings and path-only editor
  lookup. Cards now persist their originating identity and scope, and previews,
  Apply, PR collection, and PR defaults use those coordinates. Bound remote
  actions exclude local disk, foreign repositories/refs, and anonymous buffers.
  An ambiguous or unverifiable open target fails visibly without opening another
  Apply copy. A VFS tab without ref metadata requires the captured baseline bytes
  before it can be associated with the originating ref.
- `patchApplier` previously treated VS Code's successful acceptance as sufficient
  acknowledgment. It now checks the resulting target text before reporting
  Apply/Undo success, handles CRLF normalization, and keeps actual applied bytes.
  A partial acknowledgment retains safe Undo for verified files and does not
  claim PR readiness. This failure is reproduced by an editor fixture accepting
  Apply without changing text; it is not claimed as Jon's exact runtime cause.
- Explicit stale action timestamps no longer fall back to another patch.
  PR payloads retain all applied files after per-file Apply, exclude rejected
  hunks, and use verified snapshots when the editor closes. Creating a PR from
  a non-applied card or a mismatched repository is rejected. Manual editor PR
  creation without a Patch card remains supported.

## Automated verification

- `npm run test:agent-ship:b`: 35/35 lifecycle gates; 7/7 pressure cases;
  existing selection/definition tests pass. The Documenso-shaped guard fixture
  exercises both commands through Reject → Undo → Apply → Undo → Apply and PR
  handoff, including identical foreign-repo/ref buffers and changed chat scope.
- `npm run test:patch`: all suites pass, including 11/11 target cases and
  8/8 patch-stream/history cases.
- `npm run test:agent-routing`: all suites pass.
- `npm run test:agent-ship:c`: all suites pass. Branch/commit/PR creation is
  exercised with mocked codehost/server fixtures, not production publication.
- `npm run lint`, `npm run build:extension-dev`, and `git diff --check`: pass.

These are automated fixture results. They do not reproduce the original live
failure or qualify actual codehost publication from Jon's account. The built
candidate includes the shared checkout's preserved and concurrent work.

## Historical live replay plan — superseded by Jon's confirmation

1. **Extension UI:** Reload Window in the Extension Development Host. Open a
   fresh Coop chat, select `CoopAI-Corp/documenso`, branch `main`, and attach
   `packages/lib/server-only/field/sign-field-with-token.ts`, whole file.
   Start from the original remote main body, with one viewing tab for this
   target. Preserve unrelated unsaved work; an already-applied prior test edit
   must be restored before asking for that same change again.
2. **Extension UI:** Send exactly:

   > /fix Could you improve the “must be pending for signing” error to include the envelope’s actual status, while preserving the PENDING guard and all signing behavior?

3. **Extension UI:** Reject, then Undo. Reject leaves the editor unchanged;
   Undo returns the card to review. Apply must change the intended remote editor
   buffer's error string and preserve the `DocumentStatus.PENDING` guard and
   other source bytes. A failed/no-op Apply must show a failure, not Applied.
4. **Extension UI:** Undo the applied patch, verify the original text, then
   Apply again. Both operations must affect that same target exactly once.
5. **Extension UI:** Open Create pull request. Confirm the one intended file,
   changed error, originating repository, and base `main`, then Cancel. This
   safely qualifies confirmation/handoff; actual live PR publication remains
   unqualified until Jon authorizes it on a disposable target.

Apply edits the editor working buffer. Saving or publishing through Create pull
request is a separate operation. Closing an unsaved viewing buffer does not
publish changes to the codehost. This earlier replay plan is retained as history;
Jon's subsequent confirmation closes the live workflow gate.
