# Live dogfood run — October 3, 2026

Paused because macOS locked during the next selected-code workflow. This is a development-host run against production API, not a packaged-release certification. Ledger and evidence files are authoritative for recorded attempts; no unexecuted check is a pass.

Candidate extension: `52e748e47f92bc479faa71d2076f0b4da16c3ade1f09e37a79c75038b7f7d016`. Webview: `7d6dc75d48895b48069ad96d87953ed1ec623e5bd3433fbc6e4ae318982e7ab1`. VS Code 1.139.1. Backend deployment and exact remote commit remain unverified.

## Findings so far

- Direct Bearer parser lookup and selected-ref citation work on GitLab Coop-AI/main. Draft survives reload.
- Natural request-flow explanation asks the user to paste source despite selected indexed repo.
- Inventory question routes to code-location/gaps rather than inventory.
- Plane Parent, state-write, assignee, State-model and compound auth/state asks fail. Indexed map response returns data but lacks selected branch/commit fields in diagnostics; discovery reports indexed_map_unavailable. This is the same extension hash as yesterday.
- Documenso signing guard also returns a canned miss.
- Authentication-file lookup includes a 241-line source card; correct file but poor answer focus.
- Lint passed. test:ci fails handleChatSend slash-routing source assertion; test:agent-ship fails honesty H-G9 leftover Blast/Owner chip assertion. Both suites stop early, so later chained gates are unexecuted.

The first repeated Bearer lookup accidentally acquired an editor source selection after opening a citation. It is excluded from the no-chip acceptance run; a neutral editor rerun is recorded instead.

Local edit fixture lives in `/private/tmp/coop-app-dogfood/fixture.ts`; the independent assertions reproduce a seeded off-by-one bug before repair. No application source has been changed during this run. Diagnostic workspace setting was temporarily enabled to capture loaded bundle and retrieval stages.

## Additional live findings

- Selection-to-New-chat loses L10–17 and produces a clarification request; existing-thread selection explanation works. Added DF-075 regression.
- Selected remote `/edit` creates a correct minimal rename card. Apply reports success, but selected buffer remains original and Open file opens another original remote buffer. Actual applied target was not established, so no Apply pass is claimed. Undo and Reject functioned; disk source remains unchanged.
- Natural-language test generation read the test file and called propose_patch twice but delivered a locate miss instead of an applicable patch. Answer-start 18.33s.

Model picker subset: paid GPT-5 mini selection persisted through reload; original Auto preference restored. Full model assignment case is not certified because actual selected provider use and background assignment were not observed.

- Owner conflates Jon Raney/Jonathan Raney as separate primary and backup engineers using repository-wide commit counts; no verified file-specific ownership.
- Blast reports 23 module importers as 23 verified callers of one function and asserts all callers assume it never throws without reading call sites.
- Trace cites a historical soft-deadline rationale but does not reconcile selected current remote source that declares a hard ceiling and calls `controller.abort`. Current remote main and local uncommitted source differ; local code is not the oracle for this remote test.
- Gaps takes 2m55s and produces eight repetitive documentation questions unrelated to the named auth function. Its activity output exposes lengthy internal instruction-conflict discussion.
- Explicit disposable local `/fix` generates the correct repair but sanitizes the actionable filename to literal `[INTERNAL_PATH]`. Apply fails to resolve it. Reproduced with visibly verified L1–7 selection in editor group 2; independent behavior assertions still fail.
- COOP-101 cross-tool question retrieves the actual demo Jira epic and identifies its seed disclaimer, but reads/maps no code despite selected remote repo.

Harness qualification: editor panes briefly appear blank while accessibility contains stale source. Switching tabs and returning refreshes the actual buffer. Remote rename Apply was subsequently verified in Untitled-25: all three references changed, six independent parser assertions pass, and Undo restored original source. The earlier ambiguous remote Apply failure is withdrawn. The separate local `[INTERNAL_PATH]` failure reproduces with visible source and exact L1–7 selection.

Stale remote proposal check passes: after replacing the selected parser with a disposable comment marker, Apply refuses `SEARCH block not found`, disables the button and preserves the intervening edit. Editor Undo restores source.

## Latest results

- Remote rename duplicate-Apply protection passes: Applied replaces Apply with Undo; refreshed scratch buffer contains one function and exactly three renamed references. Undo restores original source.
- Stop/edit recovery fails: cancelled structured-token/all-callers request contaminates immediately subsequent rename-only proposal (two files/four edits, including return-type change). Rejected without applying.
- Editor Trace honestly reports missing documented rationale/alternatives and labels code inference; separate slash false-premise case remains failed. Workflow Owner remains failed for overstating sole ownership/knowledge from authorship and absence of review data.
- Explicit repo-name Compare streamed a source-backed answer then replaced it at completion with a canned miss.
- Existing Google Docs architecture document body matches independent browser inspection (DF-076); original unique-marker and denied-access integration scenarios remain blocked. Confluence supplemental response renders a relative source URL as literal Markdown.
- Ten targeted suites pass; aggregate CI and agent-ship failures remain unresolved.

## Checkpoint at lock interruption

120 required scenario/mode checks: 20 PASS, 24 FAIL, 44 BLOCKED, 32 NOT_RUN. These are individual functional observations, not release certification. Some PASS attempts lack timing or exact fixture SHA; the release checker rejects incomplete evidence. Blocked connector markers and billing/access faults were not supplied; supplemental live reads do not replace their required oracle.

- Reopened-thread follow-up failed: prior Coop main answer retained last selected Plane preview; it searched unrelated Plane files and asked for a function name.
- Thread switch during streaming contained the answer in its origin, but lost an unsent Documenso draft.
- Sidebar, editor and moved chat window worked as surfaces; keyboard Send, Stop, source citation and extension settings were usable. Keyboard edit produced no patch preview.
- Copy message and code produce clean usable content. Actual displayed source is 264 lines (authUserId starts203); composer source range grows to L1–519 / L1–531 after citation rather than203–208. Earlier source-card line count should not be treated as whole-file length.
- Temporary diagnostic workspace setting was restored. Only dogfood artifacts were authored; application source was not modified. The auxiliary test chat window could not be closed after macOS locked.

To continue, unlock macOS. Resume the 32 NOT_RUN rows, then address failures and rerun on a rebuilt candidate. Account/fixture blocks still require disposable test prerequisites. No production-ready claim is supported.
