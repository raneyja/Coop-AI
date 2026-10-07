# Master handoff — Reject hunt / quarterback gaps

**Date:** 2026-09-29  
**Purpose:** Deep analysis is done. Use this doc to write the **fix prompt** for the next chat. Do not implement from this file alone without reading the five gap plans.  
**Source thread:** [Quarterback agent framework](34a0d4b9-57e3-4251-a107-57b03ab2ed08) + gap analysis chat.

---

## The short version

We cut the early-return into `huntWriteReject`, but live Parent reject on indexed `plane` / `preview` still canned-missed. Unit tests were green because they mocked happier shapes than Zoekt + real `planTurn`. Fixing this is **five coordinated gaps**, not one matcher tweak.

| # | Gap | Plan | Owner layer |
|---|-----|------|-------------|
| 01 | Live Parent Pass is the only ship gate | [gap-01](gap-01-live-parent-pass-e2e.md) | Product truth |
| 02 | Tests must encode live Zoekt shapes | [gap-02](gap-02-test-live-fidelity.md) | Honesty of proofs |
| 03 | Agent owns gather (architecture in spirit) | [gap-03](gap-03-agent-owned-gather.md) | Gather brain |
| 04 | Finish/attach rails correct & subordinate | [gap-04](gap-04-finish-attach-rails.md) | Miss forbidden |
| 05 | Claim tiers — never say “fixed” from units | [gap-05](gap-05-ship-claim-discipline.md) | Process / trust |

**Conflict rule (from Gap 04):** If index already had the reject (or right file opened) and we still canned-missed → fix **rails (04)** first. If Activity is only a query parade with no sensible consume → fix **agent gather (03)**. When both, **04 then 03**. Live Pass (01) and claim language (05) close the loop. Tests (02) make lying impossible.

---

## Shared ship gate (non-negotiable)

**Exact paste (canonical — promote into `dogfoodContract.ts` as e.g. `LIVE_PARENT_PASS_ASK`):**

```
In Plane issue create/update, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent isn't in the project. Where is that raised?
```

| | |
|--|--|
| Use-repo | `CoopAI-Corp/plane` |
| Branch | `preview` |
| Chip | none |
| Thread | fresh |
| Pass | Cites/attaches Parent ValidationError in `apps/api/plane/app/serializers/issue.py` |
| Fail | `API_REJECT_HUNT_MISS` or UI speculative essay |

Soft `COPILOT_T2_ASK` is a **regression**, not a substitute for this gate.

**Claim language (Gap 05):**

| Tier | Allowed phrase |
|------|----------------|
| A | Automated Pass |
| B | Ready for your Reload dogfood — live Pass still open |
| C | Fixed / live Pass |

Never say **fixed** for this Fail class without Gate C.

---

## Cross-cutting findings (where plans agree)

### Highest remaining product holes

1. **Finish only checks pruned `read_file`** — unused Zoekt snippets / prior searches can still miss (04 F6; 01 C).
2. **Seed / wrong-body path skips snippet attach** — seed runs searches without `attachRejectFromSearchHits`; non-empty wrong-floor body skips attach even when `hit.content` is the reject (01 C; 04 F8).
3. **Matcher still fails paraphrase × message-only** — Exact+quote Pass; `COPILOT_T2_ASK` + Zoekt message-only → `contentLooksLikeAskedFieldReject === false` (02 proven; 04 F9).
4. **`planTurn` present can still resurrect `huntWriteReject`** on first invalid/throw (03 Step A).
5. **Pre-loop seed still executes criteria** — Activity can open as a parade before the agent thinks (03 Step B).
6. **Wrong-floor fixture lie** — hit invents `IssueFlatSerializer` not in `planeIssueSerializer.validate.py` (02).
7. **CI skips `test:agent-ship:a`** — Orchestrator + searchQuery reject suites not on `test:ci` (02).
8. **No Host gate in CI** — only Extension Host closes Gap 01 (honest: don’t fake cloud E2E).

### What is already strong (keep)

- Early-return into scavenger removed on happy path.
- Intent brief + planned criteria wired into agent prompt.
- Attach-from-snippet + preferredHits fail-open + wrong-floor jump **concepts** (incomplete wiring).
- Calm-vs-reject / plain-chat-must-not-promote / noRepoSpecificRules.
- Product prompts + `reject-hunt-attach-before-miss.mdc` directionally right.

---

## Recommended implementation order (for the fix prompt)

Do **not** reorder past Step 0–1. Process (05) can land in parallel as docs/rules only.

```
Phase 0 — Process (Gap 05, parallel OK)
  Add ship-claim-discipline.mdc + AGENTS/dogfood pointers
  Fix chat must use claim tiers from turn 1

Phase 1 — Evidence contract + finish choke (Gap 04 Steps 0–1, Gap 01 Step 1)
  unusedRejectEvidence()
  finishWithAnswer: attach/jump BEFORE API_REJECT_HUNT_MISS
  Seed + wrong-body: same attach helper as loop

Phase 2 — Live-shaped red tests first (Gap 02)
  Shared rejectHuntLiveShapes fixtures
  Dual-ask × message-only × undefined body
  preferredHits-empty → attach
  Fix fixture hit ⊆ body
  Put ship:a (or reject fidelity) on test:ci
  Land failing tests, then make green

Phase 3 — Matcher honesty (Gap 04 Step 5 + Gap 02 A2)
  Unquoted / paraphrase + field-shaped message-only lines
  Wrong-field negatives stay

Phase 4 — Ledger + fail-open + jump completeness (Gap 04 Steps 2,4,6)
  Reject hit ledger across search merges
  preferredHits fail-open = actionable class
  Finish candidates include serializers / mutation handlers

Phase 5 — Agent-owned gather spirit (Gap 03)
  Never huntWriteReject when planTurn was supplied
  Demote pre-loop seed (0 or ≤1 labeled)
  Consume preferred before more search; streak cap
  Adaptation tests (not rails-only Pass)
  Reject-specific nudge/prompt copy

Phase 6 — Branch proof (Gap 01 Step 3, Gap 04 Step 8)
  Keep resolveActiveRepoTarget; add contract/test

Phase 7 — Live Host (Gap 01 Step 4 + Gap 05 Gate C)
  Reload → exact LIVE_PARENT_PASS_ASK
  Only then: Fixed
```

### Suggested fix-prompt packaging (next chat)

**Option A — One ship chat** covering Phases 0–7 (long; use this master + all five plans).  
**Option B — Two chats:** (1) rails+tests+claims Phases 0–4+6; (2) agent gather Phase 5 + Host dogfood. Prefer **A** if context fits — rails-before-agent matches conflict rule.

---

## Per-gap build summaries (executive)

### Gap 01 — Live Parent Pass
- Canonicalize exact paste in `dogfoodContract.ts`.
- Close seed / wrong-body / finish unused-hit holes.
- Adversarial tests (lazy planTurn, seed+done, wrong-floor non-empty body).
- Host dogfood is the only Gate C.

### Gap 02 — Test fidelity
- Stop mocking full raise as the only hit shape.
- Dual ask: Exact quoted + `COPILOT_T2_ASK`.
- Message-only Zoekt + `readRemoteFile → undefined` as default attach proof.
- Hit content must appear in body fixture.
- CI must run the suites.

### Gap 03 — Agent-owned gather
- Kill scavenger resurrection when `planTurn` exists.
- Seeds = hints (not Activity parade).
- Force consume preferred / attach before search spray; cap 10/0.
- Tests that second tool depends on first result.

### Gap 04 — Finish/attach rails
- One contract: miss forbidden while unused reject evidence exists.
- Ledger across searches; attach parity everywhere; matcher F9; jump candidates complete.
- Rails enforce; do not re-own query lists.

### Gap 05 — Ship/claim discipline
- Always-on `ship-claim-discipline.mdc`.
- Asks only from `dogfoodContract.ts`.
- “Automated Pass” ≠ “fixed.”

---

## Files likely touched (implementation)

| Area | Paths |
|------|--------|
| Orchestrator | `src/api/agent/AgentOrchestrator.ts`, `.test.ts` |
| Matchers | `src/api/agent/searchQuery.ts`, `.test.ts` |
| Fixtures | `dogfoodContract.ts`, `fixtures/planeIssueSerializer.validate.py`, new `rejectHuntLiveShapes.ts` |
| Prompt/nudge | `src/api/agent/parseAgentToolPlan.ts` |
| Session | `src/chat/CoopChatSession.ts`, `planChatJobs.ts` (thin) |
| Branch | `src/extension.ts` |
| CI | `package.json` `test:ci`, `.github/workflows/ci.yml` |
| Process | `.cursor/rules/ship-claim-discipline.mdc`, `AGENTS.md`, `docs/agent-dogfood.md`, `founder-pm-comms.mdc` |

---

## Explicit do-not list (all gaps)

- New invent/slogan banks as the main fix  
- Plane / CoopAI-Corp path special-cases  
- Silent Blast/Owner/Trace from plain English  
- Weaken calm-vs-reject  
- Claim “fixed” from unit green alone  
- Fake cloud Zoekt E2E in CI without building it  
- Commit unless Jon asks  

---

## Inputs to paste when writing the fix prompt

1. This master: `.cursor/plans/MASTER-reject-hunt-quarterback-handoff.md`  
2. All five: `gap-01` … `gap-05`  
3. Architecture intent: `.cursor/intent-quarterback-agent-owns-reject.prompt.md`  
4. Rules: `reject-hunt-attach-before-miss.mdc`, `evidence-bound-answers.mdc`, `plain-chat-must-not-promote.mdc`  
5. Exact live paste + soft `COPILOT_T2_ASK`  
6. Claim tiers from Gap 05 §5 / §8  

### Deliverable vocabulary the fix chat must use

1. Automated Pass/Fail table (per Fail ID) — label **Automated**.  
2. Dogfood handoff — Gate B; live still open.  
3. Do **not** say fixed until Host Pass on exact paste.  
4. No invented error strings.  
5. Residual risks (short).

---

## Status of planning work

| Agent | Status | Deliverable |
|-------|--------|-------------|
| Live Parent Pass E2E | Done | `gap-01-live-parent-pass-e2e.md` |
| Test↔live fidelity | Done | `gap-02-test-live-fidelity.md` |
| Agent-owned gather | Done | `gap-03-agent-owned-gather.md` |
| Finish/attach rails | Done | `gap-04-finish-attach-rails.md` |
| Ship/claim discipline | Done | `gap-05-ship-claim-discipline.md` |
| Master synthesis | Done | this file |

**Next human/agent step:** Write the fix-implementation prompt from this master (Option A or B). Do not implement until Jon asks.
