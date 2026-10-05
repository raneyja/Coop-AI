# Coop AI recovery handoff — October 5, 2026

Status: full product reliability is UNQUALIFIED. Recent automated passes and narrow live passes do not certify launch readiness. This is the execution plan for an independent recovery/QA chat running alongside the original implementation chat.

## 1. Objective and user intent

Restore confidence through independently inspected evidence that ordinary engineers can use Coop reliably. Test the complete supported product scope, prioritize fundamental daily workflows, and keep every failure visible. Do not count implementation progress as product acceptance.

The user has allowed autonomous agent work for four days and has lost confidence after an ordinary attached-file question failed twice. They do not want to become the primary QA team. They requested this extensive handoff to a new chat and full testing in parallel with remaining work here. They originally asked not to repair the Swift incident immediately; start with faithful reproduction and diagnosis, rather than silently implementing a speculative fix.

User availability: manual account/Stripe work is deferred until later this afternoon, October 5, America/Los_Angeles. Continue all agent-completable work now. Ask only for concrete unavailable inputs or required interactions. Do not invent extra manual tasks.

## 2. Exact escaped failure — preserve before any repair

Repository: coopai-group/Strata
Branch: main
Attached/open file chip: StrataKeyboard/HostTextMonitor.swift
Exact first ask: "tell me a story about this file. What is it's purpose?"

Reported activity: Worked for 23s, Explored 4 searches:
- Confluence: Host Text Monitor StrataKeyboard file purpose functionality overview
- Confluence: "HostTextMonitor" StrataKeyboard
- Notion: Host Text Monitor
- Google Docs: Host Text Monitor

Reported answer: "I can’t see the contents of the file you’re asking about in the evidence I have for this turn, so I can’t yet tell a truthful story about its purpose or behavior. If you can either open that file in this chat context or paste its contents (or at least the key class/struct/function from it), I can walk through what it does and why it exists, with concrete references back to the real code."

Exact follow-up: "what do you mean? the file was attached"
The same file/repo/branch chip remained present.

Reported activity: Worked for 17s, Explored 4 searches:
- Confluence: StrataKeyboard HostTextMonitor
- Confluence: StrataKeyboard HostTextMonitor.swift
- Notion: file purpose
- Google Docs: file purpose

Reported answer says the model received only a filename, no body, and asks the user to reattach or paste it.

Observed conclusion: the user-visible attachment did not yield source evidence available to the answer. Routing searched connected documentation. Follow-up repeated the failure. This is launch blocking for attached-file comprehension.

Unknown: whether source was never requested, fetch failed, source identity/provenance was rejected, retrieved content was filtered/dropped, or routing selected an inappropriate path. Do not present a root cause before tracing actual events. The user's session/bundle is not yet verified; do not assume it equals our disposable profile.

## 3. Authoritative current state

Repo: /Users/jonraney/Coop-AI
Original chat: 01a103c2-a5ee-71a1-8519-dfceb32b13f7
Recovery QA chat: 01a10cd4-3b51-7710-9791-7cbc90ebae29 (Coop AI recovery and independent product verification)
Original referenced chat: 01a1032d-6440-7e11-96e1-42cf1a33141b
Branch: checkpoint/dogfood-2026-10-03
Committed HEAD: 36cf801040cf6666c68f93c7cd579802a4ccec43 (evidence/docs over source c4a83a7).
Pushed application source: c4a83a70e677181a74a8094b9a84e902a5314ab6.

Production API:
- https://api.coop-ai.dev
- Deployment fa74a66c-80d9-447f-9ff1-d4b94053dd2d, SUCCESS.
- Source c4a83a7; immutable upload manifest af144e74034bd116cdba2bdca1bb183d875f60af4a06837506cdecf8220ea517.
- Railway image sha256:aec1ea7e78da4fd47e1174c2257491d7d14b9bab01404c73a45b524ae1e3da48.
- Public health ok but reports commit unknown. Use upload metadata/image to establish revision.
- No Stripe env changes or migration changes were made in this work.
- One earlier snapshot upload failed before building; the retry succeeded. Do not treat that historical platform failure as a current outage.

Disposable VS Code profile:
- user data /private/tmp/coop-dogfood-clean-20261004/user
- extensions /private/tmp/coop-dogfood-clean-20261004/extensions
- Diagnostics enabled through coopAI.agentDiagnostics.
- Last installed diagnostic bundle ea786e4a720d1509cf81cc479395e31743c484fc94ec072d6d24e6dc7ff60730.
- Last installed diagnostic VSIX 5044f130f72e2be05c1d6e7a7032c9761f20ec90f7502b5352ae14cb649996d4.
- A newer combined package exists on disk and is not yet live qualified. Consult evidence/handoff-candidate.json for its hashes; never equate built, installed, and deployed revisions.

Pending uncommitted source is preserved in runs/2026-10-05-agent-followup/evidence/pending-source-handoff.patch plus hash/paths in handoff-candidate.json. Do not apply the patch on top of the already dirty checkout. It is a backup and review artifact. Preserve unrelated changes in AGENTS.md, .cursor rules, VS Code workspace config, and miscellaneous untracked docs/prompts.

Latest follow-up full CI completed exit0; its log is evidence/handoff-ci.log. Targeted pending-fix passes are listed below. Full CI cannot establish live product reliability. Recheck candidate identity before reusing any result.

## 4. Existing work and explicit limits

Committed repairs include repository/branch isolation for autocomplete caches and pending responses, per-card Apply/Undo serialization, modal focus containment, sampled-history Trace wording, ownership/presence distinctions, early named remote reads for Gaps, preservation of source citations, and an early deterministic import-only Blast answer.

Narrow evidence:
- Ownership c4 extension/API passed policy-coverage/presence distinctions in31s.
- Gaps c4 extension/API produced sound conditional/source-cited final answers in32s.
- Blast early import-only answer on345029b passed in12s without speculative model stream.
- These are named scenarios, not global passes, and final total time is not first-answer time.
- Production manifests currently provide no branch identity. Selected-ref manifest symbol hints are omitted safely; do not claim verified matching-ref manifest symbols in production.
- FIM does not consume graph slices. Do not claim graph-grounded FIM generation or competitor parity.

Current pending implementation owned by original chat:
1. Undo stale-buffer safety: exact post-Apply snapshots; refuse entire Undo if any target differs before dispatch. Preserve current buffers/card/Undo state. Targeted Apply26/26 and pressure7/7 passed. Post-dispatch typing remains outside guarantee.
2. Bounded source-result reasoning policy: complete explicitly named1–2 source files can skip separate thinking; auxiliary README/caller files should not block it; complex/incomplete questions retain reasoning and operator model assignments. Deadline tests12/12 passed. New-package live latency unqualified.
3. Understand contract discipline: function name alone cannot establish a defect; potential bug must state an expected-contract condition. Targeted repo-summary15/15 passed; new-package live answer quality unqualified.
4. Gaps runtime diagnostics: count/source/type only. Live actionEnabled=true, focusBodyCount1, dependencyCount0, bundleEntryCount5, recommendation guard applied=false on diagnostic turn1791215311703-g5zzhl. Saved artifact also has zero dependencies. Assistant mentions src/caller.ts while fresh user message/body do not. Actual dependency carrier versus unsupported model inference remains unresolved. Per-entry shape diagnostics are built but not yet retaken. Do not claim a speculative extractor fix.

Current timing:
- c4 Understand ask returned actual0/0/3 and source citations, but first outgoing meaningful chunk21.745s; synthesis handoff6.780s, thinking enabled. Latency FAIL.
- Diagnostic Plane warm lookup first chunk9.873s; index preview and oracle commit a8e53b6ac7b87bd8e3e931d21188f7679c7ab6c4 match, cached remote serializer read. UI citation/current final-candidate/cold qualification still open.
- Plane/Documenso are forked test repositories. Fix Coop source, not those repositories as application code.

## 5. Ownership and parallel operation

Recovery chat owns independent testing, incident reproduction/diagnosis, scenario completeness, and recovery reports under docs/dogfood/runs/2026-10-05-recovery/. Original chat owns the pending production fixes, packaging, commit/push, and production deployment coordination.

You may use parallel subagents. Start with three independent lanes: attached-context/routing QA; edit/autocomplete/state/cancellation QA; API/tenancy/integration/billing/surface QA. Coordinator owns candidate metadata, integration of evidence, and final assessment. Parallelize read-only analysis and tests whose state is isolated.

Shared checkout rules:
- Do not reset, stash, amend, force-push, change branches, remove files, rebuild shared dist assets, reinstall extensions, or deploy while another lane uses the candidate.
- QA initially reads/tests/reports defects; do not independently edit implementation-owned files.
- Before any repair, put exact reproduction, owning paths, candidate, intended minimal behavior, and focused test plan in the shared findings file. Transfer an explicit file/task ownership in coordination.md before editing.
- Prevent conflicting edits even between subagents. One candidate coordinator owns package/install/deploy mutations.
- Communicate through shared coordination/status files. No external Slack/email messages or automatic cross-chat messages without human authorization.
- Each ledger has one writer; agents write separate evidence/findings files for aggregation.

Live UI is a serialized resource:
- Another Extension Development Host has been actively driving VS Code; native CUA reported user-changed app and foreground switched between our disposable window and a Documenso session. An optional coordination question remains unanswered in the original chat.
- Do not interact with another session or assume an App handle stays on the same Mac window.
- Record intended window/profile, acquire a single live-UI owner in coordination.md, verify title/profile/repo before each operation, and relinquish if the user changes it.
- While unavailable, continue API/harness/build/review work and record live checks BLOCKED. Do not require the founder to perform routine tests that agents can do once UI is free.

## 6. Recovery phases and checkpoints

Phase0 — evidence and immutable candidate:
- Read AGENTS.md and applicable repo rules.
- Inventory the actual product scope from commands, UI routes, feature assignments, backend endpoints, and existing full-application suite.
- Preserve the Swift transcript and source/config diffs before diagnosis.
- Establish installed extension/webview/VSIX hashes, backend revision, source patch hash, OS/editor version, account tier/org, repo/ref/commit/index generation.
- Freeze a named test candidate. Changes invalidate affected qualification; preserve old results historically.

Phase1 — baseline everyday file workflows, highest priority:
- Reproduce both exact Swift asks in the user's route and a clean disposable profile.
- Test a control file in Strata and independently verified TS/Python files in other connected fixtures.
- Trace identity → snapshot → intent/route → remote request → fetch status/body/provenance → bundle → model input → final evidence/citation.
- Inspect safe body presence/length/hash and route/count diagnostics; do not log secrets or whole private source unnecessarily.
- Test chip without body, real remote file, explicit local editor attachment, selection, no chip, stale chip, tab switch, new chat, and Reload.
- Treat a missing-body response as successful failure handling only when fetching is genuinely impossible and the UI accurately explains the limitation. The happy-path attached-file case remains failed until a useful grounded answer arrives.
- Produce a root-cause report with observed boundary and minimal fix proposal. Implement only after ownership is coordinated; user asked first for diagnosis/plan.

Phase2 — complete application matrix in parallel:
- Use the existing76 scenarios /120 scenario-mode rows as a starting contract, not proof of coverage or a substitute for the escaped Swift case.
- Map every supported workflow and UI route to a scenario. Add the new incident and other missing everyday workflows in a supplemental ledger with stable IDs. Do not silently omit modes because they are hard.
- Run safe automation, isolated API/fault fixtures, integration harnesses, and independent source reviews while one owner runs live UI.
- Record every attempt before repairs; preserve failures and skipped/blocked rows.

Phase3 — remediation and causal retest:
- Prioritize P0 data/access/isolation failures and P1 basic context/routing/answer/edit failures; keep lesser wording/cosmetic issues visible separately.
- One failing scenario, one observed cause, one complete minimal fix.
- Add a meaningful regression through the real producer/consumer boundary; avoid tests that merely mirror a helper.
- Rebuild/reload actual candidate, rerun original failing ask, nearby negative/switch/Stop cases, and affected domain checks.
- Independently review result and code path. Repair author is not sole acceptance reviewer.

Phase4 — frozen release qualification:
- Original coordinator builds/installs/deploys the intended candidate, records all identities, and exposes it to QA.
- Run required gates on exact final source and final live matrix. Test the normal distribution path, not only development-host source.
- No launch-ready claim with mandatory FAIL, BLOCKED, NOT_RUN, missing evidence, or stale candidate results.
- A finite suite cannot guarantee all prompts; report scope and residual limits plainly.

## 7. Full product test domains

Attached files and conversational state:
- Remote and explicit local files; Swift/TS/Python; large files and symbols beyond first read window.
- Complete-file versus selection semantics; explanatory language such as "story", "purpose", and "what does this do".
- Both exact incident turns; prior-turn pronouns; new-chat isolation; activation/Reload/history restore; active editor changes.
- Chip/source equality; correct repo/branch; unavailable/denied/deleted file; no pointless docs search replacing source.

Repository intelligence and provenance:
- Plain questions, locate/hunt, compare, inventory, tree, source-body fetch and citation navigation.
- Cold/warm/switch-back; alternate branch, renamed path, fresh index, unavailable index.
- Authoritative totals only; exact matching selected ref; no local-clone intelligence fallback.
- Both halves of compound questions, unsupported premise correction, unknown-symbol honest miss.

Quick actions and integration slash routes:
- Understand, Trace, Owner, Blast, Gaps, /edit; test available button/menu/slash/saved-prompt entry points.
- Actual source facts/contract conditions; sampled history versus introduction/rationale; file edges versus symbol use; policy coverage versus absence; Slack presence versus response availability.
- Slack/Jira/Teams/Confluence/Notion/Google Docs: connected, disconnected, denied scope, stale/revoked connection, empty evidence, wrong-repo data isolation.
- Read-only marker verification. No external messages without explicit authorization.

Editing and cancellation:
- One and multiple files/hunks; preview paths/ranges; Apply-one/remaining/all; double dispatch; Reject/Undo races.
- Stale file before Apply, partial application, missing second target, atomic failure, changes during asynchronous open.
- New stale Undo safeguard; intervening user edits, another card's writes, same-file sequential hunks, refusal preserving all bytes, clean Undo exact originals.
- Stop during retrieval/stream/edit, next successful turn, no delayed canceled-turn mutation.
- Reload/restored-card behavior; no unavailable Undo snapshots presented as executable.

Autocomplete and models:
- Real ghost text and Tab acceptance; enabled/disabled/Reload settings; FIM/non-FIM routes.
- Same repo/buffer branch switch while pending, separate cache/in-flight result, canceled/stale output suppression.
- Graph provenance/selected-ref snippets; missing/mismatched branch degrades truthfully.
- Auto/free/paid catalog rules and operator feature assignments; do not change assignments to make tests pass.
- Explicitly preserve the known unimplemented FIM graph-grounding limitation.

Authentication, tenancy, quota, billing:
- Normal login/logout/session expiration; different-org identities; source grants; denied/revoked repo/integration/admin access.
- Free/paid boundaries, per-account usage, cap enforcement, streaming failures/retries/cancellation billing behavior.
- Stripe test-mode checkout/webhook/entitlement sync, idempotency/duplicates/out-of-order events, cancel/downgrade, customer portal/seat flows as supported.
- Local synthetic API quota/isolation passes are not production end-to-end passes.
- Test mode only. No real charge, live Stripe credential substitution, access expansion, or new production account/grant without required authorization.

Surfaces and operations:
- Extension installation/activation/settings/prompt CRUD/focus/accessibility/responsive sizing and normal error presentation.
- Marketing/pricing/docs navigation; authenticated admin and ops critical flows; canonical coop-ai.dev URLs.
- Backend readiness, deploy revision proof, indexing/search/storage errors, useful diagnostics, recovery after failures.
- Build website/admin/ops for actual release scope; a build pass does not prove portal behavior.

Latency:
- Record first nonblank answer chunk and first visible useful text separately; spinners/activity are not answers.
- 15-second start-answering guideline across supported conversational routes; never terminate or fabricate progress solely to meet it.
- Cold/warm/after-switch and natural-language paraphrases; preserve late-but-correct answers and classify latency separately.
- Distinguish gather, synthesis handoff, model first text, delta batching, native paint, and total duration. Broad reliability is not one fastest sample.

## 8. Acceptance and evidence protocol

Use exact asks and independent source oracles before grading. User-visible purpose claims must follow actual implementation; expected contract/rationale remain unknown unless evidenced. Verify citations open the right file/ref/range. For edits capture exact before/applied/user-modified/Undo bytes and behavioral assertions.

Each attempt must contain:
- scenario and mode, timestamp, source/candidate/backend/fixture identities;
- actual prompt and UI route, account tier/org with no tokens;
- thread/turn/run IDs when available;
- observable source-fetch outcome and body-presence/provenance, route and safe diagnostics;
- first answer/visible timing and final duration;
- actual answer or redacted transcript, screenshot, citation-open proof;
- independent criteria review, failure classification, next action and reviewer.

Keep statuses PASS/FAIL/BLOCKED/NOT_RUN; keep automated and live columns separate. Use repo claim tiers Automated Pass / Ready for Reload / Fixed-live Pass only in their permitted meaning. A clear failed-fetch explanation does not certify the available-file happy path. Do not hide partial results or discard failed attempts.

Initialize existing ledger with node scripts/dogfood-release.mjs init <new-path>. It creates unscored checks; it does not run tests. Use check after recording evidence; it validates completeness, not truth. Supplemental escaped-defect coverage must be reviewed separately. Never manipulate metadata/status to force a green checker.

## 9. Practical execution and founder workload

Start immediately with independent read-only source-path audits and reproducible tests. Prepare the baseline/live queues and fixtures while manual inputs are unavailable. Use the existing disposable environment rather than fabricating production access.

Later this afternoon, request only the exact missing account sign-in, test-mode configuration, or required handoff step, with file/browser/terminal location and add-versus-change instructions. Inspect configured readiness safely first; previous manual steps may already be done. Do not ask the user to reattach the Swift file as the remedy.

Founder final acceptance should be a short normal-use checklist after agent qualification: attached Swift-file explanation, follow-up, switched repository/source citation, edit Apply/Undo/Stop, and account/billing flow if included. Founder acceptance supplements independent QA; it does not replace it.

No promised completion time until fixture/account/UI blockers and scope are measured. Provide concise running/done/blocked updates and counts from real ledger entries. Do not end a turn claiming agents continue if no agents or commands remain active.

## 10. Deliverables and first actions for the new chat

Create under docs/dogfood/runs/2026-10-05-recovery/:
- README.md: current candidate, scope, current work, actual remaining gates.
- coordination.md: file ownership, candidate/build owner, live-UI owner, blockers.
- ledger.json plus supplemental-ledger.json: all required scenario/mode rows and escaped Swift incident.
- findings/: reproduction-first records, severity, candidate, evidence, cause versus hypothesis, owner.
- evidence/: redacted logs, exact test exits, candidate metadata, oracles, screenshots/transcripts.
- final-assessment.md: demonstrated behaviors, failures/blockers, scope exclusions, readiness decision and rationale.

First actions:
1. Read this handoff plus listed rules/evidence and verify actual current git/artifact state.
2. Write coordination.md before dispatching test lanes; original chat retains pending-fix/build ownership.
3. Initialize baseline/supplemental coverage, mark all unexecuted rows accurately.
4. Spawn parallel independent QA lanes as above. They may inspect all supported surfaces; avoid conflicting mutation and native UI.
5. Reproduce/diagnose exact Swift attachment failure as soon as UI/session access can be safely coordinated.
6. Audit and schedule original-chat pending fixes for independent retest.
7. Start agent-completable tests and deliver the first concrete evidence update without waiting for afternoon manual work.

## 11. Read these existing references

- AGENTS.md and applicable .cursor/rules/, especially zero-clone-remote-only, indexed-repo-workspace, evidence-bound-answers, response-latency, ship-claim-discipline, agent-git-workflow, user-instructions, clear-user-requests.
- docs/dogfood/full-application.md, scenarios.json, sandbox.md, remediation-plan.md.
- scripts/dogfood-release.mjs and dogfood-release.test.mjs: completeness semantics.
- docs/dogfood/runs/2026-10-03-continuation/README.md and historical remediation/retrieval runs, without inheriting old passes.
- docs/dogfood/runs/2026-10-04-tonight/README.md and workflow-retest-assessment.json.
- docs/dogfood/runs/2026-10-04-tonight/evidence/gaps-runtime-guard-audit.json.
- docs/dogfood/runs/2026-10-05-agent-followup/ evidence, source patch, candidate metadata, timing/Undo reports.
- docs/agent-dogfood.md; docs/connect-integrations-production.md; docs/deploy-railway.md; enterprise integration onboarding documentation.

The recovery outcome is independently demonstrated reliability within an explicit scope. Honest failures are useful results. A passing compilation, plausible explanation, or polished progress update is not the acceptance criterion.
