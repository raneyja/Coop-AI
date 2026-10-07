# Gap 03 — Agent-owned gather (architecture cut incomplete)

Planning only. Agent 3 of 5. Repo: Coop-AI. Date: 2026-09-29.

Related product prompt: `.cursor/intent-quarterback-agent-owns-reject.prompt.md`  
Prior: bf6149a (quarterback invents `searchCriteria`). Uncommitted: orchestrator rails + brief wiring (~481-line `AgentOrchestrator` delta).

---

## 1. Gap statement (script vs agent)

**Product law:** quarterback owns the job brief; `planTurn` agent loop owns gather; rails enforce evidence class.

**What shipped (procedural cut):** `runOwnedLoop` no longer early-returns into `huntWriteReject` and skips `planTurn`. Tests assert `planTurn` is called. Reject asks fall into the same for-loop as other code jobs.

**What did not ship (behavioral cut):** Live Activity still can look like a **fixed query parade then canned miss** (dogfood: 10× `search_code` / 0× meaningful `read_file`). Most of the uncommitted orchestrator delta is **evidence rails** (snippet attach, preferredHits fail-open, finish jump, seed ≤2). Those can make a test Pass without proving the agent **adapts from results**.

| Script brain (still real) | Agent brain (claimed, thin) |
|---------------------------|-----------------------------|
| Pre-loop `seedRejectPlannedSearches` executes quarterback criteria as Activity steps before any `planTurn` | `planTurn` is invoked — but often after seeds already burned rounds |
| `mergePlannedAgentSearchQueries` = planned + `inventAskDerived` + slogan pad (cap 12) on deterministic / fail-open | Prompt says “invent further queries from results” — no hard consume-preferred rule |
| First-round `planTurn` fail/invalid → `runDeterministic` → **`huntWriteReject` resurrected** | Conversation gets results, but done-nudge still talks about “named symbol,” not write-reject |
| Auto-attach / auto-read / finish jump = rails choose consume path | Tests mock one `search_code` then `{done:true}` — Pass via attach rails, not multi-round adaptation |

**Ruthless verdict:** Removing the early-return was necessary but not sufficient. Rails pretending to be the product will hide the hole: dogfood can Pass on attach/jump while Activity still smells like a scavenger. The architecture cut is incomplete until **next tool choice is driven by prior tool results**, with quarterback criteria as **hints only**, and `huntWriteReject` truly fail-open-only.

---

## 2. Target architecture vs current (table)

```
User message
  → Intent quarterback (cheap; fail-open)
       purpose, jobs[], evidenceClass, done-looks-like,
       optional seed searchCriteria (2–4) — HINTS ONLY
  → Agent tool loop (planTurn)
       search_code → see preferredHits / skipNote
       → choose read_file OR a new query invented from those results
       → until write-reject attached or budget exhausted
  → Rails: skip noise, attach if snippet IS reject, jump wrong floor,
           evidence-bound finish / short miss
  → Answer
```

| Layer | Target owns | Target does not own | Current reality |
|-------|-------------|---------------------|-----------------|
| Quarterback | Job brief + evidence class + optional seed criteria in prompt | Executing the search parade | Brief + `plannedSearchQueries` wired; **seeds still executed** before loop |
| Agent (`planTurn`) | Next tool from last result; invent queries when hits are noise/empty | Silent workflows; inventing paths | Called, but not required to adapt; may spray `search_code` |
| Rails | Evidence class: skip UI/types, keep preferredHits, attach snippet, in-file jump, canned miss only after gather | Replacing gather with slogan lists / auto-scavenger | Dominates Pass proofs; ~1k-line spirit of delta is rails |
| Deterministic / `huntWriteReject` | Fail-open when **no** `planTurn` (tests) | Live path when `planTurn` was provided | Still reachable on live if first `planTurn` throws/invalid |

| Concern | Target | Current (uncommitted) |
|---------|--------|------------------------|
| Early-return bypass | Gone | Gone ✓ |
| Pre-loop reject seed | 0 executed searches; criteria in brief/prompt only | `seedRejectPlannedSearches` runs ≤2 planned queries **before** loop |
| `huntWriteReject` | `runDeterministic` only (no planTurn) | Same + accidental resurrection via invalid first planTurn |
| Brief into loop | `intentBrief` + `buildAgentToolPlanPrompt` rejectRules | Wired ✓ |
| Prefer read over more search | After preferredHits, next action is read/attach — agent or one nudge | Auto-read if `!matchingRead`; if preferred empty → more searches; skipNote says “Search again” |
| Finish | Jump then miss; no miss while unjumped serializer | Jump rail + `API_REJECT_HUNT_MISS` ✓ (evidence rail — keep) |
| Calm-vs-reject | Unchanged | Unchanged — keep |

---

## 3. Call-site inventory (what still owns the turn)

### Owns gather today (script / rails)

| Site | File | Role | Keep / demote |
|------|------|------|---------------|
| `seedRejectPlannedSearches` | `AgentOrchestrator.ts` ~2372 | Executes 0–2 planned `search_code` (+ auto-read) **before** `planTurn` | **Demote:** hints only, or execute only when `!planTurn` |
| `runPlannedSearchQueries` / `plannedSearchQueries` | Session → orchestrator options | Feeds seed + deterministic merge | Keep as hint list; stop treating as pre-loop brain |
| `huntWriteReject` | `AgentOrchestrator.ts` ~2450 | Deterministic ≤4 merge(planned+invent+fallback) | Keep **only** in `runDeterministic` when no planTurn |
| `runDeterministic` reject branch | ~1588 | Calls `huntWriteReject` | Keep for fail-open; **must not** run when live `planTurn` was supplied |
| `planTurn` catch / invalid → `runDeterministic` | ~524–556 | First failure with `steps.length===0` resurrects scavenger | **Cut for reject:** nudge + continue loop, or empty seed+finish — not full hunt |
| `mergePlannedAgentSearchQueries` | `searchQuery.ts` ~603 | planned → invent → slogan pad (max 12) | OK for no-planTurn; must not drive live Activity parade |
| `inventAskDerivedSearchCriteria` / `fallbackAgentSearchQueries` | `searchQuery.ts` | Script query invent | Fail-open pad only; not live agent brain |
| Auto-read after `search_code` | `runOwnedLoop` ~845–922 | Rails open preferredHits without agent `read_file` | Acceptable as **evidence consume** *if* agent chose the search; do not count as “agent adapted” alone |
| `attachRejectFromSearchHits` / `attachRejectSnippetPayload` | ~2292+ | Attach raise line from Zoekt snippet | **Keep** (evidence rail — reject-hunt-attach-before-miss) |
| `decorateToolResult` preferredHits fail-open | ~2642 | Prevent empty preferred → 0 reads | **Keep** (evidence rail) |
| Finish jump / `readWriteRejectInSameFile` | ~1043–1090, helpers | Right file wrong floor | **Keep** (evidence rail) |
| `finishWithAnswer` → `API_REJECT_HUNT_MISS` | ~1174 | Short miss when no write-reject | **Keep**; never emit while unused snippet / unjumped preferred |

### Owns brief / hints (quarterback — correct layer)

| Site | Role |
|------|------|
| `formatIntentBriefForAgent` | Conversation user message: purpose, evidence, seed=[…] |
| `plannedCodeSearchQueries` | Extract criteria/terms for options |
| `buildAgentToolPlanPrompt` rejectRules + jobHint | Prompt: write-reject done-looks-like; “Suggested queries, not a limit” |
| `planAgentToolTurn` / Session `planTurn` wrapper | Feeds jobs + purpose into prompt; history = conversation |

### Soft ownership bugs (agent discouraged from adapting)

| Site | Problem |
|------|---------|
| `buildAgentToolPlanPrompt` huntRules | Strong “search again / never done after empty”; weak “read preferredHits before another search” |
| `done` nudge when `!canAnswerNow()` | Copy is locate-symbol (“implementation of the named symbol”), not write-reject — agent may keep spraying searches |
| `skipNote` when preferred empty | Explicitly tells model to search again |
| `canAnswerNow` for reject | Correct gate (`contextHasWriteReject`) — but without a “prefer read” nudge, gate → search parade |
| Tests | Many Pass with one mocked search + rails attach; few assert round-2 tool differs because of round-1 payload |

### Not the gap (do not reopen as main job)

- `isApiRejectAsk` / calm-vs-reject classification
- Invent-regex polish / Plane path special-cases
- Silent workflow promote (`plain-chat-must-not-promote`)
- Create-issue locate

---

## 4. Build plan ordered (minimal diffs)

Do **not** reorder. Prefer delete/demote over new slogan banks.

### Step A — Kill accidental scavenger resurrection (choke)

In `runOwnedLoop`, when `options.planTurn` is present and `isApiRejectAsk`:

- On `planTurn` throw / `invalid` with zero steps: **do not** call `runDeterministic` → `huntWriteReject`.
- Instead: push a short nudge into conversation (“Reply with tool JSON: search_code or read_file”) and `continue`, or break to finish rails (preferredHits / jump / miss).
- Leave `huntWriteReject` only on `runDeterministic` when `!planTurn`.

**Why first:** Live path can still become the old script if the model returns garbage once. That falsifies “bypass removed.”

### Step B — Demote pre-loop seed to hints

`seedRejectPlannedSearches`:

- **Preferred:** stop executing searches before the loop. Criteria already live in `intentBrief` + `suggestedJobs` / jobHint.
- **Acceptable compromise:** execute seed only if `plannedSearchQueries.length > 0` **and** a flag / no prior steps — but Activity must label seed distinctly, and max **1** search (not 2) so dogfood does not open as a parade.
- Update test `"reject hunt searches quarterback planned criteria before slogan get(parent)"` to expect **agent or prompt** use of criteria, not “first Activity search === planned[0] before planTurn.”

### Step C — Force consume-results before more search (agent-shaped rail)

After a reject `search_code` that left nonempty `preferredHits` / attachable snippet and no write-reject yet:

1. Keep existing attach-from-snippet (rail) — first.
2. If not attached and agent’s **next** plan is another `search_code` without having attempted read on preferred paths: **nudge once** — reject that plan with user content like “preferredHits exist — call read_file on the top server-write path before another search.” Count as rail, not brain.
3. Optionally: one auto-read of preferred (existing) is fine as evidence consume; then agent invents next query only if that body was noise.

Add reject-specific `done` / invalid nudge copy (write-reject attached), not named-symbol copy.

### Step D — Cap search streak without read (observable stop)

For reject + planTurn path: if ≥N `search_code` steps (suggest N=3–4) with **zero** `read_file` / attach attempts while hits existed → stop loop → finish jump/miss. Prevents 10/0 Activity. Do **not** fill remaining budget with `mergePlanned` slogans.

### Step E — Prompt tighten (small)

In `buildAgentToolPlanPrompt` when `writeRejectJob` / `isApiRejectAsk` context:

- Add: “If last search_code returned preferredHits, your next JSON must be read_file on one of those paths (or a jump in that file) — not another search — unless every preferred path was already skipped as noise.”
- Keep: seed criteria optional; invent from results; no silent workflow.

### Step F — Tests that prove adaptation (not rails alone)

Replace / add (must be green before dogfood):

| Test | Pass |
|------|------|
| Reject + planTurn present + first planTurn invalid | `huntWriteReject` **not** called; planTurn retried or finish rails only |
| No pre-loop seed parade | With planned criteria, first **planTurn** round occurs with 0 or labeled ≤1 seed; agent may choose planned string as query |
| Adaptation | Round 1 search returns noise preferredHit; round 2 planTurn receives that result; mock returns **different** query or `read_file` — assert second tool ≠ blind slogan list order |
| Consume preferred | preferredHits nonempty + mocked planTurn that tries second search first → nudge or auto-read; **not** 5 more searches / 0 reads |
| Existing | T2 wrong-floor jump; C2 continue after noise; UI-only short miss; attach from snippet when body fetch empty; calm L3/Tripwire not ValidationError-first; plain-chat-must-not-promote; noRepoSpecificRules |

### Step G — Session / quarterback (minimal)

- Keep `formatIntentBriefForAgent` / `plannedCodeSearchQueries` / purpose into `planAgentToolTurn`.
- Cap suggested criteria in prompt to 2–4; do not also execute the same list as Activity before the loop (Step B).
- No `execution: silent` / workflow from quarterback on unconstrained English.

---

## 5. Observable Pass criteria (Activity smell + automated)

### Activity smell of Pass (Jon dogfood)

Use-repo `plane` / `preview`, no file chip, fresh thread, exact T2/C2:

| Pass | Fail |
|------|------|
| Visible mix: `search_code` → `read_file` (or snippet attach summary) → maybe **different** search after a skip | Only a long list of `search_code: …` then miss |
| Queries change after a miss/noise (field phrase → ValidationError → get("field") **chosen after seeing empty/noise**, not a fixed bank order) | Same 8–12 fixed strings every reject ask |
| Serializer/server path opened; answer cites write-reject or short honest miss | Canned miss after opening serializer without jump; or UI essay |
| Seed (if any) ≤1 and brief; agent rounds dominate Activity | First 2–4 steps are always quarterback criteria then invent pad |

**Smell of rails-only fake Pass:** attach/jump works in tests, but live Activity never shows planTurn choosing `read_file` or a result-driven second query.

### Automated Pass

1. `planTurn` called ≥1 on reject (already).
2. With `planTurn` provided, `huntWriteReject` / `searchUntilReadableHits` slogan merge **not** invoked on reject.
3. Adaptation test (Step F): second tool depends on first tool payload.
4. preferredHits + attempted second search without read → nudge or read; assert read/attach before Nth search.
5. Snippet-attach when `readRemoteFile` empty (reject-hunt-attach-before-miss).
6. Calm-vs-reject + plain-chat-must-not-promote + noRepoSpecificRules unchanged.
7. `npm run lint` if types/clients touched.

---

## 6. What must NOT be done

| Reject | Why |
|--------|-----|
| New inventAskDerived / slogan banks as the “fix” | That re-owns gather with script brain |
| Plane / CoopAI-Corp / one OpenAPI path special-cases | Product law + noRepoSpecificRules |
| Silent Blast / Owner / Trace / `execution: silent` from plain English | plain-chat-must-not-promote |
| Weaken `isApiRejectAsk` / calm-vs-reject | L3/Tripwire must stay non-reject-first |
| Claiming Pass because attach/jump tests alone are green | Rails ≠ agent-owned gather |
| Growing `MAX_API_REJECT_SEED_SEARCHES` / pre-loop seed | Makes Activity more parade-like |
| Aborting turn at 15s / timeout bubble | Soft gather only; user Stop only |
| Replacing evidence rails (skip noise, snippet attach, jump, short miss) | Those enforce evidence class — keep |

---

## 7. Out of scope

- Create-issue locate playbook
- Invent-regex polish for its own sake
- Integration mid-loop / vendor Open behavior
- Changing soft gather budget constants
- Committing / shipping (unless Jon asks)
- Full rewrite of `AgentOrchestrator` into a new class
- UI redesign of Activity (labeling seed vs agent is optional polish, not required)

---

## 8. Fix-prompt inputs

Paste into the implementer chat (together with the product prompt if helpful):

### Goal

Complete the architecture cut **in spirit**: agent chooses next tool from results; quarterback brief is hints; `huntWriteReject` fail-open only; Activity proves adaptation. Keep calm-vs-reject and evidence rails. No silent promote. No new slogan banks. Planning doc: `.cursor/plans/gap-03-agent-owned-gather.md`.

### Mandatory order

1. **Choke:** With `planTurn` present, reject path must never fall into `runDeterministic` → `huntWriteReject` on first invalid/throw.
2. **Demote seed:** Stop (or hard-cap to 1 labeled) pre-loop `seedRejectPlannedSearches` execution; criteria stay in `intentBrief` / prompt jobHint.
3. **Consume results:** After preferredHits/attachable snippet, block search-spray — nudge or read before another `search_code`; cap search streak without read → finish.
4. **Prompt:** Reject-specific done/nudge copy + “read preferred before another search.”
5. **Tests:** Adaptation + no scavenger resurrection + existing T2/C2/UI/snippet/calm/promote gates.
6. Do not commit unless asked. Lint if types touched.

### Files to touch (expected)

- `src/api/agent/AgentOrchestrator.ts` (choke, seed, nudge, streak cap)
- `src/api/agent/parseAgentToolPlan.ts` (reject prompt / nudge copy)
- `src/api/agent/AgentOrchestrator.test.ts` (adaptation + choke proofs; update seed-first test)
- Possibly `src/chat/CoopChatSession.ts` / `planChatJobs.ts` only if brief/seed wiring needs a thin adjust
- Avoid new banks in `searchQuery.ts` except if choke needs a guard comment/test hook

### Self-check (Boris / staff)

Would a never-before-seen on-call reject paragraph still only work when a fixed query list (quarterback + invent + pad) hits the string in the right order? If yes, fail. Would Activity show search→read adapting without `huntWriteReject` owning the turn? If no, fail. Would empty preferredHits still produce 10 searches / 0 reads? If yes, fail (rails attach/preferred + streak cap).

### Dogfood after ship

Same table as product prompt (T2, T2b, C2, C2b, L3, Tripwire). Pass smell = planTurn-visible search+read adapting, not fixed parade then miss.

---

## Appendix — Research notes (verify while implementing)

- `runOwnedLoop` reject: brief injection ~353–365; seed ~479–501; planTurn loop ~505+; attach ~808; auto-read ~845; lastChance preferred-only ~932; finish jump ~1043; finish miss ~1174.
- `huntWriteReject` only intended for `runDeterministic` ~1588; still imported into live risk via invalid fallback ~524.
- Session: `plannedSearchQueries` capped 4 + `intentBrief` + jobs into `planAgentToolTurn` ~4922–4968.
- `AGENT_MAX_TOOL_ROUNDS = 8` — enough for a parade if every round is search.
- Comment debt: options still say “Empty/omitted → invent + fallbackAgentSearchQueries fail-open” — true for deterministic; misleading for live planTurn path until Step A/B land.
