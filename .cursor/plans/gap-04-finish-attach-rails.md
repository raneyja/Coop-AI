# Gap 04 — Finish / attach rails (correct subordinate enforcers)

**Agent:** 4 of 5 · **Mode:** planning only (no code fixes, no commits)  
**Date:** 2026-09-29  
**Stance:** Skeptical of “we already fixed that.” Unit tests cover several dogfood Fail classes; live holes and incomplete wiring remain.

---

## 1. Gap statement

Finish / attach / rank rails are **necessary** so reject hunts cannot invent paths or ship fluff when evidence is thin. They became **incorrect and whack-a-mole**: each dogfood Fail added a local patch (`attachRejectFromSearchHits`, preferredHits fail-open, quote matcher, in-file jump, Use-repo branch on read) without a single **evidence-ledger → miss-forbidden** contract.

**Product law (rails):**

| Must | Must not |
|------|----------|
| Block `API_REJECT_HUNT_MISS` while unused reject evidence exists (hit snippet, attached body, or unjumped preferred serializer/server-write) | Invent paths or pad “backend probably…” from UI-only |
| Attach from Zoekt snippet when body fetch fails | Require remote body as proof of evidence |
| Jump in-file before abandoning a preferred write path | Treat “opened wrong floor” as miss |
| Emit short honest miss when gather exhausted with no reject class | Grow into another query-slogan / path-special-case brain |

**Rails are subordinate enforcers**, not the gather brain. Agent 3 owns `planTurn` gather; this gap owns **when miss is legal** and **when evidence must be promoted into `read_file` context**.

---

## 2. Fail-class catalog (past dogfood + likely next)

### Past dogfood (2026-09-29) — status after current tree

| ID | Fail class | What happened | Code choke | Status (skeptical) |
|----|------------|---------------|------------|--------------------|
| F1 | Right file, wrong floor | Opened `serializers/issue.py` at class / wrong validate; canned miss | `loadWriteRejectWindow` / finish jump rail (~1043–1090) / mid-loop jump (~682–700) | **Partially fixed** — tests for T2 wrong-floor + live Plane fixture exist. Remaining: finish candidates gated on `isServerWritePath` only (mutation-only trees without `/api|server|backend|svc/` skipped at finish); `rejectJumpAttempted` written but never consulted. |
| F2 | `preferredHits` emptied | Rank/skip emptied preferred → auto-read idle → 10× search / 0 reads | `decorateToolResult` fail-open (~2642–2660); loop fallback `hits = parsed.hits` (~841–844) | **Partially fixed** — fail-open restores server-write **or** asked-field reject only. Does **not** restore wrong-field serializer kept by `pickSearchHitsToRead` for jump. **No orchestrator test** that preferred was empty then fail-open forced a read. Seed path (`seedRejectPlannedSearches`) ignores raw hits when preferred empty. |
| F3 | Hit already was ValidationError | Index snippet unused; finish assumed no body = no evidence | `attachRejectFromSearchHits` after `search_code`; empty-body branch in `readFirstMatchingHit` | **Partially fixed** — unit test with `readRemoteFile → undefined` + quoted ask Pass. Attach **not** called from `seedRejectPlannedSearches` / `huntWriteReject`. Finish does **not** re-scan search hits before miss (see F6). |
| F4 | Zoekt message-only line | Matcher required `raise` / `ValidationError` | `contentIncludesAskedRejectQuote` / quote branch in `contentLooksLikeAskedFieldReject` | **Narrowly fixed** — works when ask contains a ≥12-char quoted string. **Still Fail** for paraphrase asks **without** quotes + message-only Zoekt line (no raise keywords). |
| F5 | `read_file` without Use-repo branch | Wrong ref / empty / wrong floor | `extension.ts` `readRemoteFile` → `resolveActiveRepoTarget` | **Likely fixed for Extension Host wiring**. Remaining: tool args still omit explicit `branch`; any other `readRemoteFile` caller that skips resolver can regress. No test that agent read uses indexed branch. |

### Likely next Fail classes (not yet proven in dogfood, high prior)

| ID | Fail class | Why it will bite | Where |
|----|------------|------------------|-------|
| F6 | **Unused hit after later search** | `mergeContext(search_code)` **replaces** prior hits. Attach only runs on current search. If search₁ had reject but matcher missed / attach skipped, search₂ overwrites — finish never re-scans search₁. | `mergeContext` search overwrite; `finishWithAnswer` only checks `read_file` |
| F7 | **Finish miss while preferred still actionable** | Finish jump only if `isServerWritePath`. Preferred serializer under `app/serializers/` (no `api/`) never entered into finish candidates. Mid-loop jump may have been skipped if model never `read_file`’d. | Finish rail candidate set (~1050–1066) |
| F8 | **Seed / deterministic attach gap** | Optional seed + no-`planTurn` `huntWriteReject` open preferred only; no `attachRejectFromSearchHits`; preferred-empty continues. | `seedRejectPlannedSearches`, `huntWriteReject` |
| F9 | **Unquoted field-shaped error line** | Zoekt returns `Parent is not valid issue_id…` without raise; ask has no quotes → `contentLooksLikeWriteReject` false → attach refuses. | `contentLooksLikeAskedFieldReject` after quote branch |
| F10 | **UI-only / thin attach → essay** | If ask **not** classified `isApiRejectAsk`, finish won’t force `API_REJECT_HUNT_MISS`; model streams speculative backend from `parent-tag.tsx`. Even on reject: `customerFacingAnswer` does **not** replace speculative reject essays (only intern-speak / zero-hits). | Calm-vs-reject (Agent 3) + finish fluff gate (this gap for reject-class only) |
| F11 | **`action === "change"` bypass** | `finishWithAnswer` skips canned miss when `action !== "change"` is false — reject-shaped change turns can stream without write-reject attached. | `finishWithAnswer` ~1177–1185 |
| F12 | **Prune false-negative** | `pruneContextToWriteReject` runs **before** miss check. If attached body is reject but matcher/prune disagree (numbering, field window, job token), files emptied → miss despite open evidence. | `pruneContextToWriteReject` + `filterWriteRejectFiles` |
| F13 | **SkipNote wipe before finish jump** | Mid-loop: jump fail + no asked reject → replace body with `skipNote`, merge into context. Finish may still jump via preferred path, but attached wrong-floor body is gone; if finish candidate set incomplete → miss. | Mid-loop ~693–700 |
| F14 | **lastChance preferred-only blind** | Reject lastChance reads `preferredHits` only — no raw hits, no snippet attach pass. | `lastChancePreferredHitsOnly` |
| F15 | **Branch drift outside Extension Host** | Tests inject `readRemoteFile` directly; CI never proves `resolveActiveRepoTarget` on agent read. Alternate hosts / admin runners may omit resolver. | `extension.ts` vs test mocks |

### Explicit non-goals as Fail gates

- Create-issue locate quality (Agent 3 / other gaps).
- Inventing better slogan query lists.
- Plane path special-cases.

---

## 3. Rail inventory (keep / fix / delete)

### Paths to `API_REJECT_HUNT_MISS` (complete)

Only **one emission site**:

```
finishWithAnswer
  → isApiRejectAsk
  → pruneContextToWriteReject
  → !contextHasWriteReject (after prune)
  → action !== "change"
  → answer = API_REJECT_HUNT_MISS
```

Constant: `AgentOrchestrator.ts` ~97–98, return ~1177–1184.

**Implied miss paths** (same string, same gate):

| Trigger | How it reaches finish without reject |
|---------|--------------------------------------|
| Loop exhausted / `done` / wall / abort | `runOwnedLoop` → finish |
| `planTurn` invalid/prose without `canAnswerNow` | break → finish |
| Deterministic / no planTurn | `huntWriteReject` then finish (via `run` / fallback) |
| Seed + agent never attaches | finish |

`canAnswerNow` for reject = `contextHasWriteReject` — prevents early “done” prose, but **does not** block miss emission at finish.

### Keep (correct role — do not delete)

| Rail | Role |
|------|------|
| `isApiRejectAsk` / calm-vs-reject | Evidence **class** gate (not gather brain) |
| `shouldSkipEvidencePath` + client UI / noise / seeds / OpenAPI / filters | Skip noise reads on reject |
| `contentLooksLikeWriteReject` / `contentLooksLikeAskedFieldReject` / wrong-field | Evidence class matcher |
| `askedRejectFieldTokens` / `askedRejectJobTokens` | Field/job scoping (keep small; don’t grow slogan banks) |
| `attachRejectFromSearchHits` / `attachRejectSnippetPayload` | Promote index snippet → `read_file` evidence |
| `loadWriteRejectWindow` / `readWriteRejectInSameFile` | Right-file wrong-floor jump |
| Finish jump rail (concept) | Miss forbidden while unjumped preferred write paths remain |
| `decorateToolResult` preferredHits fail-open (concept) | Never empty actionable reject pool |
| `pruneContextToWriteReject` / `compactApiRejectConversation` | Writer sees reject bodies only |
| `API_REJECT_HUNT_MISS` copy | Honest short miss; no invented path |
| Extension `resolveActiveRepoTarget` on agent read | Branch parity with indexed search |
| `preferredHitsForLocate` **disabled** for reject (`locateVerdictApplies` false) | Avoid emptying reject pools via locate verdict |

### Fix (incorrect / incomplete)

| Rail | Problem | Fix direction |
|------|---------|---------------|
| Finish miss gate | Only inspects pruned `read_file`; ignores unused search snippets + incomplete jump candidates | Before miss: (1) attempt attach from **current** search hits; (2) jump all preferred/actionable write paths (`isServerWritePath` **or** `isMutationHandlerPath` / serializer class); (3) only then miss |
| `decorateToolResult` fail-open | Too narrow; seed path doesn’t share it | Fail-open = `isActionableApiRejectHit` ∪ asked-field ∪ server-write; share helper with seed/lastChance |
| Quote / message-line matcher | Quote-only attach for raise-less Zoekt | Add **field-shaped error string** heuristic (message line naming asked field + reject lexicon) without requiring ask quotes — keep false-positive bar high |
| Mid-loop skipNote replace | Drops body before finish can use it | Prefer keep body + mark exhausted, or ensure finish always re-fetches preferred paths |
| `rejectJumpAttempted` | Dead state | Either gate “already jumped, don’t re-burn budget” **or** delete |
| `mergeContext` search replace | Drops prior reject hits | For reject: keep a small **rejectHitLedger** (path+snippet) across searches, or attach-or-ledger before overwrite |
| `action === "change"` miss bypass | Can stream invent | Require write-reject for reject-class change **or** explicitly document change as out-of-scope for this rail |
| `customerFacingAnswer` | No reject fluff replace | Optional: if reject-class + only UI/noise attached → force miss copy (prefer finish gate over prose regex whack-a-mole) |
| Seed / `huntWriteReject` | No snippet attach; preferred-only | Call same attach helper as loop |
| `lastChancePreferredHitsOnly` | Blind to raw hits / snippets | Reuse attach-from-hits then preferred/raw reads |
| Branch | Untested | One regression: read uses indexed branch from Use-repo |

### Delete / demote (stop expanding as brain)

| Item | Why |
|------|-----|
| Growing `apiRejectSearchQueries` / slogan parade as Pass path | Agent 3 owns gather; rails must not re-own query lists |
| Plane / `CoopAI-Corp` / one OpenAPI path special-cases | Violates repo-agnostic rails |
| Prompt-only “please jump” without finish gate | Already failed in dogfood |
| Treating `huntWriteReject` as hot-path owner | Demoted to fail-open seed only — **keep demoted**; do not re-expand |

### Matcher inventory (askedReject*)

| Symbol | Keep / fix |
|--------|------------|
| `askedRejectFieldTokens` | Keep — qualifier stems; watch over-broad `state/backlog` |
| `askedRejectJobTokens` | Keep — invite/signup/… job gate |
| `askedRejectErrorQuotes` | Keep — exact quote path |
| `contentIncludesAskedRejectQuote` | Keep — F4 quoted case |
| `contentLooksLikeWriteReject` / line helpers | Keep — raise/throw/400/422; not message-only |
| `contentLooksLikeAskedFieldReject` | **Fix** — F9 unquoted message-only; job false-negatives |
| `contentLooksLikeWrongFieldReject` | Keep — sibling-field guard |
| `isActionableApiRejectHit` | Keep — align fail-open with this |
| `filterWriteRejectFiles` / `contextHasWriteReject` | Keep — single definition of “reject attached”; prune must not disagree with attach |
| `lineNumberOfWriteReject` / `lineNumberOfAnyWriteReject` | Keep — jump targeting |
| `preferredHitsForLocate` | Keep off for reject |
| `shouldSkipEvidencePath` | Keep — do not skip serializers that should jump |

---

## 4. Build plan (ordered hardening)

Do **not** reorder. Each step is a rail correctness fix, not a new gather brain.

### Step 0 — Contract (one function, one law)

Define a single helper, e.g. `unusedRejectEvidence(context, query) → { kind, path, snippet? } | null`:

1. Attached `read_file` body already asked-field reject → **none unused** (done).
2. Else any search hit (preferred ∪ hits ∪ **ledger**) matching asked-field / quote / field-shaped message → unused **snippet**.
3. Else any preferred / opened path that is server-write **or** mutation-handler/serializer and not yet successfully jumped → unused **jump**.
4. Else → null (miss allowed).

**Miss forbidden** iff step 2 or 3 non-null. Finish must resolve 2→attach, 3→jump, then re-check before emitting `API_REJECT_HUNT_MISS`.

### Step 1 — Finish gate = subordinate enforcer (choke)

In `finishWithAnswer` **before** canned miss:

1. If `unusedRejectEvidence` is snippet → `attachRejectSnippetPayload` (no remote required).
2. If jump → `readWriteRejectInSameFile` for each candidate (expand candidate set beyond `isServerWritePath`).
3. Re-run `contextHasWriteReject` (after prune, or prune after attach).
4. Only then emit `API_REJECT_HUNT_MISS`.

Acceptance: cannot unit-test “miss” while a hit string that `contentLooksLikeAskedFieldReject` accepts sits in `context.search_code`.

### Step 2 — Ledger across searches (kill F6)

On reject `search_code` merge:

- Before overwrite, scan outgoing + incoming hits for attachable reject; attach immediately **or** append to a small ledger on context (cap ~5 path+snippet).
- Finish Step 1 reads ledger.

Do **not** keep full search history in the writer prompt — ledger is for rails only; `compactApiRejectConversation` still strips to reject bodies.

### Step 3 — Attach parity on all gather entries

Call the same attach helper from:

- Loop after `search_code` (exists)
- `seedRejectPlannedSearches`
- `huntWriteReject` (fail-open only)
- `lastChancePreferredHitsOnly` (before giving up)
- Finish Step 1

Empty remote body + matching snippet → attach (already in `readFirstMatchingHit`; keep + extend to seed).

### Step 4 — preferredHits fail-open = actionable class

In `decorateToolResult`, when reject and preferred empty:

- Restore hits where `isActionableApiRejectHit` **or** asked-field reject **or** server-write (not only the last two).
- Share with loop fallback + seed when preferred empty.
- Add orchestrator test: ranking would empty preferred; fail-open forces ≥1 read or snippet attach (not 0 reads).

### Step 5 — Matcher: raise-less field error lines (F4 remainder / F9)

Extend `contentLooksLikeAskedFieldReject` **carefully**:

- If content has no write-reject keywords, still Pass when: asked field token appears **and** line looks like API error copy (`not valid`, `is required`, `invalid …`, `please pass a valid`, etc.) **and** path is not client UI / noise.
- Prefer requiring path class (serializer/server-write) to limit false positives on i18n.
- Tests: unquoted paraphrase ask + Zoekt message-only line → attach; wrong-field message → false.

Do **not** reopen invent-query slogans.

### Step 6 — Jump candidate completeness (F1 / F7)

Finish + opened-path tracking:

- Candidates = server-write ∪ mutation-handler ∪ serializer path class ∪ already-opened reject reads.
- Mid-loop: do not discard body via skipNote until jump exhausted **or** finish will re-read; simplest fix = always enqueue path for finish jump even after skipNote.
- Use or delete `rejectJumpAttempted`.

### Step 7 — UI-only → short miss (reject class only)

When `isApiRejectAsk` and after Steps 1–3 there is still no write-reject:

- Emit `API_REJECT_HUNT_MISS` (already).
- Ensure no streamAnswer on that path (already when miss returned).
- Do **not** invent paths in miss copy (already).
- Speculative essay when **misclassified** as non-reject → Agent 3 (calm-vs-reject / quarterback), not matcher expansion here.

Optional thin polish: if somehow stream runs with only skipped UI notes, replace with miss — prefer preventing stream.

### Step 8 — Branch rail proof (F5)

- Keep Extension Host `resolveActiveRepoTarget`.
- Add a focused test or contract assert that agent `readRemoteFile` wiring passes resolved branch (or document single choke in `IndexedRepoWorkspace.readFile`).
- Refuse new `readRemoteFile` call sites that bypass resolver.

### Step 9 — Tests (must green before claiming Pass)

| Proof | Pass |
|-------|------|
| Finish cannot miss with unused asked-field hit in search context | Attach or jump first |
| preferred emptied → fail-open → read or snippet attach | Not 0 reads |
| Remote undefined + raise **or** message-only snippet | Attach |
| Unquoted ask + message-only Zoekt | Attach (F9) |
| Wrong-floor serializer (api path + non-api serializer path) | Jump, not miss |
| UI-only junk hits | Short miss, no stream essay |
| Quote / wrong-field / job gates | Stay green |
| planTurn still called for reject | Agent 3 regression |
| lint | If types touched |

### Step 10 — Do not

- Rebuild `huntWriteReject` as 12-query brain
- Plane-only path allowlists
- Prompt-only finish
- Claim Pass from existing tests alone without F6/F9/fail-open orchestrator proofs

---

## 5. Acceptance: when miss is allowed vs forbidden

### Miss **forbidden** (must attach or jump first)

| Evidence state | Required action |
|----------------|-----------------|
| Search hit content matches asked-field write-reject | Attach snippet |
| Search hit contains asked error quote (≥12) | Attach snippet |
| Search hit is field-shaped API error line for asked field on non-noise path | Attach snippet (after Step 5) |
| Preferred / opened serializer or server-write / mutation-handler not yet jumped; full file has reject | In-file jump / fuller read |
| Remote body fetch empty but hit snippet matches | Attach snippet (no second fetch required) |
| Ledger still holds unused reject snippet from earlier search | Attach before miss |

### Miss **allowed** (short `API_REJECT_HUNT_MISS`, then stop)

| Evidence state | Notes |
|----------------|-------|
| No attachable reject in hits, ledger, or bodies after soft gather / steps | Honest miss |
| Only client UI / seeds / OpenAPI / filters / noise opened | Short miss — **no** speculative serializer essay |
| Preferred paths jumped; bodies lack asked-field reject | Exhausted — miss |
| User Stop / abort | Cancel cleanly; no latency timeout substitute |

### Never

| Behavior |
|----------|
| Invent a path in the miss (or any answer) |
| “Impact / backend probably…” padding after miss |
| More `search_code` **as a finish rail** while unused reject snippet exists (attach instead; further search is Agent 3 gather) |
| Require successful remote read to treat a matching Zoekt line as evidence |

---

## 6. Boundary with Agent 3 (rails vs agent brain)

Aligned with `.cursor/intent-quarterback-agent-owns-reject.prompt.md`:

| Layer | Owns | Does not own |
|-------|------|----------------|
| **Agent 3 — quarterback** | Job brief, evidence class hint, optional 2–4 seed criteria | Emitting miss; deciding attach |
| **Agent 3 — agent loop** | Next `search_code` / `read_file` from results; adapting queries | Inventing paths; silent workflows |
| **Agent 4 — rails (this plan)** | Attach-before-miss; jump-before-miss; skip noise; matcher honesty; preferred fail-open; branch on read | Choosing the search parade; replacing `planTurn` |
| **Shared** | `isApiRejectAsk` as class tag | Growing slogan banks as “fix” |

**Hand-off rule:** If dogfood Fails because the agent never searched a sensible term, that is **Agent 3**. If the index already returned the raise (or message line) / opened the right file and the product still canned-missed, that is **Agent 4**.

**Conflict rule:** When both seem true, fix Agent 4 first (rails must not lie), then Agent 3 (gather quality). Rails must remain correct even when quarterback is down (fail-open).

---

## 7. Out of scope

- Cutting / rewriting quarterback invent logic (Agent 3)
- Plain-chat must-not-promote / slash promotion
- Create-issue locate Pass/Fail
- Calm L3 / Tripwire auth+state ranking (keep green; don’t weaken calm-vs-reject)
- Blast / Owner / Trace / Gaps
- Marketplace, billing, Stripe
- Rebuilding Zoekt / index quality itself
- Making `customerFacingAnswer` a general essay detector for all chat
- Commits / dogfood by this planning agent

---

## 8. Fix-prompt inputs

Paste-ready for an implementation chat:

### Context files

- `.cursor/rules/reject-hunt-attach-before-miss.mdc`
- `.cursor/rules/evidence-bound-answers.mdc`
- `.cursor/plans/gap-04-finish-attach-rails.md` (this doc)
- `.cursor/intent-quarterback-agent-owns-reject.prompt.md` (Agent 3 boundary only — do not re-own gather)

### Code chokes

| Area | Path |
|------|------|
| Miss emission | `src/api/agent/AgentOrchestrator.ts` — `finishWithAnswer`, `API_REJECT_HUNT_MISS` |
| Attach | `attachRejectFromSearchHits`, `attachRejectSnippetPayload`, empty-body branch in `readFirstMatchingHit` |
| Jump | `loadWriteRejectWindow`, `readWriteRejectInSameFile`, finish jump block ~1043–1090, mid-loop ~682–700 |
| Rank fail-open | `decorateToolResult` preferredHits; loop `hits = parsed.hits` fallback |
| Seed gaps | `seedRejectPlannedSearches`, `huntWriteReject`, `lastChancePreferredHitsOnly` |
| Matchers | `src/api/agent/searchQuery.ts` — `contentLooksLikeAskedFieldReject`, `contentIncludesAskedRejectQuote`, `askedRejectErrorQuotes`, `isActionableApiRejectHit`, `shouldSkipEvidencePath` |
| Skip / path class | `src/indexing/evidencePathNoise.ts` — `isServerWritePath`, `isMutationHandlerPath`, `isClientUiPath` |
| Branch | `src/extension.ts` agent `readRemoteFile` + `resolveActiveRepoTarget` |
| Tests | `AgentOrchestrator.test.ts` (wrong-floor, snippet+undefined remote, planTurn); `searchQuery.test.ts` (Zoekt string-only — **extend unquoted**) |

### Implementation order (must match §4)

0. Contract helper `unusedRejectEvidence`  
1. Finish gate resolves unused before miss  
2. Reject hit ledger across search merges  
3. Attach parity on seed / lastChance / huntWriteReject  
4. preferredHits fail-open ↔ actionable  
5. Unquoted field-shaped message matcher  
6. Jump candidate set completeness  
7. UI-only → miss only (no essay)  
8. Branch proof  
9. Tests + lint  

### Done means

- Automated proofs in §4 Step 9 green  
- Self-check from reject-hunt rule still holds with **body fetch undefined** and **unquoted paraphrase**  
- No new slogan brain; no Plane special-cases  
- Agent 3 planTurn ownership unchanged  

### Boris bar

Would a staff engineer trust that if Zoekt already showed the error line (or the right serializer was opened), Coop **cannot** ship “I couldn’t find where the API rejects…”? If finish can still miss with unused evidence in context, you are not done.
