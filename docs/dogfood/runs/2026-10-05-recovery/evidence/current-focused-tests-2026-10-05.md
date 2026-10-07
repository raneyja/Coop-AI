# Current focused automated checks — 2026-10-05

These results were run against the preserved dirty checkout at HEAD `bf8dc0d`.
They are candidate-local automated evidence only; they do not qualify live UI,
deployed API, billing, integrations, or launch readiness.

## Passes

| Command | Result |
|---|---|
| `npx --yes tsx src/chat/attachmentDiagnostics.test.ts` | 1/1 pass |
| `npx --yes tsx src/config/responseDeadline.test.ts` | 12/12 pass |
| `npx --yes tsx src/edit/phaseB.gates.test.ts` | 26/26 pass |
| `npx --yes tsx src/prompts/repoSummarySynthesis.test.ts` | 15/15 pass |
| `npx --yes tsx src/autocomplete/completionRouter.test.ts` | 24/24 pass |
| `npx --yes tsx src/api/agent/phaseA.gates.test.ts` | 9/9 pass |
| `npx --yes tsx src/api/agent/integrationMidLoop.test.ts` | 16/16 pass |
| `npx --yes tsx src/api/agent/gatherRequest.test.ts` | pass |
| `npx --yes tsx src/autocomplete/coopAutocompleteProvider.test.ts` | 8/8 pass |
| `npx --yes tsx src/autocomplete/phaseE.gates.test.ts` | 9/9 pass |
| `npx --yes tsx src/workspace/turnEvidenceIsolation.test.ts` | 7/7 pass |
| `npx --yes tsx website/src/app/api/checkout/routes.test.ts` | 2/2 pass |
| `npm run test:agent-ship:a` | pass; Phase A gates/pressure, AgentOrchestrator 97/97, retrieval/eval, integration mid-loop, vendor loop, and enterprise scorecard all green |

## Repairs verified

- Base autocomplete cancellation now aborts the underlying request and drops
  late results; the provider regression is 8/8.
- Turn evidence isolation now has a test contract matching the intentional
  provider/org-scoped Slack policy; the suite is 7/7.
- Checkout and checkout-status routes use the production API-base resolver and
  return bounded unavailable responses when the upstream is unreachable; route
  tests are 2/2.

`npx --yes tsx src/api/agent/phaseB.gates.test.ts` was attempted but the path
does not exist. The similarly named edit gate is `src/edit/phaseB.gates.test.ts`
and passed 26/26. The invalid path is a harness bookkeeping issue, not a
product result.

## Additional environment checks

- `npm run test:ci`: exit 0; all serial CI groups passed.
- `npm run lint`: exit 0.
- `npm run build:extension-dev`: exit 0.
- Website TypeScript check and production build: pass.
- Disposable sandbox `smoke`, `quota-smoke`, and `fault-check`: pass.
- Disposable sandbox `model-smoke`: the sandbox is configured with a mock LLM,
  so real-provider model validation remains unavailable here.
- Canonical public hosts are reachable, including `GET https://api.coop-ai.dev/health`
  returning `ok: true`; the deployed commit is `unknown`, so revision matching
  remains unavailable.
- Candidate extension hash `2573ac8d4d87bae3d2811eb1ddd14237d22436d3dd5fbe07f2c4a093513a6c2a`
  matches the installed disposable-profile extension byte-for-byte.

## Additional disposable Extension Host checks

- No-repository guard: **PASS**. The chat explicitly asked for a repository
  before attempting repository inspection.
- Coop-AI repository selection and initial summary: **PASS**. The selected
  chip was `coopai-group/Coop-AI · main`, and the answer returned repository
  citations.
- Same-chat repository follow-up: **PASS**. A follow-up preserved the repo
  context and cited `admin/src/app/(admin)/users/page.tsx` with grounded user
  and invite behavior.
- Webview reload/persistence: **PASS (narrow)**. Reloading the disposable
  VS Code window left the chat transcript and repository context visible.
- Repository switching: **PASS**. In the relaunched disposable Extension Host,
  the repository picker was opened, filtered to `Strata`, and selected
  `coopai-group/Strata · main`. The active chat showed that repository chip and
  the remote tree switched to the Strata file inventory.
- Switched-repository request: **PASS for context attachment**. A follow-up
  request was emitted with `repo: coopai-group/Strata · branch: main` in the
  user turn and entered repository search. The request was then intentionally
  stopped before a grounded answer was produced.
- Live Stop: **PASS**. While the switched-repository search was active, the
  live Stop control was clicked and the chat rendered `Stopped.`; the activity
  controls disappeared and no late answer appeared afterward.

The broader agent-shipping suite was also attempted, but this checkout has no
local `tsx` binary and the environment could not resolve `registry.npmjs.org`;
that run is an environment block, not a product failure.

## Remaining gates

The current focused passes do not establish exact
attachment matrix coverage, native Extension Host behavior beyond the narrow
checks above,
production revision matching, tenant/quota isolation in a live environment,
billing/integration behavior, or an immutable candidate tuple.

Per the user’s direction, the 15-second first-answer target is explicitly
deprioritized and is not a release gate for this pass.

## Full suite

`npm run test:ci` passed with exit 0 after one retry with network access. The
first sandboxed attempt stopped before the first test because npm could not
resolve `registry.npmjs.org`; that is an environment limitation, not a test
failure. The successful run covered all serial CI groups, including marketplace
listing, chat/routing, indexed workspace, attachment diagnostics, autocomplete,
billing, tenancy/operator, reject-hunt, Apply/Undo, integrations, auth, patch,
prompt library, and decision provenance.
