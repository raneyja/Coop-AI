# Lane A — attached context and routing finding

Date: 2026-10-05 America/Los_Angeles  
Lane: QA lane A (read-only)  
Candidate: checkout HEAD `36cf801040cf6666c68f93c7cd579802a4ccec43`; pending dirty follow-up source is present, but no immutable package identity was available. Backend identity is the handoff deployment `fa74a66c-80d9-447f-9ff1-d4b94053dd2d` / source label `c4a83a7`; matching live extension was not verified.  
Overall result: **FAIL for the escaped available-file workflow; live reproduction NOT_RUN/BLOCKED**.

## Executive finding

The escaped Strata incident is a real product failure at the user-visible evidence boundary: the UI retained a file chip, but the answer had no source body available and the follow-up repeated that limitation. The repository code supports two different file-context paths, but the evidence in this checkout does not identify which producer failed for the Strata session:

1. An explicit local/out-of-workspace attachment is classified as `fileSource: "external"` and should use the file-assistant path, preserving the attached body as local evidence.
2. A remote repository chip is classified as `fileSource: "remote"` and should fetch the body through `IndexedRepoWorkspace.readFile` / the context request batcher, then merge a body-bearing result into the turn bundle.

The observed transcript proves only that the body-bearing evidence did not reach the answer. It does **not** prove whether identity resolution, fetch, route selection, bundle merge/isolation, model serialization, or the live candidate caused the loss.

## Source-path audit

### Identity and chip state

- `src/context/editorFileContext.ts` maps local workspace/git files to repository-relative paths, remote VFS files to repository-relative paths with `fileSource: "remote"`, and Cmd+O/untitled/outside-workspace files to `fileSource: "external"`.
- `src/context/contextScope.ts` normalizes an absolute path or external source to `scope: "file"`; a remote chip remains file scope and is not converted into a local path.
- `src/chat/CoopChatSession.ts` deliberately clears a local chip when its editor is no longer open, but keeps a remote chip valid without a VFS tab. This makes a stale/filename-only remote chip a plausible boundary to inspect, but is not itself proof of the incident cause.
- Thread persistence snapshots `owner`, `repo`, `branch`, `file`, and `fileSource` (`src/chat/chatThreadStore.ts`). It does not snapshot source body content.

### Route selection

- `isFileAssistantSession` is used throughout `CoopChatSession` to distinguish local/external file turns from indexed-repository turns. `src/chat/agentRouting.ts` explicitly returns no repo-tool loop for `fileAssistant`, so a local attached-file answer depends on the local file evidence path rather than a later `read_file` hunt.
- For indexed-repository context, `CoopChatSession.runIntentFetch` builds context requests, executes them through the prioritizer/batcher, then merges results into `turn.contextBundle` using `mergeContextBundleResults`.
- The route is therefore sensitive to a mismatch between the chip's `fileSource` and the actual available body. A filename alone is insufficient for either route: external mode needs the local body, and remote mode needs a successful code-host/API read.

### Fetch, bundle, and model boundary

- `IndexedRepoWorkspace.readFile` is the canonical remote body read. The zero-clone rules forbid treating a local clone as remote repository evidence.
- `runIntentFetch` preserves a live turn's existing bundle only for the active turn, and uses `isolationScenarioForEvent` plus `mergeContextBundleResults` when adding results. This is the correct place to inspect for an entry dropped by repo/branch/file isolation.
- `finishTurnAssistantMessage` only grounds citation fences after model output. That step can validate citations but cannot recover a missing source body or make a filename-only prompt useful.
- `src/api/requestFormatter.ts` serializes only multimodal paperclip attachments as provider attachments (images/PDFs). A code-file chip is not automatically serialized through this API attachment mechanism; it must arrive as local/file-assistant evidence or as a remote context-bundle body.

## Observed versus hypothesized boundary

Observed from the handoff transcript:

- The chip remained visible across both asks.
- The answer said it could not see file contents and asked for a reattach/paste.
- The activity searched Confluence, Notion, and Google Docs instead of producing source evidence.
- The follow-up did not recover the body.

Not observed in the available artifacts:

- the actual Strata owner/repo/branch identity;
- `fileSource`, scope, selected lines, or the producer event for the chip;
- a request ID, turn ID, body-presence/length/hash diagnostic, `readFile` status, or bundle entry for `HostTextMonitor.swift`;
- the installed extension bundle/VSIX identity used for the failed session;
- the model request payload and whether a body-bearing entry was present before model invocation;
- citation-open proof or a live Extension Host rerun.

Consequently, these remain hypotheses, in descending diagnostic order:

1. The chip producer persisted only a filename or assigned the wrong `fileSource`, so neither valid body route ran.
2. Remote identity was valid but the `readFile` request was omitted, failed, or was rejected by repo/branch/path isolation.
3. A successful body result was fetched but dropped by turn bundle merge/isolation or lost during model-input construction.
4. The body reached the model input but was ignored by the model, with the answer path incorrectly claiming filename-only evidence.
5. The live session used a candidate different from the inspected source, so current source behavior cannot explain the exact run.

The current evidence supports only the common conclusion: **body evidence was absent from the final answer path**.

## Safe checks run

Inspected read-only:

- `docs/dogfood/recovery-handoff-2026-10-05.md`
- `AGENTS.md`
- `.cursor/rules/zero-clone-remote-only.mdc`
- `.cursor/rules/indexed-repo-workspace.mdc`
- `.cursor/rules/evidence-bound-answers.mdc`
- identity, scope, routing, context-bundle, session-mode, `CoopChatSession`, `IndexedRepoWorkspace`, and request-formatting sources listed above.

Attempted command (read-only targeted tests):

```text
npx tsx src/context/contextScope.test.ts && npx tsx src/context/activeEditorIdentity.test.ts && npx tsx src/context/turnEvidenceIsolation.test.ts && npx tsx src/workspace/IndexedRepoWorkspace.test.ts
```

Result: **NOT_RUN / BLOCKED** in this lane. The command produced no test output and was interrupted after repeated polling; no pass is claimed. No build, package, deploy, branch switch, install, UI action, or implementation edit was performed.

## Missing supported-route coverage

The current supplemental ledger names the exact Swift first turn, exact follow-up, TypeScript and Python controls, and a broad supported-entry-points row. It does not yet split the following routes into independently attributable checks:

- remote indexed file chip with a verified owner/repo/branch/path;
- explicit local workspace file with body present;
- Cmd+O/out-of-workspace external file;
- selected-lines-only attachment versus whole-file attachment;
- active editor attachment versus Explorer/file-picker chip;
- chip with no open editor tab (remote should remain valid; local should clear or explain);
- same chip after new chat, thread restore, Reload, and activation;
- chip cleared, stale chip, tab switch, and repository switch;
- unavailable/denied/deleted remote file and wrong branch/ref;
- no chip plus an explicit named path (repo hunt route) versus no chip and “this file”;
- source citation navigation after a body-backed answer;
- large file or symbol beyond the first retrieval window;
- attachment body present in the UI but absent from the serialized model input;
- body-bearing remote result present in `turn.contextBundle` but removed by repo/branch isolation;
- code-file attachment behavior distinct from image/PDF paperclip serialization.

These should become stable supplemental IDs rather than one aggregate route row, because each crosses a different producer/consumer boundary.

## Minimal owner action and focused retest

The implementation owner should first add or expose safe diagnostics for one exact turn, without logging private source: attachment identity (`file`, `fileSource`, owner/repo/branch), fetch attempted/status, body-present/length/hash, route (`file-assistant` versus `indexed-repo`), bundle entry type/path/body-present, model-input body-present, and final evidence/citation path. Then rerun the exact two Strata prompts on a frozen candidate and a verified control file.

Acceptance requires a useful body-grounded answer to the first prompt and a context-preserving answer to the follow-up, with source identity/citation proof. A truthful missing-fetch explanation is useful failure handling for an unavailable file, but it is not a pass for the available attached-file happy path. Do not claim Fixed/live Pass until the named Extension Host session is rerun on the exact candidate.

