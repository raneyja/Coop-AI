# Extension Host dogfood baseline — October 1, 2026

Live UI replay at approximately 7:26–7:29 PM America/Los_Angeles. Tested the existing signed-in Extension Development Host, without rebuilding or reloading. Each question used a fresh chat and explicitly selected `CoopAI-Corp/plane · preview` using the repository context control. The sent messages contained repo and branch context without a file attachment.

## Candidate identity

The visible terminal launch command specified `--extensionDevelopmentPath=/Users/jonraney/.codex/worktrees/repo-research-rebuild/Coop-AI` and that worktree's extension-dev workspace. The on-disk worktree HEAD was `d7aeb7f36f15e8ce119e9ccd3dbd35c44536960f`; the on-disk `dist/extension.js` SHA-256 was `f2a535d238f8b0b89daef1b048d3aad5400650e103b65045baa7390c738423ec`.

These identify the launch path and current disk artifact, not a verified in-memory bundle fingerprint. No runtime fingerprint was exposed or captured. Do not treat this replay as verification of the proposed build, which has not been implemented.

## D1 — Parent rejection

Ask: “A client sent a parent that isn’t in this project — the API returns an error. I don’t have this repo cloned. Where does the API reject a bad parent issue_id?”

Worked for 13s. Expanded activity showed four searches:

- `Parent is not valid issue_id`
- `"parent" "issue_id"`
- `parent_id`
- `"Parent is not valid"`

No visible read activity or attached source. Final response: “I couldn't find where the API rejects that field: the indexed searches yielded no attachable reject snippet, and no opened file confirmed it. I won't guess a path.”

Result: **Fail**. The relevant remote source was not attached.

## D2 — State write and rejection

Ask: “Users can’t move a work item out of backlog — the API returns an error. I don’t have this repo cloned. Where is work-item state written, and what rejects a bad transition?”

Worked for 11s. Expanded activity showed four searches:

- `validate_state`
- `work item state`
- `workitem_state`
- `state_id`

No visible read activity or attached source. Final response was the same rejection-miss text as D1.

Result: **Fail**. Neither the persistence source nor the transition rejection was attached.

## Backend state definition

Ask: “Where do work-item states live in the backend?”

Worked for 29s. While active, the UI reported seven files and seven searches. Search activity included `"work item states"`, `work item states`, `class State`, `State model`, another `class State`, `work item`, and `STATE_GROUPS`.

Visible read activity included `packages/utils/src/work-item/state.ts` (initially skipped as a mention, then listed again twice), three empty-state story files, and `packages/propel/src/input/input.stories.tsx`. Story reads were labeled skipped mentions. The activity count is the product's displayed count, not a count of unique files or successful attached evidence.

Final response: “I couldn't find that in this repo. Try a more specific name, or open the file.” No backend declaration was attached.

Result: **Fail**.

## Conclusion and limits

All three live acceptance asks fail on this existing host. Sign-in and repository selection worked. At the start of the replay, the remote explorer displayed relevant `issue.py` paths, including API/app serializers, for Plane preview; the automated hunt did not attach them.

This establishes the current visible failure baseline. It does not distinguish raw index misses, filtered candidates, provider errors, invisible read attempts, or evidence rejection: no correlated internal diagnostics trace was captured. The next build must preserve this baseline and add stage-level diagnostics plus runtime identity before attributing a root cause or claiming a repair.
