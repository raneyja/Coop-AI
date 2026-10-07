# Independent recovery assessment

Date: 2026-10-05 America/Los_Angeles

## Verdict

**Launch readiness: NO — UNQUALIFIED.** Automated and sandbox gates are now substantially green, but the exact live session has not been reproduced across a verified Extension Host matrix, and production revision matching remains unavailable. The 120-row application ledger still contains 120 `NOT_RUN` rows; this assessment does not convert source or sandbox evidence into live product qualification.

## Evidence-backed findings

## Current continuation update — 2026-10-05

The preserved checkout now has current focused automated evidence beyond the
initial ledger snapshot: attachment diagnostics 1/1, response-deadline 12/12,
Apply/Undo phase-B 26/26, Understand grounding 15/15, autocomplete routing
24/24, autocomplete provider state 7/7, phase-E 9/9, agent phase-A 9/9,
integration mid-loop 16/16, and website checkout route tests 2/2. Root lint,
the extension/webview build, website TypeScript, website production build, and
`git diff --check` also pass. Full details are in
`evidence/current-focused-tests-2026-10-05.md`. The Phase-A agent-shipping
suite also passes, including AgentOrchestrator 97/97 and the enterprise
scorecard 22/22.

Recovery QA also made and verified a minimal website billing repair: checkout
routes now use the production-safe API-base resolver and convert upstream
network failures to bounded 502 JSON responses. This closes the two source
findings recorded by Lane C; it does not prove Vercel configuration or live
billing behavior.

The automated isolation contract is now 7/7 after aligning the stale test
expectation with the intentional org-scoped evidence policy. Base autocomplete
cancellation now links the VS Code token to the request AbortController and is
covered by an 8/8 provider suite. Website checkout route hardening is covered
by 2/2 focused tests. Disposable sandbox smoke, quota, and fault checks pass;
real-provider model validation remains unavailable because that sandbox uses a
mock LLM. The repaired attachment checks still have first meaningful response
timings above the 15-second soft target, but that target is explicitly
deprioritized per the user and is not a release gate here. The broader live
matrix, API revision match, billing/integration, reload/persistence, and
Narrow disposable Extension Host checks now pass for the no-repo guard,
repository selection, same-chat follow-up continuity, reload persistence,
repository switching, and live Stop. The relaunched candidate switched to
`coopai-group/Strata · main`, emitted a repo-bound search turn, and rendered
`Stopped.` after the live cancellation control was clicked, with no late answer
visible afterward.

1. The Strata transcript proves the user-visible answer lacked source body evidence despite the file chip remaining present. It does not identify the failing producer/consumer boundary. No speculative Swift repair was made.
2. Lane A traced the two intended routes and identified the required diagnostic boundary: chip identity, fetch status, body presence/length/hash, route, bundle entry, model input, and final citation/evidence.
3. The prior autocomplete cancellation risk is repaired and covered by the
 current 8/8 provider regression. Live Stop is now a narrow disposable
 Extension Host pass; broader matrix coverage remains open.
4. Lane C could not resolve `api.coop-ai.dev` for `/health` or `/v1/me`; production revision proof is therefore unavailable from this environment. Source-level tenancy, quota, billing, integration, and surface paths are not live acceptance evidence.
5. Current full CI, lint, extension build, website build, and focused suites are green. The canonical public API health endpoint is reachable, but reports an unknown deployed commit, so candidate-to-production revision matching remains unverified.

## Required next gates

- Freeze and expose one immutable extension/webview/VSIX/backend candidate tuple.
- Reproduce both exact Swift turns in the authorized disposable Extension Host
  and collect safe boundary diagnostics; repository switching and live Stop
  already have narrow live passes in this run.
- Assign the observed defect to an implementation owner, add a real producer/consumer regression, rebuild/reload the exact candidate, and rerun the incident plus nearby negative/switch/Stop cases.
- Resolve the live API DNS/revision-proof blocker and run the remaining required automated and live matrix rows.
- Keep billing/integration/account work in test mode only and wait for the authorized manual window for any unavailable sign-in or Stripe interaction.

No launch-ready, fixed, or live-Pass claim is supported by this run.
