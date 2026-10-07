# QA lane A — current routing, attachment handoff, and latency audit

Date: 2026-10-05 America/Los_Angeles  
Lane: QA lane A; read-only source audit and isolated tests  
Source snapshot: `bf8dc0dc25cf998cd68b556e0dbede7af7bc812c` (worktree contains unrelated user changes)  
Overall: **UNQUALIFIED**. Automated routing/state checks pass; live attachment matrix and current-candidate latency retest are **NOT_RUN/BLOCKED**.

## Observed facts

- Historical diagnostic evidence for candidate `57a1070` records a body-bearing remote attachment (`HostTextMonitor.swift`, 5305 chars) followed by an agent-owned path that planned `search_confluence`, then `search_notion` and `search_google_docs`, while the answer still denied access to the file. This is a confirmed unnecessary-search and handoff failure for that candidate: `docs/dogfood/runs/2026-10-05-agent-followup/evidence/strata-diagnostic-reproduction.json`.
- Historical repaired-candidate evidence (`314db4c`, bundle `2573ac8d…`) records body present at attachment capture and in the serialized final request, with useful Strata initial/follow-up answers and citation navigation. First meaningful answer starts were 20.825s and 24.729s for Strata and 31.237s for the TypeScript control: **FAIL latency** against the 15s soft start guideline. This is a candidate-scoped live result, not a current-source qualification: `docs/dogfood/runs/2026-10-05-agent-followup/evidence/attached-body-fix-live.json`.
- Current source suppresses integration auto-fetch for outside-workspace/file-assistant targets and only enables repo-wide/Trace integration policy for explicit quick actions (`src/context/integrationFetchPolicy.ts:48-83`). Current source also passes only planned integrations to the agent loop (`src/chat/agentRouting.ts:175-184`), rather than the full connected list.
- Current `runIntentFetch` starts base context requests and integration enrichment in parallel when the planner has no locate job, then merges results into the turn bundle with isolation (`src/chat/CoopChatSession.ts:3250-3295`, `3351-3360`). The agent-owned path passes `capturedAttachment` into the orchestrator and streams the final answer through the serialized prompt path (`src/chat/CoopChatSession.ts:5139-5216`). This is source evidence of a repair boundary, not proof that every attachment producer populates it.
- Integration enrichment is explicitly budgeted when applicable and marks timed-out/skipped searches, but it still runs all enabled job-scoped providers in parallel when the plan names them (`src/context/integrationChatEnrichment.ts:218-271`, `360-530`). No current live trace proves the Swift ask is now classified without unrelated providers.

## Status by behavior

| Area | Status | Evidence |
|---|---|---|
| Unnecessary integration searches on escaped Swift ask | **FAIL** on candidate `57a1070`; **NOT_RUN** on current source | Historical diagnostic trace above; no current Extension Host trace |
| Planner → gather → synthesis attachment handoff | **Automated Pass / live not current** | Current source path above; `attachmentDiagnostics.test.ts` passed; repaired-candidate live evidence is historical |
| First meaningful text <=15s | **FAIL** on repaired live candidate; **NOT_RUN** current candidate | `attached-body-fix-live.json` timings; no new timing run |
| Swift initial/follow-up, body-backed answer | **PASS** on repaired candidate; **NOT_RUN** current candidate | Historical exact asks only |
| TypeScript control | **PASS** on repaired candidate; **NOT_RUN** current candidate | Historical control only |
| Selection vs full-body semantics | **Automated partial / live NOT_RUN** | `sessionMode.test.ts` and source inspection; no live selection/full-body pair |
| Repo/ref/thread switching and fresh-chat isolation | **Automated partial / live NOT_RUN** | `newWindowContext.test.ts`, `sessionMode.test.ts`; no live switching matrix |
| Reload persistence | **NOT_RUN/BLOCKED** | Handoff says remote Untitled reload converted to Local; no qualified retest |
| Citation rendering/navigation | **PASS** on repaired candidate; **NOT_RUN** current candidate | Historical citation-open event; no current UI proof |
| Inaccessible/denied source | **NOT_RUN** | No current live/API fixture result in this lane |
| Cleared attachment / stale chip | **Automated partial / live NOT_RUN** | `sessionMode.test.ts`; no live chip-clear retest |
| Stop during planning/gather/stream and next-send recovery | **Automated partial / live NOT_RUN** | Front-door Stop test passed; no live cancellation trace |

## Tests run

All commands were read-only and did not rebuild, install, deploy, or edit implementation source.

- **PASS** `npx --yes tsx src/context/integrationFetchPolicy.test.ts` — 25/25. Covers ordinary/file-assistant/external suppression, explicit slash behavior, quick actions, and incident-shaped routing.
- **PASS** `npx --yes tsx src/chat/intentPlanner/frontDoor.gates.test.ts` — 22/22. Covers planner handoff, provider scoping, and Stop during intent planning.
- **PASS** `npx --yes tsx src/chat/agentRouting.test.ts` — 28/28. Covers file-assistant no-loop behavior, named-tool scoping, and repo-tool gating.
- **PASS** `npx --yes tsx src/chat/attachmentDiagnostics.test.ts` — metadata/hash/serialized/empty safety assertions.
- **PASS** `npx --yes tsx src/context/sessionMode.test.ts` — 7/7. Covers editor/source classification, fresh-chat focus, phantom tabs, and L/R planner behavior.
- **PASS** `npx --yes tsx src/context/newWindowContext.test.ts` — 3/3. Covers fresh window and Use-repo chip clearing.
- **PASS** `npx --yes tsx src/chat/plainChatMustNotPromote.test.ts` — 16/16. Covers plain English not becoming explicit workflows.
- **PASS** `npx --yes tsx src/chat/intentPlanner/phase4.gates.test.ts` — 9/9. Covers job scoping and named-provider planning.
- **BLOCKED** `npx --yes tsx src/context/intentDetector.requestTypes.test.ts` — plain Node test cannot resolve `vscode`; no result claimed.

## Hypotheses, clearly separate

1. The historical unnecessary searches were caused by the earlier agent-owned route receiving only an open-file label while the captured body was not carried into planner/final synthesis. The diagnostic trace supports this boundary; it does not prove the original producer or fetch cause.
2. Current source may still have an attachment-mode gap because `capturedAttachment` is populated only when a remote `editAnchor` has retrievable body content (`CoopChatSession.ts:5146-5154`). Whether local/external, selection, reload-restored, or cleared-chip paths populate equivalent evidence is unverified.
3. The remaining latency likely includes planner/gather/agent handoff and model time; the available evidence does not isolate native paint versus first provider delta for the current source. Do not treat this as a causal diagnosis.

## Minimal owner / retest

Owner: original implementation/build lane. Freeze and identify the exact installed bundle, then rerun one clean Extension Host matrix: Swift remote full body initial + follow-up, TypeScript control, selected lines, repo/ref switch, fresh chat, reload, citation open, inaccessible/cleared chip, Stop during gather and next send. Capture safe stage timings for capture, planner, gather start/end, synthesis handoff, first provider delta, first visible useful text, and final completion. The retest must demonstrate that an attached-source ask does not invoke unrelated integration searches and must preserve body/provenance through the final serialized request. Do not call current behavior live-qualified until this exact candidate run exists.

