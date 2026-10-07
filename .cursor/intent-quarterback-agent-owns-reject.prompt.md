# Intent quarterback — agent owns reject gather (subtract rails, then agentic)

Paste this **entire file** into a **new** agent chat.

**Product bet:** Copilot-mixed — thin durable rails for modes / security / latency / honesty; **agentic gather** for repo search. Do not grow foresight rails (“if they say create/update, prefer path X”).

Prior 48–72h added ~3k lines of reject seeds / lastChance / matchers / tests while live dogfood still Failed or froze on the wrong sibling. This thread **subtracts script brain** and completes **agent-owned gather**. Adding more slogan/matcher/path special-cases is Fail for this job.

Do **not** commit unless the user asks.

---

## Product law (non-negotiable)

### Target shape

```
User ask
  → Thin router (mode / slash / security / soft gather clock)
  → Intent quarterback (job brief + evidence class + done-looks-like;
       optional searchCriteria 2–4 as HINTS only — not executed as the brain)
  → Agent tool loop (planTurn): search → read → search again under budget → compare
  → Thin finish rails (attach-before-miss, jump wrong-floor, evidence-bound answer / short miss)
```

| Layer | Owns | Must not own |
|-------|------|----------------|
| Thin rails | Modes, auth, soft ~15s start-answering, Zero-Clone, evidence-bound honesty, calm-vs-reject label | Which twin file wins; 12-query scavenger |
| Quarterback | Job brief + evidence class | Executing search parades; silent Blast/Owner/Trace |
| Agent loop | Next `search_code` / `read_file` from results; multi-hit under clock | Inventing paths; UI essays with no body |
| Finish rails | Attach if snippet already is reject; in-file jump; short miss when exhausted | Freezing on first raise forever; path hardcoding |

### One-line law

**You own the bar; the agent owns the hunt.**

### Subtract before add

Every change in this thread must answer: **what hunt rail did we delete or demote?** Prefer net **smaller** `AgentOrchestrator` / `searchQuery` reject surface. If a live Fail would be fixed only by a new `if (create/update)` / Plane path rule — **do not**. Fix gather or demote the freeze.

---

## Why this session exists (live proof)

Use-repo: indexed **plane** (`CoopAI-Corp/plane`), branch `preview`, no file chip.

| Ask / moment | What happened | Lesson |
|--------------|---------------|--------|
| Exact Parent / T2 earlier | Keyword parade → canned miss / wrong noise file | Script brain / slogan hunt |
| Exact Parent after quote-first | Quote searched; **reads happened**; cited raise in **`draft.py`** | Progress — but **first attach won**; ask said create/update |
| Symbol locate control | `IssueCreateSerializer` → 1 search, 1 read | Index + agent read work when gather is simple |
| Paraphrases / C2 | UI or bgtask only → padded miss | Thin evidence + scavenger burn |

**Architecture hole:** Reject gather still dominated by seeds / lastChance / first-attach-wins / slogan pad — even when `planTurn` is invoked. Removing early-return alone is not enough.

**Out of scope as Pass/Fail:** invent-regex polish; Plane-only path special-cases; growing `askedReject*` catalogs.

---

## Multi-hit gather (agentic — required behavior)

Not “hardcode draft loses to issue.” Instead:

1. Search → may get a hit.  
2. While soft gather budget remains: **may search/read again** (especially if first hit is weak, noise, or only one sibling).  
3. Empty / slow second attempt → come back with what you have (1 candidate is OK).  
4. Compare shortlist (parallel reads OK, cap ~2–4) → cite best match for the **ask’s job words**, or short miss.  
5. Do **not** freeze forever on the first raise if budget remains and the ask is unmatched.

Thin clock stays: soft gather (~15s start-answering guideline) — never abort the turn solely at 15s; synthesize with partial evidence. AbortSignal = user Stop only.

---

## Remove / demote checklist (do these — do not expand)

### Demote (fail-open crumbs only; not live brain)

| Symbol / site | After |
|---------------|--------|
| `huntWriteReject` | **Only** when `planTurn` is missing. Never resurrect on first invalid/throw when `planTurn` was supplied. |
| `seedRejectPlannedSearches` | Prefer **0** pre-loop executed searches on live reject. Criteria belong in the brief as hints. If seed remains temporarily: ≤1–2 max, then shrink. |
| `mergePlannedAgentSearchQueries` + `inventAskDerivedSearchCriteria` + `fallbackAgentSearchQueries` / `apiRejectSearchQueries` | Fail-open / no-`planTurn` pad only. Must not drive live Activity parade. |
| `lastChanceAskedRejectQuoteSearch` / slogan-style lastChance | Demote or delete; do not grow. Prefer one attach pass over unused evidence, not a second scavenger. |
| `rejectQuoteBodyScanSeeds` / `rejectQuoteBodyPathQueries` as turn owner | Optional agent hint or fail-open only — not a hardcoded “always run these then stop.” |
| Pre-loop execution of quarterback `searchCriteria` | Hints in prompt/brief only. |

### Keep (thin durable — do not delete)

| Keep | Why |
|------|-----|
| `isApiRejectAsk` as **label** | Evidence class / calm-vs-reject; not script owner |
| Soft gather / wall budgets | Latency |
| Evidence-bound finish | Honesty |
| Plain chat must not promote | Modes |
| `attachRejectFromSearchHits` / snippet attach | Attach-before-miss product law |
| In-file jump (`readWriteRejectInSameFile` etc.) | Right file, wrong floor |
| `decorateToolResult` fail-open so actionable hits aren’t zeroed | Prevent 0-read canned miss with evidence in hits |
| `noRepoSpecificRules` / code-host parity / Zero-Clone | Scale + product law |

### Do not add

| Banned in this thread | Why |
|----------------------|-----|
| New invent/slogan banks as the main fix | Re-owns gather |
| `plane` / `CoopAI-Corp` / `draft.py` vs `issue.py` hardcoding | Foresight tax; won’t scale |
| New `askedReject*` branches per dogfood Fail | Matcher treadmill |
| Prompt-only “please keep searching” without loop/budget behavior | Already failed |
| Claiming “fixed” from unit green only | Ship-claim discipline |

### Net-size gate

After implementation: reject-hunt helper surface in `AgentOrchestrator.ts` / `searchQuery.ts` should be **net flat or down** vs starting uncommitted pile where possible. Growing lastChance + seed + invent together = Fail this job even if tests pass.

---

## Mandatory implementation (ordered — do not reorder)

### Step 0 — Inventory + subtract plan

List every live reject path that still executes searches without `planTurn` choosing them. Mark each: keep / demote / delete. Share a short keep/demote table before large edits.

### Step 1 — Cut script ownership (choke)

- Reject asks with `planTurn`: **agent loop owns gather**. No early-return into `huntWriteReject`. No resurrection via invalid first plan → full hunt.
- `isApiRejectAsk` stays for finish / skip / evidence class only.
- Fail-open (no `planTurn`): small seed + finish — **not** 12-slogan default.

### Step 2 — Multi-hit under clock

- After first attachable raise: if soft budget remains and ask job not clearly matched, allow **another** search/read pass before finish.
- Cap shortlist (~2–4). Parallel reads OK.
- Do not freeze on first hit as the only success path when budget remains.
- Do **not** implement “prefer issue.py over draft.py” as a path rule.

### Step 3 — Finish rails only (right file / wrong floor + unused evidence)

- Jump before miss when serializer/server-write opened without reject in window.
- Attach-before-miss when hit snippet already has asked ValidationError / quote.
- No `API_REJECT_HUNT_MISS` while unused reject snippets or unjumped preferred serializers remain.
- UI-only → short miss — never speculative backend essay.

### Step 4 — Quarterback brief into loop

Wire purpose / jobs / evidenceClass / done-looks-like / optional criteria **as hints**. No silent `run-workflow`. One cheap quarterback call max on hot path.

### Step 5 — Tests then dogfood handoff

See Pass/Fail below. Update/remove tests that **required** scavenger-as-only-path. Add proofs for: `planTurn` called; no hunt resurrection; multi-hit / no freeze when budget left (mocked); attach-before-miss; calm L3≠reject-first; `plainChatMustNotPromote`; `noRepoSpecificRules`.

### Step 6 — Do not commit unless asked

---

## Pass / Fail criteria (success bar)

Use claim tiers. **Automated green ≠ live Pass.**

### Gate A — Automated Pass (required before Reload handoff)

All must be true:

| Proof | Pass | Fail |
|-------|------|------|
| Bypass | Reject + mocked `planTurn` → `planTurn` **is called** | Early-return / only `huntWriteReject` |
| No resurrection | `planTurn` supplied + first invalid/throw → **not** full `huntWriteReject` parade | Scavenger returns as owner |
| T2 wrong floor | Serializer hit wrong line; body has parent reject → attach, not canned miss | Miss after opening right file |
| Attach-before-miss | Hit snippet has ValidationError/quote; body fetch empty → still attach | Miss with unused snippet |
| Continue / multi-hit | First noise or weak hit; later reject attaches **or** second pass attempted under budget | Freeze after first useless hit with budget left; or slogan parade only |
| UI-only | Web-only evidence → short miss | Speculative serializer essay |
| Calm | L3 / Tripwire / auth+state **not** ValidationError-first | Reject playbook hijack |
| Product gates | `plainChatMustNotPromote` + `noRepoSpecificRules` Pass | Silent promote or Plane path special-case |
| Subtract | Demote/delete checklist items addressed; no new slogan bank as main fix | Net new scavenger surface as “the fix” |
| Lint | `npm run lint` if types/clients touched | Typecheck red |

**Founder phrase at Gate A:** “Automated Pass. Ready for your Reload dogfood — live Pass still open.”

### Gate B — Ready for Reload

Gate A green **and** handoff includes: exact paste asks, Use-repo/branch/chip, Pass vs Fail columns below. No “fixed” language.

### Gate C — Live Pass (only this = product fixed)

**Setup (every ask):** Extension Host Reload → Use-repo `CoopAI-Corp/plane` → branch `preview` → **no file chip** → **fresh thread** → one ask per turn.

#### Required live suite

| ID | Paste | Pass (all required) | Fail (any one) |
|----|--------|---------------------|----------------|
| Parent | Exact `LIVE_PARENT_PASS_ASK` from `dogfoodContract.ts` | Cites Parent ValidationError; Activity shows **read/attach** of a **create/update issue** raise site (`serializers/…/issue.py` or equivalent create/update serializer — **not** only `draft.py`); stops after cite — no padded essay | Canned miss; 0 reads; only `error_codes` / UI; **only draft sibling** when ask said create/update; search-only parade |
| T2 | Exact `COPILOT_T2_ASK` | Same evidence class: attached parent write-reject cite | Canned miss; UI-only essay |
| T2b | `API 400 when the parent issue isn’t in this project — where is that rejected?` | Same class; no essay from `parent-tag.tsx` alone | UI essay; miss when reject exists in index/body |
| C2 | Exact `COPILOT_C2_ASK` | Server state/transition write-reject attached | bgtask/types only then canned miss |
| C2b | `Work item stuck in backlog — API 400 on state change. Where does the server reject a bad state_id?` | Same reject class | Script-only miss |
| L3 | Exact `API_AUTH_AND_STATE_SERVER_LOCATE_ASK` | Auth + state from **read** evidence; not ValidationError-first | Auth only; reject scavenger |
| Tripwire | Exact `PLANE_LOCATE_AUTH_AND_STATE_ASK` | Both halves; not ValidationError-first | Reject-first |

Optional (Coop-AI Use-repo): `DOGFOOD_HUNT_QUESTION` — symbol/middleware locate still works (control that agentic cut didn’t brick calm hunt).

#### Activity smell

| Pass smell | Fail smell |
|------------|------------|
| `planTurn`/adapting search+read; possible second pass after first hit | Fixed 8–12 slogan queries then miss |
| ≥1 meaningful read/attach of write-reject | 0 reads with unused hit snippets |
| If twins exist: create/update cited when ask said so, **or** shortlist compared then best chosen — without hardcoded path table | Freeze on first raise regardless of ask |

#### Twin / multi-hit honesty (Parent)

| Outcome | Verdict |
|---------|---------|
| Cites create/update issue serializer raise | **Pass** |
| Cites only draft while ask said create/update, budget left unused | **Fail** |
| Finds only one raise after budgeted second attempt → cites it and says limits honestly | Acceptable **partial** — say so; not full Gate C Parent Pass |
| Hardcoded “always skip draft.py” | **Fail this architecture job** even if Parent greened |

### Claim language (mandatory)

| Tier | Say |
|------|-----|
| A | Automated Pass |
| B | Ready for your Reload dogfood — live Pass still open |
| C | Fixed / live Pass — only after named asks above |

**I will not call this fixed until Gate C.**

---

## Research map (verify; extend)

| Area | Paths |
|------|--------|
| Script vs agent | `AgentOrchestrator.ts` — `runOwnedLoop`, `seedRejectPlannedSearches`, `huntWriteReject`, `planTurn` fail→deterministic, `canAnswerNow`, finish miss |
| Multi-hit / attach | `attachRejectFromSearchHits`, jump helpers, `lastChance*`, `rejectQuote*` |
| Query banks | `searchQuery.ts` — `apiRejectSearchQueries`, `inventAskDerived*`, `mergePlannedAgentSearchQueries`, `isApiRejectAsk` |
| Session | `CoopChatSession.ts` — `runAgentOwnedTurn`, planned criteria → brief |
| Quarterback | `intentPlanner/*` |
| Fixtures | `dogfoodContract.ts` — `LIVE_PARENT_PASS_ASK`, T2/C2/L3/Tripwire |
| Gates | `plainChatMustNotPromote`, `noRepoSpecificRules`, ship-claim-discipline |
| Prior planning | `.cursor/plans/gap-03-agent-owned-gather.md`, `gap-04-finish-attach-rails.md` (history — this prompt wins on conflict) |

---

## Phase checklist

0. Align on subtract-first + agentic multi-hit; no path hardcoding.  
1. Inventory keep/demote/delete; confirm no hunt resurrection sites.  
2. Implement Steps 1→3 with **net demotion**.  
3. Gate A tests green + lint if needed.  
4. Handoff Gate B (Reload list).  
5. Jon runs Gate C — only then “fixed.”

---

## Boris bar

Would a staff engineer paste a never-before-seen on-call reject paragraph and trust Coop to **brief the job**, let the **agent** search/read/search-again under a clock, attach write-reject evidence (or short miss), without a slogan list or path table owning the turn — and without freezing on the first twin? If Pass still requires foresaw rails or `huntWriteReject` order, **you are not done**.
