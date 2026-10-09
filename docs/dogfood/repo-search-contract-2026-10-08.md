# Repository search repair — October 8, 2026

Status: Automated Pass and live Pass for the three requested follow-up gaps on the final candidate.

## Target

Answer questions about the selected indexed remote repository from verified
source evidence, including explicit source-file questions that require more than one file, per-file exclusions, and inventory/layout questions combined with requested sources. Within
that supported route, every requested file must contribute its own body or an explicit unresolved outcome.
One successful read, an inferred planner result, or cached guidance cannot
satisfy the entire question.

This repairs the observed INSTR-01 regression and its related source-scope,
multi-file, routing, and synthesis failure classes. It does not reopen the
completed historical sign-in, billing, editing, autocomplete, integrations,
reload, or October 7 file-context qualifications.

## Corrected diagnosis

The remote `CoopAI-Corp/documenso@main` root AGENTS.md actually contains both
rules in the user's latest response: prefer `type` over `interface`, and never
use classes; prefer functional/declarative patterns. The previous chat's claim
that the latter was unsupported was wrong. Automatic instruction loading is
deliberately absent from activity chrome, so the visible one-file activity
alone cannot establish that automatic loading failed.

Independently reproduced defects were:

- Repo-only detection missed the exact selected owner/repo wording and allowed
  negated integration names. The initial gather boundary also needed a veto.
- Named-file seeding stopped after the first successful body and chose arbitrary
  paths for ambiguous basenames.
- Package directory shorthand such as `apps/api` incorrectly classified longer
  file paths under that directory as repository-layout questions.
- Explicit numeric citations to root files were rejected and could inherit an
  unrelated nearby path. Rendering and grounding disagreed for language tags
  and preambles. An unmatched model-added closure could survive as source text.
- A plain/noisy planner or remote-chip explanation guard could bypass the
  repository evidence path entirely.
- Specialized rejection synthesis could prune an independently requested file
  or return a single-part miss. History compaction capped file arrays at six.

## Implementation contract

1. Freeze canonical repository/ref through the existing turn/run target resolver.
   Use IndexedRepoWorkspace and code-host/API readers only. Reject returned
   path or supplied repository/ref metadata mismatches; never use local fallback.
2. Capture original user source restrictions independently of rewritten query
   terms. Repository-only and excluded tools veto inferred tools, integration
   slash/provider inclusion, quick-action heuristics, agent calls, and backfill.
   Explicit mixed requests remain eligible for their allowed providers. The
   integration-enrichment boundary rejects repo-only requests before scope
   lookups or activity starts, including attachment fallback turns.
3. Read exact paths directly. Treat explicitly requested root paths and root
   AGENTS.md as exact. Resolve other basenames case-sensitively; multiple exact
   candidates produce ambiguity, never an arbitrary body.
4. Resolve each requested file within the existing shared soft gather budget and
   read limit (currently ten). Outcomes are read, unavailable, or ambiguous.
   Unavailable includes missing/denied/failed/budget-limited reads: it never
   proves absence. Truncated bodies remain explicitly partial.
5. Route explicit file questions through retrieval even when the planner says
   plain/none. Preserve local file-assistant, explicit edit, workflow/slash,
   how-to and edit boundaries. Compound inventory/layout-plus-file questions use the same frozen target and retain both facts and requested bodies. A remote chip cannot own other named files. A targetless remote chip must
   request Use repo before resolving another requested file.
6. Retain every required body, real line numbers, repository/ref metadata, and
   outcome through actual writer serialization, including specialized hunts.
   Selected-range captures cannot satisfy a requested full file. Automatic
   instruction guidance remains separate from explicit instruction-file evidence.
7. Answer supported parts and identify unsupported parts. User Stop suppresses
   later reads/synthesis and late evidence delivery. Soft budget exhaustion
   still permits an honest answer; it never aborts the turn as a latency error.

8. Apply per-file exclusions from the original question before attachment acceptance, automatic AGENTS.md guidance, file reads, blame, filename discovery, and index/code-host search results. Exact-path exclusions affect that path; basename exclusions affect matching basenames. Negative commands require file objects and complete command tokens: descriptive "ignore pattern" prose and filenames such as ignore.ts are not exclusions.
9. Collect inventory/layout facts through IndexedRepoWorkspace in parallel with requested-file reads under the existing shared budget. Keep independently fulfilled components when a sibling fails or remains pending, reject supplied wrong-ref facts, and suppress late facts after Stop or budget handoff. Totals require canonical repo_inventory; unavailable totals remain unavailable.
10. Direct source questions skip model intent refinement and the discovery planner, preserve each body once, and write the answer with thinking disabled on the existing assigned model. Broad discovery, impact, security, edit, history, and caller questions retain the planner. Attachment-only turns retain their captured evidence. The soft 15s target measures the first answer delta; elapsed time never aborts the turn.

Natural-language scope recognition is covered for the tested English forms;
this is not a claim of perfect interpretation of every possible phrasing.
Repository totals continue to require repo_inventory, not file samples.

Current boundaries: arbitrary extensionless filenames are
not generally recognized; root Dockerfile/Makefile and explicit dotfiles
are covered. Historical-answer citations after changing the selected repository
or branch were not requalified; this live gate opens citations in the same
selected target as the tested answer.

## Success gates

- `npm run test:repo-search` is included in `test:ci`; it exercises actual routing,
  public orchestrator runs, and writer-history compaction. Tests inspect source
  calls and final bodies/outcomes rather than matching only prompt instructions.
- Existing routing, orchestrator, integration enrichment, instruction, target
  isolation, and relevant deadline regressions remain green.
- `npm run lint` and `npm run build:extension-dev` pass on the final candidate.
- Independent review has no unresolved actionable findings in this scope.
- Excluded paths never reach source/guidance calls or final bodies; compound questions preserve each verified fact and source, including independent failure/budget cases.
- Replay the three observed latency misses on the final candidate: correct supported answers, honest unavailable outcomes, and first answer delta within the soft 15s target. This is measured qualification, not a guaranteed bound on every provider response.
- Live Extension Host replays below use the rebuilt candidate and record selected
  repository/ref, turn/build identity, source delivery, answer, and citation open.
  Automated green alone is Automated Pass, not fixed/live Pass.

## Required live replays

Extension UI: reload the Extension Development Host, choose
`CoopAI-Corp/documenso` on `main` using **Use repo**, and use fresh chats. Do not
upload/paste AGENTS.md. Run the original once with a remote config-file chip and
once without a chip.

Original:

> Using only the selected CoopAI-Corp/documenso repository context, list two concrete rules from its root AGENTS.md. Then state the value of appDirectory in /apps/remix/react-router.config.ts.

Reversed/variant:

> Using only the selected CoopAI-Corp/documenso repository context, state whether ssr is enabled in /apps/remix/react-router.config.ts. Then quote two concrete rules from its root AGENTS.md.

Unavailable control:

> Using only the selected repository context, state appDirectory from /apps/remix/react-router.config.ts. Then quote /__coop_repo_search_missing_20261008__.ts.

Pass: original/variant bodies for both requested files reach final synthesis,
rules match the remote file, `appDirectory` is `'app'`, `ssr` is `true`, no external
integration fetch starts, and citations open the correct remote source.
Unavailable control must answer the config part and plainly report the second
body unavailable, without fabricated content/citations or a confirmed-absence
claim. Any unsupported rule, omitted supported part, wrong-source citation,
external fetch, or false completion is a Fail.

## Expanded scenario coverage

Eleven additional scenarios run the actual rules front door, send routing,
public orchestrator, remote-reader fixtures, and writer-history compaction.
Each asserts every exact-path body and outcome, canonical target, and no
redundant reads. These are evidence-delivery checks, not simulated model answers.

1. Root README plus package onboarding commands.
2. Quoted relative tsconfig and build-config paths.
3. GitHub CI workflow plus package validation scripts.
4. SQL schema and migration comparison.
5. Python model and serializer field mapping under apps/api.
6. React component plus CSS source.
7. Rust implementation plus Cargo configuration.
8. Go handler plus its test.
9. Dotted JavaScript config plus API route.
10. Repeated file references deduplicated alongside another file.
11. Dockerfile, Makefile, and a root ignore dotfile.

Existing checks additionally cover ambiguous/unique basenames, case-sensitive
paths, explicit root selection, denied/missing bodies in either order, seven
required bodies surviving compaction, wrong repo/ref/path metadata, wrong-branch
attachments, selected-range refetch, truncation, gather exhaustion, Stop,
specialized semantic hunts, planner misclassification, and integration vetoes.
Citation checks exercise all three parser copies and actual grounding, including
invalid ranges, root coordinates, preambles, language tags, and ordinary source
properties such as port:3000.

## Historical first candidate evidence

Automated Pass on the first candidate: `test:repo-search` passes 106 checks
(34 source-scope/routing, 39 orchestrator evidence, 5 history, 16 citation
locator/parser, 12 grounding). The eleven additional scenarios above pass.
Final `npm run lint`, `npm run build:extension-dev`, `npm run test:ci`,
`npm run test:chat-threads`, chat-prose checks, and `git diff --check` pass.
Independent review reports no unresolved actionable findings in the inspected
repairs, including the final integration veto and missing-target guard.
The full CI output is retained locally at `/private/tmp/coop-repo-search-ci.log`.

Live Extension Host functional Pass on the seven named answers below, after
Reload Window, using `CoopAI-Corp/documenso@main` and fresh chats. First candidate extension
bundle SHA256 is
`2724490573bfacf6385376722ca9f248a6513ae0cb4460c3949c2ca43580fe9a`;
webview SHA256 is
`8f83ff4060dd745ffe2a536ddb7e1334b3eb875bdac492f5dcf9d936eaeeabba`.

- Original, no file chip: `turn-1791502819237-witj6e`, answer starts at
  12.277s. Both full remote bodies reach synthesis; rules and `appDirectory`
  match the source. AGENTS.md 18–26 and config 3–5 citations were clicked:
  each opens its correct full remote body with the cited selection. The
  unmatched model-added closing brace is removed by source grounding.
- Original, partial config chip L3–5: `turn-1791502878105-ymte98`, 9.754s.
  Both independently requested full remote bodies reach synthesis; supported
  rules and config value are correct despite the partial selection.
- Reversed SSR/config then root rules: `turn-1791502907844-74lviz`, 14.923s.
  Both bodies survive in reversed order; SSR is true and quoted rules match.
  The answer includes adjacent guideline lines as well as the requested two.
- Unavailable second file: `turn-1791502981248-vtv1zy`, 18.442s. Config value
  is correct; the synthetic missing path is explicitly unavailable, without
  invented content or a claim that the file is confirmed absent.
- Package/Turbo: `turn-1791503048079-lozusl`, 16.792s. Prompt: "Use no
  integrations. Read /package.json and /turbo.json from the selected repository.
  Quote the exact lint script from package.json and state the build task
  dependsOn values from turbo.json." Answer: `biome check .` and
  `["prebuild", "^build"]`, with the correct root-file citations.
- Ignore files: `turn-1791503184464-ci5xw0`, 27.846s. Prompt: "Use no
  integrations. Read /.gitignore and /.dockerignore from the selected
  repository. List one ignore pattern shared by both and one pattern present
  only in .gitignore." Answer correctly identifies shared `node_modules` and
  gitignore-only `.idea`, citing .gitignore 6/45 and .dockerignore 4.
- CI/package: `turn-1791503229759-ehp0qg`, 11.563s. Prompt: "Using only the
  selected repository context, read /.github/workflows/ci.yml and /package.json.
  Quote the command used by the Build app step, then state what the root build
  script runs." Answer correctly quotes `npm run build` at CI 29–30 and
  `turbo run build` at package 9–12.

An eighth live control, immediately after reload with a targetless remote chip,
requests **Use repo** before answering the original compound question. It
starts no agent synthesis. Selecting the repository then permits the no-chip
pass above. Question turns start no integration prefetch; two background
`file_metadata` prefetch events from citation-open context changes are separate
from these scoped question turns.

The final-request diagnostics confirm `remote-read`, the canonical repo/main
target, nontruncated bodies, and independent read/unavailable outcomes for each
answer. Raw bodies and rendered facts were checked against code-host reads.
Diagnostics are in the local VS Code log directory
`20261008T124201/window3/exthost/output_logging_20261008T163857`.

At that first qualification, latency was not fully qualified: three of seven answered turns exceeded the soft
15s start-answer target (18.442s, 16.792s, 27.846s). They answer honestly rather
than aborting. The functional passes do not constitute a latency Pass or a
claim that every repository-question shape is supported. Those three misses motivated the follow-up qualification below. No commit, push, or deployment was performed.


## Follow-up qualification for the three reported gaps

Final candidate extension SHA256:
`0105b6c54f7f7e7ea164d6b9a9e2212ae6be2e2b98db4365474a4adb01b5bf72`.
Webview SHA256 remains
`8f83ff4060dd745ffe2a536ddb7e1334b3eb875bdac492f5dcf9d936eaeeabba`.

Automated Pass: 182 repo-search checks (21 direct/compound hot-path, 69 scope/routing, 59 evidence, 5 history, 16 locator/parser, 12 grounding). New checks exercise real Session serialization and public Orchestrator runs, independent inventory/layout success/failure/pending/wrong-ref outcomes, excluded guidance and attachment vetoes, snippets/symbols/blame, Stop, shared-budget handoff, broad-question planner retention, and attachment-only evidence preservation. Final lint and extension build pass. Independent review has no unresolved actionable findings. Final `npm run test:ci` exits 0; output is retained at `/private/tmp/coop-repo-search-gaps-ci.log`.

An intermediate live candidate (`4c3f0d0…`) failed the exact dotfile comparison: `ignore pattern` falsely excluded .gitignore. Turn `turn-1791506112363-lln0mc` started at 4.226s but is a functional Fail. Its exact prompt was added as a regression and the command/object parser corrected before the final build. Full CI also exposed an attachment-only regression; the direct-answer guard now requires actual repository-file outcomes and enabled repository tools. The existing Orchestrator suite passes 105/105 after that correction.

Final live replay: Reload Window, explicitly select `CoopAI-Corp/documenso@main` through Use repo in each fresh chat, then verify UI facts against code-host source and canonical diagnostics.

- Ignore-file replay: `turn-1791506410808-ez5d5i`, first answer 4.086s (previously 27.846s). Both full remote bodies reach synthesis. Answer: shared `node_modules`; gitignore-only `packages/prisma/generated/types.ts`, checked against both remote files. Functional and latency Pass.
- Package/Turbo replay: `turn-1791506453583-pwx2gk`, 3.632s (previously 16.792s). Exact lint `biome check .` and build dependsOn `["prebuild", "^build"]`, with correct source citations. Functional and latency Pass.
- Unavailable-file replay: `turn-1791506478225-g339yz`, 4.200s (previously 18.442s). Config value `'app'` is supported; second remote body explicitly unavailable, with no fabricated content or confirmed-absence claim. Functional and latency Pass.
- Excluded root instructions: `turn-1791506531397-jkdf8a`, 2.256s. Ask: "Using only the selected repository, read /apps/remix/react-router.config.ts and state appDirectory. Do not read or use /AGENTS.md." Only config is a requested body and final evidence; value `'app'` and citation are correct. Automated Session tests independently verify no guidance-loader call. Functional Pass.
- Inventory plus source: `turn-1791506566456-yc6enh`, 2.714s. Ask: "Using only the selected repository, how many files are in this repository? Then read /apps/remix/react-router.config.ts and state appDirectory." Answer gives 2,381 files, exactly the main-branch index-stats `repoInventory.fileCount`, and `'app'`, grounded in the full config body. Both independently delivered into the same final request. Functional Pass.
- Layout plus source: `turn-1791506600383-n6xmfd`, 3.491s. Ask: "Using only the selected repository, list its top-level directories. Then read /package.json and quote the build script." Answer lists all 13 canonical main-branch tree directories and quotes `turbo run build` from the full root package body. Functional Pass.
- Ordinary excluded file: `turn-1791506650198-2anyar`, 3.293s. Ask: "Use no integrations. Read /package.json and quote the lint script, but do not read or use /turbo.json." Only package.json is remotely read and delivered to synthesis; answer quotes `biome check .`. No Turbo source/citation is used. Functional Pass.
- Inventory plus layout plus source: `turn-1791506677283-f816p7`, 3.348s. Ask: "Using only the selected repository, how many files are in this repository and what are its top-level directories? Then read /apps/remix/react-router.config.ts and state appDirectory." Both canonical main-branch fact components and the full config body reach final serialization. Answer correctly gives 2,381 files, all 13 top-level directories, and `'app'`. Functional Pass.
- Original regression replay: `turn-1791506708434-8hlnm8`, 3.187s. Both full AGENTS.md and config bodies independently reach synthesis. Answer quotes the actual TypeScript/type rule and frontend AppError.parse rule, then states `'app'`. AGENTS.md 18–26 and config 1–6 citation clicks open the correct full remotely fetched source with those ranges selected, using temporary untitled source viewers; both generated viewers were closed without saving. Functional Pass.

All nine final-build answered replays start in 2.256–4.200s, below the soft 15s target. The three formerly slow exact prompts now pass both functionally and for observed latency. This does not promise a hard service bound across future provider/network conditions. No turn is aborted merely because its soft deadline elapsed.

Final diagnostics: local VS Code log directory `20261008T124201/window3/exthost/output_logging_20261008T173945`, `2-CoopAI Agent Diagnostics.log`. All nine question turns identify the final bundle, canonical `github:CoopAI-Corp/documenso@main`, and only read_file activity tools. Final requests contain independent requested outcomes and remote-read bodies; compound fact metadata matches the rendered answers. Excluded sources are absent from question remote-read activity and final bodies. Guidance-fetch vetoes and other planner bypass attempts are verified by the actual Session/Orchestrator automated suites.

The requested per-file exclusions, inventory/layout-plus-source questions, and three observed latency misses are now qualified on this build. Historical first-build passes and misses above remain evidence for those older builds. Existing unrelated historical qualifications remain closed. No commit, push, or deployment was performed.


## Release 0.1.12 — October 8

The user authorized push and deployment after the qualification above. Release metadata only is bumped to 0.1.12; behavior matches the qualified candidate. Lint, Marketplace listing, and all 182 repository-search checks pass again. VSIX SHA256: `144877dfb2aafbcae2ed882873a3cfc5424a8fe6c46c5b3cb1759997f090b6a6`. Extension bundle SHA256: `71712a96fc807ba0ff7f90beec23ce18401b971325a2c3f7d43eb04f4f98155d`; webview bundle remains unchanged. Production deployment identities are recorded separately after release.

### Tonight's three manual confirmation tests

Extension UI — use the Extension Development Host for this checkout. Run Developer: Reload Window, then select `CoopAI-Corp/documenso` → Use repo and wait for `main`. Use a fresh chat and explicitly select that same repository for each test. Do not paste/upload source files. The ordinary installed Marketplace extension does not acquire these changes from an API deployment; this release is also packaged as the local `coop-ai.vsix` (version 0.1.12).

1. Per-file exclusion:

   > Using only the selected repository, read /apps/remix/react-router.config.ts and state appDirectory. Do not read or use /AGENTS.md.

   Pass: `'app'`, a correct config citation, no AGENTS.md read/citation or external integration activity.

2. Inventory, layout, and source together:

   > Using only the selected repository, how many files are in this repository and what are its top-level directories? Then read /apps/remix/react-router.config.ts and state appDirectory.

   Pass: canonical indexed count (2,381 in today's run), the verified 13 top-level directories, and `'app'`. If canonical facts are unavailable, say so rather than estimate and still answer the supported config part.

3. Previously slow dotfile comparison:

   > Use no integrations. Read /.gitignore and /.dockerignore from the selected repository. List one ignore pattern shared by both and one pattern present only in .gitignore.

   Pass: shared `node_modules`; a verified gitignore-only pattern such as `.idea`, `packages/prisma/generated/types.ts`, or `.turbo-cookie`. Both files must be read; no unsupported comparison or external integrations.

For all three: note time to the first answer text (target within 15s), and click any code citation to verify the correct source/range. Capture the prompt, answer, and elapsed time if a test fails.

### User manual confirmation — October 9, 2026

Jon supplied the three exact prompt/answer transcripts at 10:12–10:13 AM.
Each transcript identifies `CoopAI-Corp/documenso`, branch `main`, with repository
context only. Runtime build identity and citation-click outcomes were not supplied.
Reported durations are the UI's `Worked for` values, not instrumented first-token
measurements; all three reported durations are below 15 seconds.

- Test 1, 10:12 AM: functional live Pass. Worked for 4s; activity shows only
  `apps/remix/react-router.config.ts`. Answer states `appDirectory` is `app`,
  with the correct source body and lines 1–7. No AGENTS.md read/citation is
  shown in the supplied transcript. This transcript does not independently
  inspect hidden guidance-loader calls; those retain their automated coverage.
- Test 2, 10:12 AM: functional live Pass. Worked for 7s; activity shows the
  config read and indexed inventory lookup. Answer supplies all three parts:
  2,381 files, the 13 expected top-level directories, and `appDirectory: 'app'`
  with the correct lines 3–6. The answer repeats the inventory/layout facts
  in a second paragraph; this is a concision issue, not a retrieval failure.
- Test 3, 10:13 AM: retrieval and prose answer live Pass; citation presentation
  remains pending clarification. Worked for 6s; activity shows `.gitignore`
  and `.dockerignore` reads. Prose correctly names shared `node_modules`
  (.gitignore line 6, .dockerignore line 4) and gitignore-only
  `packages/prisma/generated/types.ts` (line 3). The pasted rendering includes
  `3|packages/prisma/generated/types.ts` in both displayed code groups, followed
  by `: .gitignore` and `: .dockerignore` respectively. If those are the actual
  source labels, the second preview contains wrong-file content. Raw assistant
  markdown or a screenshot is needed to distinguish a citation defect from
  transcript formatting. Do not claim a full citation Pass from this transcript.

### Citation screenshot follow-up — October 9, 2026

Jon's 10:17:54 AM screenshot confirms the reported citation defect. Read-only
inspection of saved thread `thread-1791566013145-c8gmr1` establishes that the
assistant's raw response contains a `.gitignore` fence with numbered rows 3 and
6 and trailing `: .gitignore`, followed by a separate `.dockerignore` fence with
only numbered row 4 and trailing `: .dockerignore`. The latter source body does
not contain the gitignore-only pattern. The parser misidentified
`3|packages/prisma/generated/types.ts` as a path, consumed it as the first
fence's location, and borrowed it as the second fence's header. This was a
citation parser failure, not wrong-file retrieval.

Repair: reject numbered source rows as locator paths, recover strictly ordered
numbered rows with an explicit trailing file label, and split omitted lines into
separate real ranges. Recovery is shared by final grounding and source extraction
and mirrored in extension/admin/website parsers. The model output contract now
explicitly prohibits copying numbered rows into headers or trailing file labels.

Automated Pass: chat prose 67/67, highlighter 6/6, repo search 185/185 (including
18 locator and 13 grounding checks), system prompts 58/58 and attachment
diagnostics. Lint, extension development build, and diff whitespace check pass.
Regression cases cover the exact output, source paths inside numbered rows,
noncontiguous ranges, indentation, wrong claimed lines, unsafe/invalid labels,
zero/unsafe/repeated/reversed line numbers, explicit-locator precedence,
incomplete fences, and patch/shell exclusions.

Live Pass on the rebuilt local Extension Development Host: reloading the original
saved response displays `.gitignore:3` with `packages/prisma/generated/types.ts`,
`.gitignore:6` with `node_modules`, and `.dockerignore:4` with `node_modules`.
Clicks on `.gitignore:3` and `.dockerignore:4` open their correct full remote bodies
with the requested source lines selected. Temporary unsaved viewers were closed
without saving. The original saved response was re-rendered; its historical 6s
duration is not a timing measurement of a new answer after this repair.

Local candidate identity: extension source/package 0.1.13 includes unrelated
in-progress support-reporting changes. Bundle SHA256:
`b979f5895f0cdf720354a99c56977b5e599682f7c6ace8ea35f84956716b91fe`;
webview SHA256:
`51cb9d5a5dd81d269ef6f45ae1df89b9e9697ac8d742651dbdbf56c959cbd7ca`.
This live observation closes the screenshot's citation defect on the local
candidate; it does not qualify or deploy the unrelated support-reporting work.

### User fresh Test 3 and shared code styling — October 9, 2026

Jon supplied a fresh 10:42 AM Test 3 response, with a screenshot taken at
11:00:39 AM. Live Pass for this named ask: Documenso/main repo-only, both remote
files read, reported `Worked for 6s`, shared `node_modules` correctly cited at
`.gitignore:6` and `.dockerignore:4`, and gitignore-only `.turbo-cookie` correctly
cited at `.gitignore:36`. A different verified exclusive pattern is valid; the
manual fixture does not require the model to pick a particular example.

Jon then requested source-code blocks match the patch design more closely.
Source cards now use the patch's filename/line-range header layout, shared
code-row grid, gutter alignment, typography, spacing, rounded shell, and theme
surfaces. The shared styles also apply to patch previews. Copy and remote source
navigation retain their existing behavior. Anonymous examples use the same
shared spacing and shell. No retrieval, parser, model, or patch-application
behavior changes are included in this presentation adjustment.

Validation: lint and extension development build pass. In the actual reloaded
Extension Development Host, the original 10:42 AM response shows the refreshed
cards with separate filename and muted L6/L4/L36 metadata; Copy changes to Copied,
and the Docker ignore header opens the remote source with line 4 selected.
The temporary source viewer was closed without saving. The final CSS was rebuilt
and the Host reloaded after the filename font-weight refinement.
