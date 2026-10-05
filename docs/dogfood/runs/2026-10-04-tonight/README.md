# October 4–5 launch checkpoint

Source checkpoint **c4a83a70e677181a74a8094b9a84e902a5314ab6** is committed and pushed to `checkpoint/dogfood-2026-10-03`. This ledger does not certify launch readiness. Plane and Documenso are forked test repositories; the application changes are in Coop AI.

## Completed source work and automated gates

Autocomplete now captures the active repository and branch, partitions cached/in-flight completions, and discards results after a branch switch. Graph fallback requires matching indexed branch provenance and fetches remote snippets at that ref. Current production manifests expose no branch identity, so selected-ref manifest symbol hints are omitted. FIM behavior is unchanged: FIM does not consume graph slices.

Apply/Undo operations serialize per patch record; prompt dialogs contain keyboard focus including owned menus. Trace distinguishes sampled commits from introduction proof and unknown rationale. Ownership separates sampled contributors, declared policy, Slack presence, and response availability. Gaps consumes actual hybrid lightning dependency fields, tested from the real producer through final enrichment. Gaps starts explicit remote reads before scan budget exhaustion, preserves exact code citations, treats empty matches as coverage limits, and retains normalized dependency evidence through artifact hydration. Import-only named-symbol Blast returns a short honest answer before calling the model; verified symbol evidence retains the existing synthesis path.

Full `test:ci`, lint, backend build, and extension packaging passed. Focused checks include Apply races 19/19, prompt focus 11/11, ownership 15/15, Blast 19/19, router 24/24, autocomplete provider 7/7, graph 9/9, final chat enrichment 18/18, bundle extraction 10/10, and early Blast completion/Stop/artifact checks. See evidence/final-freeze-*.log and agent assessments.

Final bundle SHA256: `a95c0b3aef3ca972b350defa8c254fff66199a0ef814523d8794e0d694c72bf9`. VSIX SHA256: `14f42d6ad3e8c3f28932571f03118f0ee5984230388c080b6fb814884f73980f`. Installed into the existing disposable profile, which was reopened after the computer resumed on October 5. Correct remote renamed-oracle bytes were fetched again. No local repository clone qualifies any intelligence check.

## Production deployment

The first final upload (`b26a1f53-c7ea-4ccf-ba31-16b5e3c2c969`, source `0d0f678`) failed before building: Railway reported “Failed to snapshot repository.” The approved retry is `fa74a66c-80d9-447f-9ff1-d4b94053dd2d`, source `c4a83a7`, manifest SHA256 `af144e74034bd116cdba2bdca1bb183d875f60af4a06837506cdecf8220ea517`. The retry succeeded. Current production API is `c4a83a7`, deployment `fa74a66c-80d9-447f-9ff1-d4b94053dd2d`, Railway image digest `sha256:aec1ea7e78da4fd47e1174c2257491d7d14b9bab01404c73a45b524ae1e3da48`; public health is ok. Previous successful checkpoint `c1f886e` is preserved as deployment evidence. Public health reports commit unknown, so revision proof requires Railway upload metadata and image digest. No Stripe variables or migration files changed.

Earlier successful deployments and their image/upload evidence are preserved in deployment-b5db50c.json, deployment-a0ff096.json, deployment-a92bde8.json, and deployment-c1f886e.json.

## Live evidence and claim limits

Initial evening candidate: basic cube completion accepted with Tab, nested modal/menu keyboard containment, repeated Apply changing one loop bound, and Undo restoring exact fixture bytes passed. Those screenshots remain historical; later candidates do not inherit all live passes.

Trace a92bde8: seed commit 3d1507d correctly identified; independent remote oracle proves the function was added there. Rationale and current responsibility stayed unknown. Narrow provenance pass; broader historical coverage remains unverified.

Blast aa5fff9: completed answer retained the file dependency while marking named-symbol use, behavioral impact, and coverage unverified. Transient model prose was weaker before final enrichment; 0d0f678 removes that model stream for trusted import-only named-symbol evidence. Candidate 345029b live early-answer retest passed in 12 seconds without speculative model streaming (live/blast-345-early.jpg); narrow import-only scenario only.

Ownership 2e738b4: sampled authorship and availability wording passed, but an unmatched CODEOWNERS result was overstated as absence. The contradictory prompt instruction is corrected in 0d0f678. Candidate c4a83a7 / deployed API c4a83a7 passed the targeted live retest in 31 seconds: missing policy matches are unverified, sampled authorship is scoped, and Slack presence does not establish response availability (live/owner-c4-final.jpg).

Gaps 2e738b4: conditional finding, exact source citation, and absence guards passed. Final recommendation guard missed normalized hydrated graph evidence; extraction is corrected and covered by a production-shaped hot-path regression in 0d0f678. Candidate c4a83a7 on healthy API c1f886e completed in 40 seconds with exact remote citation, conditional contract, unverified caller impact, and policy-coverage limits (live/gaps-c4-final.jpg). The real hybrid producer → extractor → final guard regression passes. Candidate c4a83a7 / API c4a83a7 repeated the targeted final-answer live pass in 32 seconds (live/gaps-c4-deployed-final.jpg). These screenshots do not independently prove deterministic recommendation-guard execution; that runtime-path qualification remains open.

See workflow-retest-assessment.json and live screenshots for the exact earlier candidates and failures. Total workflow durations of 23–35 seconds do not measure first-answer latency.

## Remaining gates

1. Final API deployment and targeted Ownership/Gaps retests succeeded. Broader affected live scenarios and independent runtime qualification of the Gaps recommendation guard remain open.
2. Live production Free/paid quota boundaries, separate-organization isolation, denied access, and revocation need distinct authenticated accounts/fixtures. Disposable API checks passed but do not qualify Extension Host scenarios. Normal sign-in may require Jon; do not weaken authentication or silently expand grants.
3. Stripe test-mode end-to-end was deferred until October 5 and remains open. No billing live pass is claimed.
4. Broader current-candidate branch-switch, multi-file edit race, and first-answer latency qualification remain open. Automated branch/race passes are not live product passes. Graph-grounded FIM completion is not implemented and must not be claimed.

The next session should start from this branch and evidence and use the disposable profile. Do not repeat completed targeted checks without a new change or failure. Do not change Plane/Documenso as application source.
