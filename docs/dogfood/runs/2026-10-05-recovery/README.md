# Recovery QA — 2026-10-05

Status: **UNQUALIFIED**. This is an independent QA run against the preserved dirty checkout; automated results and narrow live results do not certify launch readiness.

## Candidate

- Checkout: `/Users/jonraney/Coop-AI`
- Branch: `checkpoint/dogfood-2026-10-03`
- HEAD at QA start: `36cf801040cf6666c68f93c7cd579802a4ccec43`
- Source candidate: pending dirty follow-up; exact hashes are recorded only after an immutable candidate is exposed by the original implementation owner.
- Backend: production deployment from the handoff (`fa74a66c-80d9-447f-9ff1-d4b94053dd2d`, source `c4a83a7`); matching live source remains to be independently proven.

## Scope

The required suite is the existing 120 scenario/mode rows in `ledger.json`, plus supplemental escaped-file and missing-route coverage in `supplemental-ledger.json`. Priority is the exact Strata `HostTextMonitor.swift` attachment failure, then attached context/routing, edit/autocomplete/state/cancellation, API/tenancy/integrations/billing, and supported surfaces.

## Current work

- Preserve and reproduce the two exact Swift turns before repair.
- Trace attachment identity through fetch, route, bundle, model input, and answer evidence.
- Run isolated source/harness/API checks without touching implementation-owned files or shared build artifacts.
- Keep live Extension Host work blocked until the serialized UI owner is recorded and the intended profile/repository/candidate are verified.

## Readiness rule

Any mandatory `FAIL`, `BLOCKED`, or `NOT_RUN`, stale-candidate result, missing evidence, or unresolved escaped incident keeps this run unqualified. Automated green is recorded as an Automated Pass only; live claims require the named Extension Host check on the exact candidate.

See [coordination](coordination.md), [ledger.json](ledger.json), and [supplemental-ledger.json](supplemental-ledger.json).
