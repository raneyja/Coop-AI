# Intent quarterback — first-layer brain for every chat ask

Paste this **entire file** into a **new** agent chat. Prior threads shipped locate ranking, calm-vs-reject gates, and noise skips. Do **not** reopen those as the main job unless a test proves regression.

This thread builds the missing product layer we under-scoped: an **interpretive intent quarterback** that runs **first** on (nearly) every user ask, understands purpose on **novel** wording, plans gather (tools + **code search criteria** invented for *this* turn), then hands off to today’s search / agent / synthesis machinery.

**Do not** build another slogan bank (`get("parent")`, Plane-only strings, dogfood phrase special-cases). Predetermined term lists are whack-a-mole. The quarterback must generalize.

---

## Product law (non-negotiable)

### What the quarterback is

**intent agent = lane / tools / search criteria (invented per ask) / job decomposition**

User pastes anything (one line, four sentences, two paragraphs, never seen before) →

1. **Interpret** — purpose, what “done” looks like, urgency/sentiment only if useful  
2. **Decompose** — sub-jobs X, Y, Z inside the paste (compound asks)  
3. **Plan gather** — which tools; which **index / integration search criteria** for *this* ask; what evidence class would count as success  
4. **Execute** — existing search, rank/skip, agent tools, prefetch, synthesis  
5. **Answer** — evidence-bound only  

This is a **modern agent quarterback**, not a classifier that maps English onto a closed set of dogfood playbooks.

### What the quarterback is not

| Reject | Prefer |
|--------|--------|
| Hardcoded query lists as the brain for reject/locate | Model (or strong interpreter) invents terms for *this* ask |
| Silent Blast / Owner / Trace / Gaps / Understand from plain English | Explicit slash / Workflows / grid `quickAction` only |
| Inventing paths or “open apps/api for me” | Attached evidence or short honest miss |
| Replacing rank/skip/finish honesty with prompt-only vibes | Quarterback plans; **runtime rails** still enforce |
| Special-casing `plane`, `CoopAI-Corp`, one filename | Repo-agnostic classes and rails |

### Additive + fail-open

- **UX and pipelines stay.** Same chat, agent loop, integrations, slash commands.  
- Quarterback is a **first layer** that improves planning.  
- If planning fails, times out, or returns garbage → **fail open to today’s behavior** (existing extract/fallback/reject list). Never brick a turn.  
- Reject hunts today **bypass** the model and use a fixed list — this thread **upgrades that brain** (with fail-open), it does not only wrap it.

### Do not weaken

- Plain chat must not promote (`.cursor/rules/plain-chat-must-not-promote.mdc`)  
- Calm locate vs API-reject gate (`isApiRejectAsk` / `isLocateWithoutRejectComplaint`) — L3 must not enter ValidationError hunt  
- Soft gather / start-answering ~15s (`.cursor/rules/response-latency.mdc`) — planning call must be **cheap**; never abort turn solely at 15s  
- Evidence-bound short answers; Zero-Clone; code-host parity; Boris bar  

---

## Why this session exists (from live dogfood + product discussion)

### What already Passes (keep green)

| Ask class | Example | Status |
|-----------|---------|--------|
| Calm API key auth locate | “Where is API key / request authentication defined in this repo?” | Pass |
| Calm backend state locate | “Where do work-item states live in the backend?” | Pass |
| Compound auth + states (L3 / Tripwire wordings) | Auth + StateSerializer | Pass / soft Pass |
| Calm vs reject tripwire | Compound auth+state must **not** be ValidationError-first | Pass |

### What Failed (motivating use case — not the only design target)

| ID | Ask (exact) | Fail |
|----|-------------|------|
| **C2** | `Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?` | Canned miss after scripted hunt |
| **T2** | `A client sent a parent that isn’t in this project — the API returns an error. I don’t have this repo cloned. Where does the API reject a bad parent issue_id?` | Same canned miss |

**Root cause class:** Reject path uses `huntWriteReject` + fixed `apiRejectSearchQueries` / `get("field")` order; **intent planner never feeds code index queries**; free agent loop was bypassed on purpose after wrong-building hunts. Scripted term order ≠ interpretive quarterback.

**Create-issue repo-wide locate** is **out of scope** as a Pass/Fail gate (too vague). Do not spend the thread on it.

### Realistic customer bar

A staff engineer pastes a **novel** on-call paragraph. Quarterback must invent sensible gather criteria without us having dogfooded that exact sentence. Rails ensure reject-shaped jobs still prefer write/reject evidence and do not invent paths.

---

## Current architecture (verify in research — do not assume)

You must **open and map** these areas (siblings welcome; this list is a starting choke map):

### Intent / front door

| Area | Likely paths |
|------|----------------|
| Plan types | `src/chat/intentPlanner/types.ts` |
| Rules planner | `src/chat/intentPlanner/planChatIntent.ts` |
| Model planner | `src/chat/intentPlanner/planChatIntentModel.ts` |
| Jobs / terms | `src/chat/intentPlanner/planChatJobs.ts` |
| Front door merge | `src/chat/intentPlanner/frontDoor.ts` |
| Gates / docs | `src/chat/intentPlanner/gates.ts`, `docs/engineering/chat-intent-planner-gates.md` |
| Routing into agent | `src/chat/agentRouting.ts`, `src/chat/CoopChatSession.ts` (intentPlan → agent options) |

**Today’s intent job (under-scoped):** lane / tools / integration topic terms; **does not search or answer**; prefers workflow `none` on unconstrained English. Locate `jobs[].terms` exist but are **not** the brain for `huntWriteReject`.

### Agent / reject hunt (bypass)

| Area | Likely paths |
|------|----------------|
| Short-circuit | `AgentOrchestrator` — `isApiRejectAsk` → `huntWriteReject` → finish (**skips** `planTurn` loop) |
| Query lists | `src/api/agent/searchQuery.ts` — `apiRejectSearchQueries`, `fallbackAgentSearchQueries`, `extractAgentSearchQuery` |
| Rank / skip | `pickSearchHitsToRead`, `shouldSkipEvidencePath`, `evidencePathNoise.ts` |
| Finish / miss | `API_REJECT_HUNT_MISS`, `contextHasWriteReject`, locate grounding helpers |
| Fixtures | `src/api/agent/dogfoodContract.ts` |

### Rails to preserve (not delete)

- `isApiRejectAsk` / calm locate gate  
- Client UI / noise skips for reject  
- Evidence-bound finish; strip please-open for attached paths where relevant  
- Soft gather budget  

---

## Target architecture

```
User message
    → Intent quarterback (ALWAYS first, fail-open)
         outputs: purpose, sub-jobs[], tools[], searchCriteria[] (per job),
                  evidenceClass hints, confidence
    → Existing execution
         integrations prefetch | agent hunt | search_code/read_file |
         rank/skip/jump | synthesis
    → Answer (evidence-bound)
```

### Quarterback output contract (design in research; implement precisely)

Define a **stable, typed** plan shape (extend `ChatIntentPlan` / jobs — do not invent a parallel orphan plan unless research proves necessary). Minimum capabilities:

| Field | Meaning |
|-------|---------|
| Purpose / done-looks-like | Short; for debug + synthesis grounding |
| Sub-jobs | Ordered list; compound pastes become multiple jobs |
| tools[] | Unchanged semantics |
| Per-job search criteria | **Invented for this ask** — code index queries and/or integration topics |
| Evidence class hint | e.g. write-reject vs definition-locate vs decision/docs — **hints for rails**, not workflow promotion |
| confidence | high/medium/low → drives fail-open aggressiveness |

**Explicit workflow** still only from slash / Workflows / grid. Quarterback may note “blast-shaped” for evidence expectations; it must **not** set `execution: silent` / run-workflow on unconstrained English.

### How reject hunts change

| Before | After |
|--------|--------|
| Fixed query list is the brain | Quarterback `searchCriteria` for the reject job run **first** |
| Then forever slogans | Keep **short backup** list only as fail-open / pad |
| Bypass all model planning | One cheap plan up front (reuse intent model path if fit; do not stack 15s calls) |

Rank/skip/jump/finish stay. Rails still require a write-reject body (or honest miss) for reject-class jobs.

### How calm locate changes

Quarterback may supply better locate criteria (auth class, state definition). Existing L1/L2/L3 ranking/skip remain. Compound asks: plan **both** halves; finish gates that require both grounding stay.

---

## Mandatory workflow (do not skip steps)

### Phase 0 — Align (short)

Re-read this prompt + `.cursor/rules/plain-chat-must-not-promote.mdc` + `docs/engineering/chat-intent-planner-gates.md`. Confirm additive + fail-open + no silent workflow promotion.

### Phase 1 — Research (thorough)

1. Trace **one full turn** from composer send → intent plan → gather → agent/reject → answer. List every file that reads or writes intent.  
2. Map **all** call sites of `huntWriteReject`, `apiRejectSearchQueries`, `locateJobTerms`, `planChatIntentModel`, `shouldRunAgentToolLoop`.  
3. Inventory what planner terms already affect (Slack/Jira/docs) vs what they **never** reach (reject hunt).  
4. Produce an **impact table**: file → current role → keep / extend / replace / do-not-touch.  
5. Find siblings (admin mirrors, tests, gates, prompts).  

**Deliverable:** Research notes + impact table in the chat (and optionally a short plan doc only if needed for the build — prefer chat-visible table).

### Phase 2 — Strategic plan

Write a build plan that states:

| Section | Content |
|---------|---------|
| Add | Quarterback first-layer behavior, typed fields, wiring into hunt/gather |
| Keep | Rails, calm-vs-reject, noise skip, fail-open fallbacks, explicit workflows |
| Change | Reject short-circuit consumes planned criteria; prompt for interpreter quality |
| Remove / stop using as brain | Hardcoded query lists as primary brain (backup only) |
| Non-goals | Create-issue gate; silent quick actions; Plane special-cases; full agent rewrite |
| Latency | One cheap plan; remaining soft gather budget |
| Risk register | Bad terms, over-fetch tools, L3 regress to reject, planner latency |

### Phase 3 — Plan review (gap hunt)

Before writing production code:

- Walk the plan against anti-patterns below  
- Identify slim reasoning, missing call sites, test holes  
- Fix the **plan** first  
- Explicitly answer: *Would a novel T2-shaped ask (unseen wording) get good criteria without a new slogan?* If no → plan is wrong  

### Phase 4 — Implement

- Minimal diffs; match repo conventions  
- Prefer extending intent planner + one wiring path into agent hunt over a third parallel “brain”  
- Fail-open everywhere planning can fail  
- Update gates/tests alongside code  
- **Do not commit** unless the user asks  

### Phase 5 — Test (automated)

Must be green before dogfood handoff:

| Suite / focus | Pass means |
|---------------|------------|
| Intent planner gates | No silent workflow on unconstrained English |
| `isApiRejectAsk` / calm locate | L3 / Tripwire still not ValidationError-first |
| Reject hunt with **mocked** planner criteria | Planned terms searched before / instead of useless primary; still fail-open |
| T2 / C2 class fixtures | With synthetic index hits matching real reject shapes, attach write-reject (not canned miss when hit exists) |
| L1 / L2 / compound | Still prefer auth enforcement + state definition |
| `noRepoSpecificRules` | No plane/product path special-cases in ranking |
| Lint | `npm run lint` if touching types/clients across packages |

Add new unit tests that prove **novel wording** (paraphrase of T2/C2, not only exact fixtures) still classifies reject and benefits from planned criteria — without hardcoding the paraphrase in product code (test-only strings OK).

### Phase 6 — Production-grade review

Self-check Boris bar:

- Wired end-to-end on hot path (not orphaned planner fields)  
- Fail-open tested  
- Latency: no stacked long model calls on gather  
- No prompt-only “prefer Django” without wiring  
- Staff engineer would trust novel on-call paste  

### Phase 7 — Handoff for Jon dogfood

Return:

1. What shipped (short)  
2. Impact table summary  
3. Automated Pass/Fail table  
4. **Exact paste asks** for Extension Host (reload first), including paraphrases  
5. What must still Fail-open looks like if planner is down  

**Do not commit unless asked.**

---

## Dogfood Pass/Fail (Jon re-runs after ship)

Use-repo as noted; **reload Extension Host** first; one ask per turn.

### Plane (no file chip)

| ID | Ask | Pass | Fail |
|----|-----|------|------|
| T2 | Exact `COPILOT_T2_ASK` from `dogfoodContract.ts` | Attaches parent ValidationError / equivalent write-reject; cites it | Canned miss when reject exists in index; UI/noise story |
| T2b | Paraphrase (novel): e.g. “API 400 when the parent issue isn’t in this project — where is that rejected?” | Same evidence class | Script-only miss / wrong building |
| C2 | Exact `COPILOT_C2_ASK` | Server state write/reject (project state validation OK — need not be a literal FSM “transition”) | Canned miss; icons/hooks |
| L3 | Auth + states defined on server | Both halves from read evidence | Auth only; reject playbook |
| Tripwire | Auth + states live in backend | Both halves; not ValidationError-first | Regress |

### Coop-AI (optional spot-check)

| Ask | Pass |
|-----|------|
| `Where is requireAuth or authentication middleware defined in this repo?` | Still implementation, not mention-only |

### Explicit workflow still explicit

Plain English must **not** silently run `/blast` / Owner / etc. Prove with an existing plain-chat-must-not-promote gate or equivalent test.

---

## Anti-patterns (reject the design if present)

- Predetermined slogan bank as the quarterback  
- Special-casing plane / CoopAI-Corp / one OpenAPI path  
- Silent quick-action promotion from English  
- Removing calm-vs-reject gate  
- “Always call a big model” with no fail-open / budget  
- Orphaned plan fields never read by hunt/gather  
- Prompt-only fix with no wiring into `huntWriteReject` / gather  
- Local disk / workspace walk (Zero-Clone)  
- Claiming Pass without automated tests for fail-open + no-promote + T2-class attach  

---

## Suggested implementation sketch (validate; do not cargo-cult)

1. **Research** whether to extend `ChatIntentJob.terms` vs add `searchCriteria[]` / evidence hints on the plan.  
2. Strengthen interpreter prompt: for code jobs, emit **index-ready** criteria (symbols, ValidationError-shaped phrases, field names **derived from the user text**), not Slack chit-chat topics.  
3. Wire `AgentOrchestrator.huntWriteReject` (and calm locate search entry) to prefer planned criteria when present; else existing fallbacks.  
4. Keep `isApiRejectAsk` as rail for evidence class / finish — not as the only term inventor.  
5. Cap planning tokens/time; fail-open.  
6. Tests: planner emits criteria for T2-shaped asks; hunt uses them; L3 still calm; garbage plan → fallback list still runs.

---

## Deliverable checklist (agent → Jon)

- [ ] Research impact table (files keep/extend/replace)  
- [ ] Plan reviewed for gaps  
- [ ] Implementation merged in working tree (no commit unless asked)  
- [ ] Automated Pass/Fail table  
- [ ] Exact Extension Host dogfood list  
- [ ] Note residual risks  

---

## Boris bar

Would a staff engineer paste a **never-before-seen** on-call paragraph and trust Coop to invent search criteria, stay in the right evidence class, and answer from attached rejects/definitions — without us having dogfooded that sentence? If the system still only works when the ask matches a slogan list, you are not done.
