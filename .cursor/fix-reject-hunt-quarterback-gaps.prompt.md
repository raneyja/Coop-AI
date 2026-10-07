# Fix implementation — Reject hunt + quarterback gaps (rails → gather → live)

Paste this **entire file** into a **new** agent chat.

**Do not commit unless the user asks.**

Prior thread cut the `huntWriteReject` early-return and added rails, but **live Parent reject still canned-missed** on indexed `plane` / `preview`. Unit tests were green on happier mocks than Zoekt + real `planTurn`. Planning is done — this chat **implements**.

---

## Claim discipline (mandatory from turn 1)

| Tier | Phrase | When |
|------|--------|------|
| A | **Automated Pass** | Targeted tests + lint for this Fail class green |
| B | **Ready for your Reload dogfood — live Pass still open** | A + exact fixture asks + Reload setup |
| C | **Fixed / live Pass** | Extension Host Pass on the named ask |

**Hard fails:** Never say “fixed,” “Pass,” “done,” or “shipped” for this Fail class from unit tests alone. Never invent Plane error strings for dogfood — only `dogfoodContract.ts` / constants you add here.

Ship process rule as Phase 0 (always-on `.cursor/rules/ship-claim-discipline.mdc`). Outline: `.cursor/plans/gap-05-ship-claim-discipline.md` §8.

---

## Product law (non-negotiable)

```
User message
  → Intent quarterback (brief + optional seed criteria as HINTS)
  → Agent planTurn loop owns gather (search → read → adapt)
  → Rails enforce evidence class (attach / jump / miss-forbidden)
  → Answer (evidence-bound)
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| Quarterback | Job brief, evidence class, optional 2–4 seed **hints** | Executing search parade |
| Agent (`planTurn`) | Next tool from results | Inventing paths; silent workflows |
| Rails | Attach-before-miss; jump-before-miss; skip noise; matcher honesty | Query slogan brain |

**Conflict rule:** Index already had reject / right file opened and still canned-miss → **rails first**. Activity is only a query parade → **agent gather**. When both → rails then gather.

Keep: calm-vs-reject, plain-chat-must-not-promote, Zero-Clone, soft gather (never abort solely at 15s), evidence-bound, noRepoSpecificRules, Boris bar.

---

## Why this session exists

Live dogfood (2026-09-29) on Use-repo **plane** / **preview** / no file chip:

| Fail | What happened |
|------|----------------|
| Opened `serializers/issue.py` then canned miss | Right file, wrong floor / finish didn’t force jump or unused-snippet attach |
| 10× `search_code`, 0× `read_file` | preferredHits emptied; hit already had error line |
| Zoekt message-only line | Matcher required `raise` / `ValidationError`; live fragment is often just the quoted message |
| Unit green / Host Fail | Mocks used full raise + happy body; soft ask ≠ live paste; CI skips ship:a |

**Planning corpus (read before coding; implement order below):**

| Doc | Role |
|-----|------|
| `.cursor/plans/MASTER-reject-hunt-quarterback-handoff.md` | Ordered phases + conflict rule |
| `.cursor/plans/gap-01-live-parent-pass-e2e.md` | Ship gate + Host protocol |
| `.cursor/plans/gap-02-test-live-fidelity.md` | Live-shaped tests + CI |
| `.cursor/plans/gap-03-agent-owned-gather.md` | Complete architecture cut |
| `.cursor/plans/gap-04-finish-attach-rails.md` | Miss-forbidden contract |
| `.cursor/plans/gap-05-ship-claim-discipline.md` | Claim tiers / rule text |
| `.cursor/intent-quarterback-agent-owns-reject.prompt.md` | Original architecture intent |
| `.cursor/rules/reject-hunt-attach-before-miss.mdc` | Attach-before-miss law |

---

## Ship gate (non-negotiable)

Add to `src/api/agent/dogfoodContract.ts` as e.g. `LIVE_PARENT_PASS_ASK` (exact string):

```
In Plane issue create/update, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent isn't in the project. Where is that raised?
```

| | |
|--|--|
| Use-repo | `CoopAI-Corp/plane` |
| Branch | `preview` |
| Chip | none |
| Thread | fresh |
| **Pass** | Cites/attaches Parent ValidationError in `apps/api/plane/app/serializers/issue.py` (or attached write-reject equivalent) |
| **Fail** | `API_REJECT_HUNT_MISS` or UI speculative essay |

Soft `COPILOT_T2_ASK` = **regression only**, never a substitute for this gate.

---

## Implementation order (do not reorder past Phase 0–1)

### Phase 0 — Claim discipline (process)

1. Add `.cursor/rules/ship-claim-discipline.mdc` (`alwaysApply: true`) — three tiers; banned “fixed” from units; dogfood asks from `dogfoodContract.ts`.
2. Short pointer under `AGENTS.md` Boris bar.
3. Anti-example in `.cursor/rules/founder-pm-comms.mdc`.
4. Optional: reject-hunt appendix in `docs/agent-dogfood.md`; one line in `agent-git-workflow.mdc` (lint ≠ product Pass).

### Phase 1 — Evidence contract + finish choke (Gap 04 / 01)

1. Define `unusedRejectEvidence(context, query)` (or equivalent):
   - Attached asked-field reject → none unused
   - Else unused attachable search hit / ledger snippet
   - Else unjumped preferred/opened serializer or server-write / mutation-handler
2. In `finishWithAnswer`, **before** `API_REJECT_HUNT_MISS`: resolve unused (attach snippet → jump) → re-check → only then miss.
3. **Attach parity:** same attach helper from owned-loop `search_code`, `seedRejectPlannedSearches`, `huntWriteReject` (fail-open only), `lastChancePreferredHitsOnly`, and finish.
4. **Wrong-body hole:** if `hit.content` looks like asked-field reject and remote body is non-empty but **not** asked reject → attach snippet (or jump then attach) — never `continue` past unused reject snippet.

### Phase 2 — Live-shaped tests first (Gap 02) — red then green

1. Shared fixture module e.g. `src/api/agent/fixtures/rejectHuntLiveShapes.ts`:
   - `LIVE_PARENT_PASS_ASK` / Exact quoted ask
   - `COPILOT_T2_ASK`
   - `ZOEKT_PARENT_MESSAGE_ONLY`, bare, full raise, State negative
   - Body loader from `planeIssueSerializer.validate.py`
2. **Hit content must appear in fixture body** — rewrite wrong-floor test that invents `IssueFlatSerializer`.
3. Required regressions (must exist; names flexible):

| ID | Spec |
|----|------|
| A2 | `COPILOT_T2_ASK` × message-only Zoekt → `contentLooksLikeAskedFieldReject` true (today false — land red) |
| B1 | Exact + message-only + `readRemoteFile → undefined` → attach, no miss |
| B2 | Same for `COPILOT_T2_ASK` |
| B3 | preferredHits empty / noise; raw hits have message-only Parent → attach; no search parade |
| B4 | Wrong-floor: hit ⊆ fixture; jump to Parent; no miss |
| B6 | Wrong-branch body without Parent + message-only hit → attach from hit |
| Finish | Cannot emit miss while unused asked-field hit sits in search context |

4. Put `test:agent-ship:a` **or** a slim reject-fidelity script on `npm run test:ci` / CI workflow.

### Phase 3 — Matcher honesty (Gap 04 F9 / Gap 02)

Extend `contentLooksLikeAskedFieldReject` carefully:

- Message-only / raise-less lines Pass when asked field appears **and** line looks like API error copy (`not valid`, `please pass a valid`, etc.) **and** path is not client UI/noise (prefer serializer/server-write path class).
- Exact quote path stays.
- Wrong-field message-only stays **false**.
- Do **not** grow slogan query banks.

### Phase 4 — Ledger + fail-open + jump completeness

1. Reject **hit ledger** across `search_code` merges (cap ~5) — finish/attach read ledger (F6).
2. `decorateToolResult` fail-open = actionable ∪ asked-field ∪ server-write; share with seed/lastChance.
3. Finish jump candidates = server-write ∪ mutation-handler ∪ serializer path class ∪ already-opened paths (not only `isServerWritePath`).
4. Use or delete dead `rejectJumpAttempted`.

### Phase 5 — Agent-owned gather spirit (Gap 03)

1. With `planTurn` present + reject: **never** fall into `runDeterministic` → `huntWriteReject` on first invalid/throw — nudge/continue or finish rails only.
2. Demote `seedRejectPlannedSearches`: prefer **0** pre-loop searches (criteria in brief/prompt only); acceptable max **1** labeled seed.
3. After preferredHits / attachable snippet and no write-reject yet: block search-spray — nudge or read before another `search_code`; cap search streak without read (e.g. 3–4) → finish.
4. Reject-specific done/nudge copy in `parseAgentToolPlan` / prompt (write-reject attached, not “named symbol”).
5. Tests: no scavenger resurrection; adaptation (round-2 tool depends on round-1 payload); consume-preferred before Nth search.

### Phase 6 — Branch proof

Keep `extension.ts` agent `readRemoteFile` → `resolveActiveRepoTarget`. Add focused test or contract assert. No new bypass call sites.

### Phase 7 — Handoff (not “fixed”)

After Automated Pass:

```
Status: Automated Pass for Parent reject / rails+gather. Live Pass still open.

Do this now:
1. Extension UI — Developer: Reload Window
2. Use-repo plane / preview / no file chip / fresh thread
3. Paste exact LIVE_PARENT_PASS_ASK (from dogfoodContract)
Success = cites Parent ValidationError in serializers/issue.py
Fail = canned miss

I will not call this fixed until you report live Pass (or Fail).
```

Optional regression: `COPILOT_T2_ASK`, C2, L3, Tripwire from `dogfoodContract.ts` — same evidence-class rules; not substitutes for LIVE_PARENT_PASS_ASK.

---

## Files expected

| Area | Paths |
|------|--------|
| Orchestrator | `src/api/agent/AgentOrchestrator.ts`, `AgentOrchestrator.test.ts` |
| Matchers | `src/api/agent/searchQuery.ts`, `searchQuery.test.ts` |
| Fixtures | `dogfoodContract.ts`, `fixtures/planeIssueSerializer.validate.py`, new `rejectHuntLiveShapes.ts` |
| Prompt/nudge | `src/api/agent/parseAgentToolPlan.ts` |
| Session | `src/chat/CoopChatSession.ts`, `planChatJobs.ts` (thin only) |
| Branch | `src/extension.ts` |
| CI | `package.json` `test:ci`, `.github/workflows/ci.yml` |
| Process | `ship-claim-discipline.mdc`, `AGENTS.md`, `founder-pm-comms.mdc`, optional `docs/agent-dogfood.md` |

---

## Automated Pass checklist (Gate A)

- [ ] `LIVE_PARENT_PASS_ASK` in `dogfoodContract.ts`; soft T2 separate
- [ ] Finish cannot miss with unused asked-field hit in search/ledger
- [ ] Message-only Zoekt + undefined body → attach (Exact **and** `COPILOT_T2_ASK`)
- [ ] preferredHits empty + raw reject hit → attach; not 10/0
- [ ] Wrong-floor fixture hit ⊆ body → jump/attach
- [ ] Seed / wrong-body attach parity
- [ ] `planTurn` present → `huntWriteReject` not resurrected
- [ ] Adaptation / search-streak cap tests green
- [ ] L3 / Tripwire / calm locate still not ValidationError-first
- [ ] `plainChatMustNotPromote` / `noRepoSpecificRules` green
- [ ] Reject/orchestrator suites on `test:ci`
- [ ] `npm run lint` if types/clients touched
- [ ] Claim rule shipped; handoff uses Gate B language

Run at minimum:

```bash
npx tsx src/api/agent/AgentOrchestrator.test.ts
npx tsx src/api/agent/searchQuery.test.ts
npx tsx src/chat/intentPlanner/intentQuarterback.gates.test.ts
npx tsx src/api/agent/noRepoSpecificRules.test.ts
npm run lint   # if types/clients touched
```

---

## Do not

| Reject | Why |
|--------|-----|
| New inventAskDerived / slogan banks as the main fix | Re-owns gather with script brain |
| Plane / CoopAI-Corp / one OpenAPI path special-cases | noRepoSpecificRules |
| Silent Blast / Owner / Trace / `execution: silent` from plain English | plain-chat-must-not-promote |
| Weaken `isApiRejectAsk` / calm-vs-reject | L3/Tripwire |
| Claim “fixed” from unit green alone | Gap 05 |
| Fake cloud Zoekt live CI | Host is Gate C; be honest |
| Grow pre-loop seed searches | Makes Activity a parade |
| Prompt-only finish without miss-forbidden rail | Already failed live |
| Commit unless asked | User rule |

---

## Deliverable vocabulary (end of chat)

1. **Automated Pass/Fail table** — per phase/Fail ID; label column **Automated**.
2. **What changed** — finish/attach/matcher/gather/CI/process (not “more tests only”).
3. **Gate B handoff** — exact `LIVE_PARENT_PASS_ASK`; Reload steps; **live Pass still open**.
4. Residual risks (short bullets).
5. **Do not** say fixed until founder reports Host Pass.

### Boris self-check

Would a staff engineer paste a never-before-seen on-call reject paragraph and trust Coop to attach write-reject evidence (or short miss) without a slogan list owning the turn — and without canned-missing when Zoekt already showed the error line? If finish can still miss with unused evidence in context, or Activity is still a fixed parade then miss, **you are not done** (Automated still open — say so).
