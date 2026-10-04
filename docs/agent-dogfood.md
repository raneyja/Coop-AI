# ICP dogfood — staff engineer Monday

**Primary surface:** Cursor canvas **[ICP dogfood](/Users/jonraney/.cursor/projects/Users-jonraney-Coop-AI/canvases/enterprise-icp-dogfood.canvas.tsx)**.

This markdown is the backup / git copy. Prefer the canvas. Seven jobs. Fresh sheet — last round’s ship probes (locate / Apply / Stop) already Pass. Do not re-run those.

**ICP claim:** zero Fail on E1–E7. One required Fail = not ready for a staff engineer’s Monday.

Do **not** fail for: long-but-correct explain, extra Slack bot noise, citation count, slash vs Workflows, honest “history unavailable” on Trace.

---

## You are the ICP

Staff engineer, 200–2000 person product company. VS Code. Will not clone every service. Slack and Jira are how decisions survive. Plane = a service you don’t own. Coop-AI = your team’s repo.

## Do this first

1. Extension UI — Command Palette → Developer: Reload Window. Success = Coop sidebar comes back.
2. Sign-in still valid. Slack/Jira connected if you have them.
3. Run **E1** on plane, then **E7** (no new send). Then Coop-AI for **E2–E6**.

## The seven jobs

| ID | Job | Fixture | Pass |
|----|-----|---------|------|
| E1 | Onboard without cloning | plane, `/understand` | Real plane subsystems + 5 files. Not a generic template. |
| E7 | Wrong repo never | Score E1 | No Coop-AI paths on plane. |
| E2 | Cover the epic | Coop-AI, COOP-101 | `authMiddleware.ts` + COOP-101. No ticket dump. |
| E3 | Who do I ping? | `authMiddleware.ts`, `/owner` | Owner or CODEOWNERS path + escalation. |
| E4 | What else breaks? | same file, `/blast` | Real dependents (jobs / SAML). Not invented callers. |
| E5 | Why did we decide this? | `responseDeadline.ts`, `/trace` | 15s is soft gather, not abort. Honest “unavailable” is Pass. |
| E6 | Pre-ship blind spots | Coop-AI, `/gaps` | Real hunt-loop / Slack-Jira gaps for a 500-person org. |

Exact asks live on the canvas.

## After

Paste answers on the canvas, mark Completed, then **Ask chat to review**.

**Code host offline round:** Connection checks vs quality backlog live in [code-host-offline-dogfood-notes.md](./code-host-offline-dogfood-notes.md). Do not block connection pass on answer-quality gaps — capture them there for a later pass.

---

## Reject-hunt / locate handoff (plane)

ICP E1–E7 above are unchanged. This appendix is agent locate / write-reject only.

**Claim tiers:** Automated Pass → Ready for Reload (live still open) → Fixed only after live Pass. See `.cursor/rules/ship-claim-discipline.mdc`.

### Do this now

1. Extension UI — Developer: Reload Window
2. Use-repo `CoopAI-Corp/plane` / branch `preview` / **no file chip** / fresh thread
3. Paste exact ask from `src/api/agent/dogfoodContract.ts` (never invent error strings)

| Ask constant | Pass | Fail |
|--------------|------|------|
| `LIVE_PARENT_PASS_ASK` (ship gate) | Cites Parent ValidationError in `serializers/issue.py` | `API_REJECT_HUNT_MISS` / speculative essay |
| `COPILOT_T2_ASK` | Same evidence class (regression) | Canned miss |
| `COPILOT_C2_ASK` | State write-reject attached | Canned miss / UI-only |
| L3 / Tripwire asks | Calm locate — **not** ValidationError-first | Reject scavenger |

`LIVE_PARENT_PASS_ASK` is the only Gate C for Parent reject. Soft T2 is not a substitute.

---

## Three production-readiness probes — Plane + Documenso

Run after the cleanup prompt has landed and the Extension Host has been reloaded. Use three separate fresh chats, no file chip, and explicitly select the connected fork for each repo. These probes target reject evidence, compound write/reject completion, and cross-repo retrieval on a second outside-org fork.

| ID | Repo / branch | Paste exactly | Pass | Fail |
|---|---|---|---|---|
| D1 — Parent reject | `CoopAI-Corp/plane` / `preview` | `In Plane issue create/update, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent isn't in the project. Where is that raised?` | Opens or attaches the server-side raise for the Parent field and identifies the containing code location. Activity includes a read/attachment of useful evidence. | Canned miss, search-only answer, UI/types/migration-only evidence, or invented path/behavior. |
| D2 — Compound state write + reject | `CoopAI-Corp/plane` / `preview` | `Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?` | Identifies both the server state write/update site and the server-side invalid-transition rejection, with opened/attached evidence for both. | Answers with only one half, uses UI-only evidence, returns a generic miss, or claims a transition rule without opened evidence. |
| D3 — Signing status guard | Connected Documenso fork (`coop-ai/documenso` / `main` in the current Bitbucket dogfood setup) | `A signer gets an error that the document must be pending for signing. Where does the server reject this request, and what status check enforces it?` | Finds the server signing path, opens the guard that requires `PENDING`, and reports the actual error evidence from this fork. Does not import Plane or Coop-AI paths. | Search-only answer, unrelated signing/UI/docs evidence presented as the guard, unsupported path/error, or evidence bleed from another repo. |

For every probe, record the final answer and the Extension Host activity counts (searches, reads, attachments), selected repo/branch, and any visible miss or unsupported claim. A correct-looking answer without opened/attached source evidence is **Fail**. These are live checks; automated tests alone do not satisfy them. The Documenso scenario is based on its public server-side signing status guard ([source](https://github.com/documenso/documenso/blob/main/packages/trpc/server/envelope-router/sign-envelope-field.ts)); verify against the selected fork rather than assuming the fork is identical.
