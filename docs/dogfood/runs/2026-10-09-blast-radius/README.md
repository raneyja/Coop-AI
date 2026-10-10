# Blast Radius — general source and evidence policy

**Automated Pass for the current policy implementation.** Jon's corrected scope is reusable rules and enforcement on the actual product path. Named repositories, files, questions and successful example replays are not the completion standard.

The repo-specific AST predicate answer replacement, enum anchoring, guessed module resolution and behavioral prose filters have been withdrawn. The current implementation uses the original task and bounded remote evidence, one normal synthesis, and at most one replacement repair for objectively incomplete output or invalid source quotations.

## Rules enforced on the product path

- **Keep the task and scope.** Preserve the original question, selected remote repo/ref, history, model/provider, thinking setting and quota controls through synthesis and repair. A selected file or range does not imply a proposed change.
- **Use bounded remote evidence.** `IndexedRepoWorkspace.readFile` supplies one target and up to three dependent source bodies, capped at 32,000 characters per body. Admission checks remote origin, repo identity and the requested path. Completed reads survive the soft gather budget; Stop releases pending gathering. The frozen turn retains those bodies and avoids repeat background gathering.
- **Separate relationships from behavior.** Graph edges and identifier occurrences identify files to inspect. They do not resolve symbol binding, establish reachability, prove behavioral impact, or imply complete dependency coverage. Unopened helpers, truncated portions and absent dependent evidence remain unknown. Thin evidence produces a short, honest answer.
- **Preserve exact quotations.** The shared quote owner checks contiguous original bytes and explicit coordinates, including comments, whitespace, blank lines and CRLF. A correct claimed range wins among repeated spans; coordinate repair requires a unique exact span. Ambiguous, altered, malformed and unopened-source quotes are rejected. Anonymous examples remain anonymous.
- **Enforce the same rule through publication and display.** Final publication rechecks the captured windows without rereading remote files and rejects altered, downgraded or removed validated quotes. Explicit citation mode survives local history and sync metadata. The renderer and Copy use the shared fence parser, preserve quoted code and fence delimiters, and avoid inventing provenance from the active file.
- **Keep Stop and cost truthful.** Stop prevents another model call and publication. Each actual model phase reports its duration and returned usage. Completed costs are retained on failure or Stop. Missing usage stays unavailable; differing actual models are reported separately instead of as a misleading total.

Behavioral assertions are constrained by the source policy prompt: use actual conditions, exits, call sites, exception branches and enclosing operations; distinguish observed facts from conditional inferences and questions. Exact quotation validation does **not** mechanically certify the semantic correctness of the model's prose.

## Owners and validation

`sourceCitationIntegrity.ts` owns exact quotation validation; `markdownProse.ts` owns fence boundaries. `blastRadiusSourceEvidence.ts` owns remote admission and captured bodies; `streamSourceGroundedBlast` in `blastRadiusSourceReview.ts` owns synthesis, objective repair, Stop and usage. `CoopChatSession.finishTurnAssistantMessage` owns the final publication check. The shared renderer and Copy consume the persisted explicit citation mode.

The [current validation record](evidence/policy-validation.json) records passing Blast tests, prompt/provider routing checks, renderer/Copy checks, lint and the isolated extension/webview build. Generic and adversarial cases cover multiple source languages, repeated excerpts, literal/comment/indentation changes, long and tilde fences, CRLF, wrong remote identity/path, pending Stop, failed repair, missing/mixed usage, final mutation or citation removal, history restore and anonymous examples.

The [frozen candidate manifest](evidence/policy-candidate-freeze.json) identifies the private snapshot at `/private/tmp/coop-blast-policy-candidate-20261009`, source hashes and both bundle source maps. The extension is **3,439,606 bytes** and contains no TypeScript compiler or withdrawn predicate-proof module. This is a static bundle measurement, not a startup or end-to-end performance benchmark. The snapshot qualifies the Blast-owned and shared dependencies recorded in the manifest; concurrent Knowledge Gaps-specific work has its own candidate and report.

Passing command logs: [Blast tests](evidence/policy-blast-tests.log), [lint](evidence/policy-lint.log), [isolated build](evidence/policy-isolated-build.log). The full shared-checkout CI suite was not run.

## Current limits and historical evidence

This candidate has **not** been loaded into Extension Host or deployed to the backend. Automated Pass does not establish live Pass, arbitrary behavioral correctness, complete repo coverage, or a general 15-second start-answering result. The prompt change requires a future backend deployment to reach the hosted model path. No new deployment, commit, push, shared-dist build or fixture replay was performed during this policy correction.

The complete [earlier closeout](evidence/historical-ast-closeout.md), [qualification history](evidence/qualification-history.md), [old live results](evidence/final-live-results.json), [old candidate identity](evidence/candidate-freeze.json) and raw thread/source artifacts remain intact. They describe earlier implementations and examples. The AST experiment and its fast Documenso timings are withdrawn as the product architecture and completion criterion; its bundle `ac7ff0c94bfe` is not this candidate. The preserved Plane example started after **121.198 seconds**, a latency Fail. Historical source checks remain evidence for their recorded clients and refs, not a qualification of the current policy candidate.

The last recorded production deployment was `b09b8776-0341-40bd-b026-fefc67aa3646`, preserving the previously approved Blast prompt revision. That historical record is not a fresh check of production or a claim that the current policy prompt is deployed.
