# Historical closeout — AST experiment withdrawn

This is the unchanged earlier report, preserved for its recorded clients and refs. Its implementation and fast fixture timings are withdrawn as the current product architecture and completion criterion. See the parent README for the current general-policy implementation, Automated Pass and limits.

---

# Blast Radius — Test 5 source grounding

**Live source-grounding Pass on the four named cases. Both anchored Documenso cases now pass the 15-second start-answering guideline; preserved Plane latency remains a Fail.** This qualifies the shown sources, conditions, and citations; it does not establish complete caller coverage or unread helper/authentication/storage policy.

The approved Blast backend prompt patch was deployed. Stable production deployment `b09b8776-0341-40bd-b026-fefc67aa3646` preserves Blast revision 2 from `efe257d9-6c9c-469c-af6c-b1eed85c5678`. Both final Documenso latency replays used isolated client `ac7ff0c94bfe1c1bbf3d3e4076d2c7fe718f60a8ccad21897abf4eb625327377`. Plane and thin-control passes are preserved with their actual client identities below; they are not represented as fresh final-client runs.

[Final machine-readable qualification](evidence/final-live-results.json) records asks, initial selection, source hashes, exact excerpts, source cards, native opens, usage, and timing basis. [Candidate identity](evidence/candidate-freeze.json) records bundled source hashes and the isolated runtime path.

## What changed

Blast gathers the full remote target and a bounded set of actual dependent bodies through `IndexedRepoWorkspace`, keeps completed reads within the gather budget, and retains those bodies in the turn's Sources artifact. A selected range focuses the question while the full target stays available for later guards and writes. Graph relationships identify candidates; they do not establish caller behavior. Source gathering is owned by the frozen turn and is not repeated by the background job path.

Source-backed drafts stay private until checked. Citation checking replaces harmless reformatted excerpts with the actual opened bytes and correct line ranges; changed operators/literals, unopened paths, and invalid quotes cannot become source proof. Strong evidence requires complete opened target/caller bodies, while dependency coverage stays unknown.

Prompt changes and a second model review still produced unsupported behavioral claims in Documenso. For parseable JS/TS predicate changes with verified named imported calls, Blast now derives the published answer's call paths, full boolean conditions, helper calls, and conditional write enclosures from the opened syntax tree. The original selected lines have priority. An explicit unique enum member in the original question can anchor a whole-file predicate when the model omits that citation. When the original selection/question already identifies the predicate, this same verified explanation publishes before any synthesis model request. It creates no model token/cost usage. Ambiguous or unsupported input uses the private source-review path. Incomplete reviews receive one full-source replacement and never publish a generic continuation or an unchecked draft.

The source-derived explanation names actual flow functions, describes conditional impact, preserves remaining guards and separate create/update payloads, and gives tests for newly admitted values and conditional writes. It proves shown syntax/control enclosure, not complete reachability or dataflow. It explicitly leaves helper internals, access policy, stored invariants, inevitable writes, and additional callers unverified.

Source artifacts survive thread persistence/background completion. Native citation opens use the selected remote ref and do not stamp a caller's selected range onto the preserved target context. All other concurrent work in the shared checkout is preserved. No commit, push, PR, or Marketplace publication was performed.

## Live qualification

- **Documenso whole file — source grounding, utility, and start latency Pass.** `thread-1791600959699-4o4a89`, client `ac7ff0c94bfe`, `main`, full `packages/lib/server-only/field/sign-field-with-token.ts`, no initial selection. All three complete bodies match the independent snapshots. All 19 numeric excerpts are exact. Native guard L108–110, router caller L615–633, and target write L236–255 open at `main`. Sources are retained. The answer is byte-identical to the earlier source-qualified explanation. First answer **4.201s**, client completion **4.735s**, down from **52.051s / 52.547s**. The source proof publishes before the synthesis model; session model cost is zero.
- **Documenso selected guard — source grounding, utility, and start latency Pass.** `thread-1791601054095-o2fcky`, client `ac7ff0c94bfe`, `main`, frozen L108–110, full target retained. All three bodies and 11 numeric excerpts remain exact. Native guard L108–110, multi-sign caller L18–98, and conditional writes L236–312 open highlighted at `main`. Complete caller exits, target guards, helper uncertainty, and create/update branches remain. Only the order of the two caller sections differs from the earlier qualified answer, following body-read completion order. First answer **3.141s**, client completion **3.639s**, down from **57.221s / 57.883s**. No synthesis model request or invented model usage.
- **Plane default model manager — preserved Pass.** `thread-1791591217454-f66kd6`, client `e38059412ba5`, `preview`, `apps/api/plane/db/models/state.py`, plus complete `issue.py` and `models/__init__.py`. The answer distinguishes `group` from `is_triage`, seeded sequence values from the actual aggregate, and a re-export from a runtime call. Unread manager behavior stays unknown. Both numeric excerpts are exact; native L119–124 and dependent L228–236 opened at `preview`. First answer **121.198s**. Latency Fail.
- **Thin dependency control — preserved Pass.** `thread-1791591169175-00b87h`, client `e38059412ba5`, `renamed`, `CoopAI-Corp/coop-dogfood-launch/README.md`. One complete target body and its source artifact are retained. No dependent body was verified; the answer is short, reports that limitation, and makes no zero-impact or invented caller claim. First answer **9.262s**. Start-answering guideline Pass.

All **32** numeric excerpts across the qualified cases match the attached full source bodies and independent snapshots. Documenso `main` was rechecked at `a457e1ef7de449e4f758fc6943a8014e952c34c6`; Plane `preview` at `a8e53b6ac7b87bd8e3e931d21188f7679c7ab6c4`.

For the two final Documenso cases, answer-start and `blast-answer-complete` use the same client turn clock. Completion follows `finishTurnAssistantMessage`. Plane and thin predate that completion diagnostic: their historical provider/server timestamp proxies are retained separately in JSON (**132.322s** and **10.182s**), and are not claimed as same-clock UI completion measurements.

## Exact fixture asks

Use the named indexed repo/ref and remote file. Whole-file asks require no selection; the range ask requires exactly L108–110. The source excerpts remain applicable to the selected refs above.

1. Documenso whole file:
   `/blast If this handler allowed signing when the envelope is not PENDING, which callers or signing flows could be affected, and what should I verify before shipping that change?`
2. Documenso selected guard:
   `/blast If this selected PENDING guard were relaxed, which opened callers could reach the changed branch, which checks and write conditions remain, and what should I verify before shipping?`
3. Plane:
   `/blast If this file's default model manager stopped hiding triage states, which server consumers could be affected, and what should I verify before shipping?`
4. Thin control:
   `/blast Which dependent files were verified for a change to this README, and which impact claims remain unverified?`

## Automated verification and practical limits

`npm run test:blast`, `npm run lint`, `npm run build:extension-dev`, and `git diff --check` exited 0. The isolated backend build also exited 0 before deployment. The Blast suite includes nine predicate-proof tests, four exact-source/status guards, seven private-review tests, thirty synthesis checks, bounded remote gathering, source retention, Stop behavior, actual backend routing, and selected-ref citation review. This is not a claim that the full shared-checkout CI suite ran or passed. See [validation](evidence/validation.json), [Blast tests](evidence/blast-tests.log), [lint](evidence/lint.log), and [build](evidence/build.log).

The narrow timing repair removes an unused model draft only when the original selection/question anchors the source proof. The previous Documenso waits between synthesis preparation and proof were **48.375s** and **52.371s**; direct proof takes **19ms** and **6ms** at that same boundary. The source explanation and citation checks are preserved. Plane and ambiguous/unsupported cases still use private model review and are not qualified as meeting the 15-second guideline. See [latency investigation](evidence/latency-investigation.json) and [earlier source-qualified baseline](evidence/source-qualified-slow-baseline.json). The bundled TypeScript parser increases the unminified extension to **13,397,127 bytes** (the build reports 12.8 MiB); its startup overhead was not separately benchmarked. Unsupported languages, unresolved imports, truncated sources, and arbitrary impact questions are not qualified by the JS/TS predicate proof. These limits prevent a broad ship-ready claim. The two anchored Documenso latency fixtures are closed; the preserved Plane latency failure remains visible.

Historical failures remain recorded. The early Documenso runs invented access/status policy, shortened compound guards, flattened catch branches, or returned an incomplete source review. The later `75dea96e4beb` whole-file attempt missed its changed-predicate anchor and failed. A `0bb` attempt that retained the prior range during remote-open suppression was excluded; the counted replay's user bubble and synthesis diagnostics confirm no selection. See [qualification history](evidence/qualification-history.md), [e380 block](evidence/candidate-e380-live-results.json), [b07 failures](evidence/candidate-isolated-b07-live-results.json), [75 results](evidence/candidate-isolated-75-live-results.json), and the raw thread/diagnostic records. Completed historical scope outside Blast was not reopened.
