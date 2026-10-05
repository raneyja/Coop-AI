# Autocomplete selected-branch isolation

Source qualification: automated pass; current packaged/live branch-switch qualification remains open.

The active session now supplies selected branch with repository identity. Router cache, in-flight reuse and manifest-symbol cache are partitioned by branch. Provider pending results are rejected after a branch switch, including the same repository and unchanged buffer. Both inline backend client payloads and the API carry the optional branch. Existing clients without a branch remain compatible.

Manifest symbols are omitted when the fetched manifest does not identify the selected branch. Graph slices check the existing `getFileTree` result's `indexedBranch` (produced by `GraphCache.getFileTree` from graph metadata); missing or mismatched provenance degrades without using graph edges or fetching dependency bodies. Matching graph slices pass the selected branch into the existing codehost fetcher's `RepoCoordinates`. The branch proof shares the existing graph deadline. No inventory source ordering, local repository reads, model assignment, or FIM graph behavior changed. Production FIM still skips graph context; this does not qualify graph-grounded FIM generation.

Focused commands, each exit 0:

Follow-up type repair: combined lint exposed a missing client return declaration for optional manifest branch. `CoopBackendClient.fetchRepoManifest` now declares the optional field, inherited by the delegating `SecureApiClient`. Actual production `orgApi.handleGetRepoManifest` emits no branch, so selected-ref manifest symbol hints are deliberately unavailable today. The matching-ref regression proves conditional behavior only; it does not claim production branch provenance.

- `npx --yes tsx src/autocomplete/completionRouter.test.ts`: 24 passed, 0 failed. Includes concurrent same-buffer branch requests, separate cached responses, missing/mismatched manifest ref omission, and matching-ref symbols.
- `npx --yes tsx src/autocomplete/coopAutocompleteProvider.test.ts`: 7 passed, 0 failed. Includes pending same-repository branch switch rejection and preserved repository-switch rejection.
- `npx --yes tsx src/api/inlineGraphContext.test.ts`: 9/9. Includes selected-ref propagation and mismatched index rejection before snippet retrieval.

These source changes invalidate inherited candidate qualification. Parent owns combined lint/CI/backend build/package and live retests. Exact next live check: keep the same repository and completion buffer, request a completion on `main`, switch Use repo to `renamed` while the request is pending, and confirm the old result never appears; request again and accept only the new branch response. This check proves isolation, not FIM repository grounding. Graph context needs a non-FIM assigned route and a graph whose `indexedBranch` matches the selected ref; otherwise degraded context is the expected result.
