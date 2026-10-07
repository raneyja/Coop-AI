# File reading recovery — October 7, 2026

Status: COMPLETED for the scoped file-reading repair and named live controls.
Known response-speed follow-up remains; this is not a universal product pass.

## Latest result (supersedes the historical checkpoints below)

The actual failures were reproduced and repaired, not dismissed as flaky tests.
Three repository questions now identify and read the right remote source. Live
testing also exposed hidden-local-tab, reload, citation-formatting, and accidental
edit-instruction failures; their repairs are included in this same workstream.
Final live qualification completed on extension SHA256
`3c76df60c6dfeaf37ffbbb31f32255451defedab9d6a4f3310d2457e8b38c965`.

### Final-build live evidence

Runtime diagnostics prove the bundle above was used for each named turn:

- D1 parent rejection: live PASS, Plane / preview; actual parent guard and
  ValidationError cited. Turn `turn-1791403693818-upmg3m`, answer start 9.452s.
- D2 state writer + rejection: live PASS for supported source evidence,
  Plane / preview. Turn `turn-1791403644781-2x6q42`, answer start 8.546s.
  Both the state guard and same-class update delegation are shown, with the
  specific transition-policy limitation stated rather than invented.
- D3 signing rejection: live PASS from a fresh Documenso / main repo-only
  thread. Turn `turn-1791403823608-oir1mb`, answer start 8.258s. The actual
  `envelope.status !== DocumentStatus.PENDING` condition and error are cited.
- Remote citation/open/selected-range: live PASS. The D3 citation opens the
  API-fetched source. Selecting L107–111 and asking only about that guard cites
  L108–110 correctly. Turn `turn-1791403865245-abvhgq`, captured 10,308 source
  chars, answer start 14.632s. The generated remote viewing copy was closed
  without saving; the repository source was not changed.
- Local workspace whole-file/hidden-tab: live PASS. Explicit L1–122 selection
  persists with chat focused. `agentAnswerHistory.ts` reaches serialization
  (3,961 body chars including serialization newlines), quotes the actual
  `remote-read || turn-attachment` condition, and produces a clickable L74–78
  citation that opens the correct local file. Turn `turn-1791403692447-nqgxwv`.
- Wrong-file/read-only control: live PASS after repairing the generated-edit
  directive. Turn `turn-1791403642956-pw10bx` honestly says this local file has
  no signing status check, does not borrow Documenso's check, and proposes no
  patch. This is a source/read-only pass, not a concision or latency pass.
- Same-name external control: body-read/isolation PASS. Local `README.md`
  returns its unique token, not the open remote `README.md` body. Turn
  `turn-1791403781539-bap2jx`, 190 captured chars / 192 serialized chars,
  answer start 7.666s. The `/private/` fixture path is intentionally redacted by
  the existing sensitive-path policy, so its citation is not a clickable-path
  pass. The ordinary external-path control below verifies clickable citations.
- Ordinary external file + citation: live PASS. The generated external oracle
  contains `COOP_LOCAL_ORACLE_20261007_FINAL`; Coop quotes exactly that token
  and its line-2 citation opens the correct external file. Turn
  `turn-1791404022148-enrqbp`, 168 captured / 170 serialized chars, start 7.439s.
- Closed remote tab + reload + follow-up: live PASS on the same final build,
  turn `turn-1791403919130-upmza9`; 10,308 fetched source chars, answer start
  5.203s. Native answer quotes the actual deletion guard/error and cites L104–108.
- Genuinely unavailable remote file: live PASS. A deliberately nonexistent
  Documenso / main path returns a plain unavailable answer, with no fabricated
  body or invented line citations. Turn `turn-1791404079219-wlp8pw`, start 8.463s.
- User Stop: live PASS. A new D3 request was stopped immediately; the native
  chat shows `Stopped.`, no running controls, and no late answer. Diagnostic
  `user-stop` at `2026-10-07T20:15:16.408Z`; automated checks also verify that
  a delayed body cannot stamp a stopped turn.

Automated final-build gates: `npm run lint` PASS; `npm run test:ci` PASS (exit
0); `npm run package` PASS; staged diff whitespace check PASS. VSIX SHA256:
`004219c6cd3a49f64631161e7d65c4cf4a15db3e3a303c4f5396790c309bc6f9`.
The final CI log is `/private/tmp/coop-file-context-hidden-tab-ci.log`.
Selected non-content runtime metadata is saved in `final-runtime-evidence.json`.
It records repository/ref identity, source paths, body sizes, serialization,
and answer-start timings without saving source bodies or credentials.

### Failed, then repaired

- D3 discovery: same-repository index paths were discarded merely because
  branch metadata was missing. They are now discovery leads only; actual file
  bodies still must be read from the selected repository/ref. Explicit stale or
  mismatched maps remain rejected.
- D2: the correct serializer was read, but the writer verifier incorrectly
  evaluated source windows in tool-call order. It now reconstructs source-line
  order, finds the exact guard's class, and checks that class's real update
  method. Ambiguous/conflicting evidence fails closed.
- Closed remote follow-up: the deletion guard was present, but the rejection
  verifier failed to recognize it. Actual lifecycle checks with a throw are
  recognized; unrelated status mentions are not proof.
- Explicit remote activation was ignored in a fresh repo-only chat. Actual user
  activation now selects the remote file; passive background tabs remain ignored.
- A prior repo-only choice erased an explicitly selected local workspace file
  when opening a new chat. Explicit selection now overrides that old scope.
- Chat focus hides the source editor. Coop incorrectly treated that as closing
  the file and deleted the attachment. Exact open text tabs now retain their
  chip and live buffer, including unsaved content; truly closed/ambiguous/foreign
  files remain unavailable. Cold reload can load only the already-attached tab.
- Local answer cleanup flattened citation fences into plain text. Citation
  locators and source bytes now survive prose cleanup intact.
- Generated planner/synthesis instructions could classify an inspection
  question as an edit and demand an unrequested patch. The original user ask
  now controls the local-file directive on both serialization paths. Generated
  preambles cannot grant edit permission. No proposed test patch was applied.

### Known qualifications

- The Plane answer proves the shown state membership validation and update
  delegation. It does not pretend that these alone prove every backlog
  transition policy.
- Some local-file answers start after the soft 15-second target: 25.384s for
  the final wrong-file control and 27.641s for the final workspace explanation.
  Source delivery succeeds, but response speed is not yet a universal pass.
  Remote questions start in about 5–15s and the small external controls in 7–8s.
  Next speed work should isolate planner/integration gathering versus model
  first-token time on these exact local asks, preserving attachment ownership,
  citation integrity, and user Stop; do not reintroduce a body-discard timeout.
- Denied-source, delayed-read, wrong-ref, and turn/thread isolation controls
  have automated coverage; these are not claimed as live fault injections.
- The tested working tree includes preserved, unrelated pre-existing changes.
  The completion commit will include this workstream and relevant morning
  agent/retrieval/latency repairs, not unrelated billing/admin/website edits or
  the pre-existing webview CSP change. Candidate bundle identity describes the
  actual tested working tree, not an assertion of a clean-checkout build.

All dated checkpoints below are historical audit evidence, not current status.

October 7 resume: Jon restored Extension Host access. Live testing resumed;
candidate bundle 0ab5b4f6 is verified in actual answer-request diagnostics.
The earlier blank-surface blocker is resolved, not a reason to reopen unrelated
historical sign-in/billing/integration testing.

## Established baseline

Jon confirmed that sign-in, account switching, billing, integrations, repository
switching, autocomplete, editing, and reload testing were completed this week.
Do not convert an empty new-candidate ledger into a claim that these were never
tested. Reopen an area only for an observed regression caused by this repair.

Preserve local commits e2aa149 (reload chip hydration), 5ead3b4 (compound search),
and fc3d87f (startup context hydration). Preserve all existing dirty changes.
Attachment repair 314db4c already has narrow Strata/control live passes; extend
that work and qualify the remaining entry points. Commit the complete intended
work after the focused repair and verification, as Jon requested.

## Authorized scope

Identify the correct file, read it, retain its body through planning and final
model serialization, answer from it, and open the correct citation. Cover remote
open/closed tabs, local/external buffers, selected ranges, follow-ups, reload,
wrong-source controls, genuinely unavailable files, and repository-only hunts.
The restarted, pinned Extension Development Host is authorized for live tests.

## Evidence and execution

Starting HEAD: fc3d87f, branch checkpoint/dogfood-2026-10-03.
Baseline extension SHA256: b5f7a0925f7186b61ea39e9749c73aa5e26c5a5c05f0a2d0676d8fcaf912d8bf.
Native UI owner: this chat, pinned Extension Development Host / extension-dev.
The initial sidebar was stuck on Syncing context; reload requested through VS
Code's command palette. Other VS Code windows are outside live test ownership.

Record causal findings, candidate hashes, automated checks and individual live
results below. Source metadata diagnostics must exclude source bodies/secrets.
Historical results remain historical; tests are graded individually.

## Repairs implemented in this chat

- Removed the independent four-second race that discarded an explicit remote
  file read while its actual request continued. A turn waits for its own read;
  user Stop releases the wait and prevents a late body from being stamped.
- Normal synthesis waits for the turn-owned attachment, retains its actual line
  range, and never substitutes the current thread's pending file when the
  original read fails. Repository/ref identity remains frozen for the request.
- Unavailable local/external targets cannot fall through to a leftover remote
  repository's same-named file.
- Remote attachment fallback reads through IndexedRepoWorkspace and slices the
  selection once. Previously a pre-sliced excerpt was sliced a second time.
- Answer-history compaction retains complete turn-attachment evidence, like
  verified remote reads, and keeps source provenance.

## Automated verification

- `npm run test:ci`: PASS (exit 0). This is the existing regression gate, not a
  claim that all historical product areas must be dogfooded again.
- `AgentOrchestrator.test.ts`: 103/103 PASS, including the slow-planning handoff
  that was previously reported as failing. Includes existing morning repairs.
- `threadActivation.test.ts`: PASS with new selected-range, async restoration,
  wrong-thread negative, unavailable-source negative, Stop, slow-read ownership,
  and closed-local/remote-fallback controls.
- `agentAnswerHistory.test.ts`: 5/5 PASS, including late implementation text
  surviving attachment serialization with provenance.
- `npm run lint`: PASS after implementation.
- `npm run build:extension-dev` and `npm run package`: PASS.
- `git diff --check`: PASS.

The cached tsx loader was used for targeted tests because the local runner was
missing; network approval allowed the normal CI command to run successfully.

## Historical live checkpoints — earlier candidates

The pinned Extension Development Host can browse the remote fixture repository.
README.md opened, and its remote file chip appeared. Initial native accessibility
diffs were stale: a full, non-diffed observation showed the actual live answer
and command palette. Use full observations until control consistency is restored.
The initial README explain quoted its real text and produced a README line-3
citation. Diagnostics confirmed 213 captured source chars, body in final request,
and answer-start at 13.486 seconds. It was running baseline bundle b5f7a092, so
this is a BASELINE pass only, not qualification of the repair. Reload was then
executed through the actual command palette; new runtime identity still must be
verified on a new answer request.

After the 11:11:48 PDT reload, both sidebar and a newly opened chat panel were
blank. The runtime log confirms the development extension loaded from this
checkout, but no new candidate answer has been sent. Toggle/reopen sidebar,
fresh chat, Reload Webviews, control-session recovery, full accessibility
observations, and native Webview Developer Tools inspection were attempted.
The console showed unrelated Copilot/remotehub compatibility warnings and
blocked source-map requests, not a confirmed Coop render exception. Do not
weaken CSP or guess that these warnings caused the blank panels. Live grading
remains blocked pending a usable foreground Extension Host surface. Jon should
bring that host to the foreground and confirm whether the chat is visible;
restart it if it is still blank. No candidate live Pass or completion commit.

Current packaged candidate extension SHA256:
0ab5b4f640842ea36aa85bd15ae7fd09150553c92f9997a958ea29f1b92faed8.
Webview SHA256:
5e1f55cec41a066a8da2f87dff31034ba6556e25ab9aba57b69a99501a99f1dc.

Do not label this candidate Fixed/live Pass. Do not commit it as completed
dogfood work until the following live gate is actually exercised.

## Original execution gate (historical)

1. Verify the rebuilt bundle is loaded and the composer is ready.
2. Run a remote file initial explain, selected-range explain, and follow-up;
   inspect source-body diagnostics and open the returned citation.
3. Repeat with the remote tab closed/restored and after reload. Check a local
   explicit buffer separately; verify same-path remote/local controls do not
   substitute source.
4. Fresh repo-only D1/D2/D3 asks from docs/agent-dogfood.md, with each selected
   fork/ref explicitly verified. Record search -> read -> attached evidence ->
   final response, not just whether the prose looks plausible.
5. Test genuine unavailable/denied source honestly, cancellation, and a delayed
   read; repeat any failed case after repair on one frozen candidate.
6. Publish individual live results and remaining gaps here, then assemble only
   intended completed diffs with the existing morning work for the requested
   commit. Preserve unrelated billing/admin/website work.

## Candidate live results

- D3 initial replay on 0ab5b4f6: FAIL. Same-repo graph tree returned 2381 paths
  but omitted indexedBranch. The client discarded the response; filename
  fallback used the entire remaining 19-second evidence window with zero reads.
  Run 1de29c1b-f698-4849-a534-172bf28d205b. This is a discovery contract failure,
  not a missing file or a failure to access local disk.
- Repair: retain same-repo, non-stale paths with missing ref metadata as explicit
  unverified discovery leads. Reject explicit branch/repository mismatches.
  Only canonical selected-ref reads can promote leads into answer evidence.
  Added API-to-workspace regression coverage and retained mismatch/stale gates.
- D3 exact rerun on 0ad7778c: PASS for search/read/answer. Selected
  github:CoopAI-Corp/documenso main, fresh chat, no file chip. Real remote body
  packages/lib/server-only/field/sign-field-with-token.ts (10308 chars) read and
  verified, then attached as read_file evidence. Answer names that file, quotes
  the envelope.status !== DocumentStatus.PENDING guard and its actual
  `Document ${envelope.id} must be pending for signing` error. Answer-start
  9.323 seconds. Run f2b44d74-b7e4-4431-839a-2623f3a016fe. Citation-open check
  separately underway. Attachment block counters are zero for repository-only
  hunts because opened read_file evidence travels in history, not direct file
  attachment XML; zero XML counters are not proof of missing source.

- R-followup/reload: PASS. Remote README.md on
  github:CoopAI-Corp/coop-dogfood-launch, branch renamed. Asked `What does the last
  sentence of the attached README require? Quote it exactly and cite its line.`
  The anchor initially had no body after reload, then the remote read supplied
  213 chars; final serialized source block was present (215 chars with wrapper
  newline handling). Answer quoted `All expected answers must be verified from
  the selected remote commit.` and cited README line 3. Runtime bundle 0ab5b4f6;
  turn turn-1791397005078-g7397y, run 646c1e94-a022-4164-a1ac-ef5ac3542f26.

- D1: live PASS on 0ad7778c, github:CoopAI-Corp/plane preview, new chat with
  no file chip. Exact parent-error ask found and read the issue serializer,
  answered its same-workspace/project check, cited lines 128–137.
- D3 selected lines: live PASS on 0ad7778c. Citation opened the actual remote
  file in an API viewing tab. Selected lines 107–111; follow-up correctly
  quoted PENDING guard and its error with source lines 108–110. Captured
  10308 body chars and retained full body in final request.
- Closed remote source: FAIL twice on 0ad7778c. First run had no source body
  before handoff; second did read 10308 chars but still canned-missed because
  the verifier expected a payload-field/state rejection rather than the
  actual throwing deletion condition. Added lifecycle-guard evidence check
  with wrong-status/nonthrow/UI negatives, plus safe anchor-read diagnostics.
  Rerun on 15d36fa6: live PASS, tab remained closed across reload; anchor read
  supplied 10308 chars, answer quoted `envelope.deletedAt` and the actual
  deleted-document error at 104–106. Worked 7s. Run
  0111c416-e40b-4cb5-9b1f-2fc1aa6ee843.
- D2 on 0ad7778c and 3c3c68be: FAIL/partial. Read the correct serializer and
  found real state rejection, but failed to retain its same-class update.
  Remote source independently confirmed validate at 121–126 and update at
  234–288, ending in `super().update(instance, validated_data)`. Repair now
  anchors writer recovery at the exact unique asked rejection row, not the
  beginning of a full file (imports) or concatenated disjoint read windows.
  Ambiguous rows and neighboring-class writers remain rejected. 104/104
  orchestrator tests pass, including full-file header and fragmented-window
  regressions. Latest candidate c1b6a881 is loaded for live reruns; D2 remains
  open until the live result is verified.
