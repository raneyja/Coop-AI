# Recovery QA coordination

Last updated: 2026-10-05 America/Los_Angeles

## Ownership

| Area | Owner | Status | Boundary |
|---|---|---|---|
| Candidate metadata, ledger integration, final assessment | Recovery QA coordinator | ACTIVE | May record evidence and aggregate; does not mutate implementation-owned source or dist |
| Pending production fixes, packaging, commit/push, deployment | Original implementation chat | ACTIVE | Exclusive owner of source repair and candidate mutations |
| Attached-context/routing QA | QA lane A | COMPLETE — FAIL/NOT_RUN | Read-only diagnosis recorded; escaped available-file workflow remains failed and exact live reproduction is blocked |
| Editing/autocomplete/state/cancellation QA | QA lane B | COMPLETE — automated repair verified | Base autocomplete cancellation now aborts the underlying request; provider suite 8/8; live Extension Host behavior remains open |
| API/tenancy/integrations/billing/surfaces QA | QA lane C | COMPLETE — source/sandbox verified | Billing route repair, sandbox smoke/quota/fault checks, and public host reachability pass; deployed revision and real-provider billing/integration behavior remain open |
| Native VS Code / Extension Host | Original implementation chat released ownership | AVAILABLE — assign next serialized owner | Three repaired attachment checks complete in window5 (now Untitled-8); original Strata window6 untouched; verify profile, repo, ref, candidate before next actions |
| Website billing route hardening | Recovery QA coordinator | COMPLETE — focused repair verified | `website/src/app/api/checkout/route.ts`, `website/src/app/api/checkout-status/route.ts`, and focused route tests; no shared UI/install/deploy mutation |

## Candidate protection

The checkout contains unrelated dirty changes and implementation-owned pending changes. No reset, stash, branch switch, delete, reinstall, deploy, shared `dist` rebuild, or speculative Swift repair is permitted from this QA lane. Agents write only under this run's `findings/` and `evidence/` directories unless a test command creates its own isolated temporary output.

The pending patch under `docs/dogfood/runs/2026-10-05-agent-followup/evidence/` is a backup/review artifact, not an apply target.

## Live UI protocol

Original implementation chat owns serialized live UI for this diagnostic reproduction after user requested proceed. The disposable profile is `/private/tmp/coop-dogfood-clean-20261004/user` with extensions at `/private/tmp/coop-dogfood-clean-20261004/extensions`; selected window5 (Untitled-4). Before any UI action, record window/profile, repository, branch/ref, installed bundle/VSIX hash, and relinquish ownership if the user changes the foreground session. QA lanes must not concurrently control VS Code. Diagnostic candidate source57a1070 is recorded in ../2026-10-05-agent-followup/evidence/attachment-diagnostics-candidate.json; installation/reload verification is in progress, no live Pass yet.

Subsequent handoff: diagnostic candidate reproduced both Strata failures and a TypeScript control failure despite captured bodies. Repair source314db4c now has targeted and full-CI Automated Pass plus narrow body-availability live Pass for those three asks and citation navigation. Exact candidate/events/timings: ../2026-10-05-agent-followup/evidence/attached-body-fix-live.json. Installed bundle2573ac8d4d87bae3d2811eb1ddd14237d22436d3dd5fbe07f2c4a093513a6c2a. Backend remains c4a83a7. Implementation releases native UI ownership after this retest; window5 is now Untitled-8, control repo renamed. First-answer latency20.825/24.729/31.237seconds remains open, as do broader matrix and reload/persistence checks. Never promote these three content checks into full release qualification.

## Communication

Agents report through separate findings/evidence files. Do not message other chats, external services, Slack, email, or users. A finding must distinguish observed boundary/cause from hypothesis and name the minimal owner/focused retest.

## Current gate state

- Full application suite: 120 rows remain `NOT_RUN` in `ledger.json`; this is a live/manual coverage ledger, not a CI failure.
- Supplemental recovery coverage: exact Swift incident and missing supported-route checks initialized separately.
- Automated gates: current full `npm run test:ci`, lint, extension build, website checks, and focused repairs pass.
- Current local check: `npm run lint` exit 0 on HEAD `36cf801…`; recorded as a lint/CI gate only, not a product pass.
- Immediate implementation handoff: add safe per-turn attachment diagnostics at `resolveChatLocalFiles` return, post-isolation bundle, serialized `apiMessage`, and final model request; preserve body content itself out of logs.
- Release status: **UNQUALIFIED**. The 15-second latency target is explicitly deprioritized and is not a release gate for this recovery pass.
