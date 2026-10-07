# Gap 01 — Live Parent Pass is the ship gate

**Mode:** planning only (no code in this doc’s charter).  
**Date:** 2026-09-29  
**Ask that must Pass (exact paste):**

```
In Plane issue create/update, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent isn't in the project. Where is that raised?
```

**Use-repo:** `CoopAI-Corp/plane`, branch `preview`, no file chip, fresh thread.  
**Pass:** cites / attaches `apps/api/plane/app/serializers/issue.py` Parent `ValidationError` (or equivalent write-reject body/snippet).  
**Fail:** `API_REJECT_HUNT_MISS` (“I couldn't find where the API rejects that field…”) or a UI/speculative essay.

---

## 1. Gap statement (product failure in plain English)

Staff-engineer dogfood on indexed Plane still loses the exact Parent ValidationError locate: the index already knows the reject line, but the product answers with a canned miss.

Unit tests are green on **mocked** search/read/`planTurn`. Extension Host on the **real** ask is still Fail. That means we have been declaring “fixed” against a softer fixture and/or a scripted tool loop that does not match live.

Until this exact live paste Passes in Extension Host, **Parent Pass is not shipped** — regardless of how many orchestrator unit cases are green.

---

## 2. Root-cause map (why live still fails / what we don't know yet)

### Confirmed from code + thread history

| Fail sequence (dogfood) | Likely mechanism | Evidence in tree |
|-------------------------|------------------|------------------|
| Opened `issue.py`, then canned miss | Right path, wrong floor **or** full body without asked reject → finish still emits `API_REJECT_HUNT_MISS` | Finish gate: `finishWithAnswer` → `!contextHasWriteReject` → miss. Jump rail exists (`loadWriteRejectWindow` / pre-finish candidate jump) but only helps if the **fetched** body contains Parent reject. |
| 10× `search_code`, 0× `read_file` | `preferredHits` emptied; auto-read only follows preferred; no snippet attach | Rule + uncommitted `decorateToolResult` fail-open + `attachRejectFromSearchHits`. Tests cover empty-body + message-only Zoekt. |
| Zoekt hit is message-only (no `raise` / `ValidationError` keywords) | Detector must treat asked quote as reject | `contentIncludesAskedRejectQuote` / `contentLooksLikeAskedFieldReject` — unit covered for exact live paste. |

### High-confidence remaining holes (skeptical)

**A. Fixture drift — “T2 Pass” ≠ this ship gate**

- Canonical `COPILOT_T2_ASK` in `dogfoodContract.ts` is a **different** sentence (no full quoted error string):
  - *“A client sent a parent that isn’t in this project…”*
- Live ship-gate paste (quoted ValidationError) appears only as **inline strings** in a couple of tests (`AgentOrchestrator.test.ts`, `searchQuery.test.ts`), **not** as the shared dogfood constant.
- Prompts/docs that say “Exact `COPILOT_T2_ASK`” can greenlight the wrong ask. That is a fake Pass class.

**B. Tests script the winning `planTurn`**

- Live-shaped tests force round 1 to `search_code` with `"Parent is not valid issue_id"`.
- Live Extension Host uses a real model via `CoopChatSession.planAgentToolTurn` (edit assignment). The model can burn rounds on noise queries, `{done:true}` early, or never surface the quote hit.
- **Green tests do not prove** an adversarial / lazy `planTurn` still attaches.

**C. Snippet attach is incomplete on the seed / successful-wrong-body path**

After `search_code` in the **owned loop**, `attachRejectFromSearchHits` runs — good.

But:

1. **`seedRejectPlannedSearches`** (optional quarterback seed, ≤2 reject-shaped criteria) merges search results and calls `readFirstMatchingHit` — it does **not** call `attachRejectFromSearchHits`.
2. In `readFirstMatchingHit`, snippet attach from `hit.content` runs only when the remote body is **empty**. If the body is **non-empty but wrong floor / wrong branch / no Parent**, the path is **skipped** even when `hit.content` already is the quoted reject.
3. Seed may mark the winning query as tried; later loop may not re-search it; finish jump needs Parent in the **file body**, not in the unused Zoekt snippet → miss.

This matches “index had the line; we still canned-missed” without requiring preferredHits to be empty.

**D. Branch / read vs search skew (partially patched, not proven live)**

- Uncommitted `extension.ts`: agent `readRemoteFile` now goes through `resolveActiveRepoTarget` (indexed branch first, then preferences).
- Search still goes through cloud/local `indexBackend.search(repoId, pattern)` — shard for the indexed repo, no per-call branch arg.
- If Extension Host was not reloaded with this diff, old `{ repoId }`-only reads can still open the wrong floor while Zoekt shows Parent on `preview`.
- **Unknown until live:** whether indexed `repo_stats.branch` for plane is actually `preview`, and whether a successful wrong-body read still bypasses snippet attach (C).

**E. No automated live/integration gate**

- `docs/agent-dogfood.md` / ICP canvas = **manual** Extension Host.
- `agentScopeEval.test.ts` = golden repo routing/patch chain — **not** Plane Parent.
- `test:agent-ship:a` runs orchestrator + searchQuery unit tests with mocks — **not** cloud Zoekt + codehost read + real `planTurn`.
- Therefore CI can stay green forever while Live Parent Pass stays F.

**F. Process / load gap**

- Large **uncommitted** diffs (`AgentOrchestrator`, `searchQuery`, `CoopChatSession`, `extension.ts`, tests, reject-hunt rule). If dogfood ran on an older Extension Host build, “unit green / live F” is expected and proves nothing about the new rails.

### Still unknown (must measure on next live fail)

1. Activity log for one fail turn: every `search_code` query, every `read_file` path/summary (skip vs attach vs jump), whether seed ran, whether `planTurn` returned `done` before attach.
2. Whether any search hit’s `content` contained the exact Parent quote when miss fired.
3. Whether `read_file` of `issue.py` body on that turn contained the Parent raise (branch proof).
4. Whether `isApiRejectAsk(exact paste)` is true on the live message (should be; verify once).
5. Whether quarterback `searchCriteria` were reject-shaped (`isRejectShapedSearchCriterion`) or filtered out of seed.

---

## 3. Current code choke points (files + functions)

| Layer | File | Functions / constants | Role |
|-------|------|----------------------|------|
| Miss copy | `AgentOrchestrator.ts` | `API_REJECT_HUNT_MISS`, `finishWithAnswer` | Sole customer-facing reject miss when `!contextHasWriteReject`. |
| Owned loop | `AgentOrchestrator.ts` | `runOwnedLoop`, `canAnswerNow` | Reject asks use `planTurn` (script early-return removed in working tree). Done = write-reject attached. |
| Snippet attach | `AgentOrchestrator.ts` | `attachRejectFromSearchHits`, `attachRejectSnippetPayload` | Attach Zoekt line as `read_file` evidence without second fetch. |
| Seed | `AgentOrchestrator.ts` | `seedRejectPlannedSearches`, `huntWriteReject` | Seed ≤2 planned criteria; `huntWriteReject` = fail-open **no** `planTurn` only (≤4). Seed **missing** snippet-attach call. |
| Auto-read / jump | `AgentOrchestrator.ts` | `readFirstMatchingHit`, `loadWriteRejectWindow`, `readWriteRejectInSameFile`, pre-finish candidate jump, `lastChancePreferredHitsOnly` | Wrong-floor recovery; preferred-only last chance (no slogan parade). |
| Rank / empty preferred | `AgentOrchestrator.ts` | `decorateToolResult` | Reject fail-open keep server-write / reject-snippet hits. |
| Evidence class | `searchQuery.ts` | `isApiRejectAsk`, `contentLooksLikeAskedFieldReject`, `askedRejectErrorQuotes`, `contentIncludesAskedRejectQuote`, `pickSearchHitsToRead`, `shouldSkipEvidencePath` | Calm-vs-reject + quote-as-reject + noise skips. |
| Session / live `planTurn` | `CoopChatSession.ts` | `runAgentOwnedTurn`, `planAgentToolTurn`, `formatIntentBriefForAgent`, `plannedCodeSearchQueries` | Real model tool picks; intent brief + ≤4 planned criteria. |
| Branch for agent read | `extension.ts` | `createAgentOrchestrator` → `readRemoteFile` → `resolveActiveRepoTarget` | Align read branch with indexed/Use-repo. |
| Branch policy | `repoTargetResolver.ts`, `resolveRepoBranch.ts` | indexed → workspace → UI | Indexed branch should win for plane/`preview`. |
| Fixtures | `dogfoodContract.ts` | `COPILOT_T2_ASK` | **Wrong string for this gate.** Exact paste only inline in tests. |
| Body fixture | `fixtures/planeIssueSerializer.validate.py` | Parent raise ~line 185 | Local stand-in for live file body. |
| Rules | `.cursor/rules/reject-hunt-attach-before-miss.mdc` | Product law | Snippet attach before miss; no empty preferred on reject. |
| Architecture intent | `.cursor/intent-quarterback-agent-owns-reject.prompt.md` | Steps 1–6 | Quarterback brief; agent owns gather; rails enforce class. |
| Manual dogfood | `docs/agent-dogfood.md` | E1–E7 ICP | **Does not include** this Parent paste as a required gate. |
| “E2E” without Host | `eval/agentScopeEval.test.ts` | Golden repo | Does not cover Plane Parent. |

---

## 4. Build plan (ordered — keep / extend / replace)

Do **not** reorder past “make the live paste the gate.” Implementation comes later; this is the work sequence a fix thread must follow.

### Step 0 — Freeze the ship gate (keep, make canonical)

- **Replace / extend** `dogfoodContract.ts`: add e.g. `LIVE_PARENT_PASS_ASK` (or replace `COPILOT_T2_ASK` and update all call sites) to the **exact** live paste.
- Update prompt/dogfood docs so “T2 / Parent Pass” means that string only.
- **Acceptance:** no test or checklist may claim Parent Pass using only the soft paraphrase.

### Step 1 — Prove or kill the remaining attach holes (extend)

Before more ranking slogans:

1. **Seed path:** after each seed `search_code`, call the same `attachRejectFromSearchHits` path as the owned loop (or share one helper). Prefer attach-from-snippet **before** `readFirstMatchingHit`.
2. **Successful wrong body:** if `hit.content` looks like asked-field reject and body does not, **attach snippet** (or jump then snippet) — never `continue` past an unused reject snippet.
3. **Finish:** refuse `API_REJECT_HUNT_MISS` while any `search_code` hit in context still matches `contentLooksLikeAskedFieldReject` and was never attached (rail, not hope).
4. Keep calm-vs-reject / `isApiRejectAsk` rails. Keep agent-owned `planTurn` (do not resurrect `huntWriteReject` as the brain).

### Step 2 — Adversarial automated proofs (extend tests; replace “scripted win”)

Add/adjust `AgentOrchestrator` tests that use **`LIVE_PARENT_PASS_ASK`** and:

| Case | Mock behavior | Must |
|------|---------------|------|
| Message-only Zoekt + empty read | Already present | Keep; bind to contract constant |
| Message-only Zoekt + **non-empty wrong-floor body** | Body = class header; hit.content = quote | Attach quote; **no** miss |
| Seed finds quote hit | Seed criteria only; `planTurn` returns `done` immediately | Attach via seed; **no** miss |
| Lazy `planTurn` | First N searches return noise; later returns Parent hit | Still attach; no miss |
| Wrong-floor full fixture | Existing `planeIssueSerializer.validate.py` | Keep |
| `planTurn` invoked | Reject ask with `planTurn` provided | Assert called (bypass gone) |

Also: `searchQuery` tests already cover quote matching — rebind to contract constant.

### Step 3 — Branch / Host wiring (keep + verify)

- Keep `extension.ts` `resolveActiveRepoTarget` on agent `readRemoteFile`.
- Add a **focused** test or Host checklist item: read of `issue.py` on plane must resolve to indexed/`preview` branch string (not branch-less).
- Confirm Use-repo sync still writes `preferences.branch` (`syncPreferencesFromRepoSelection`).

### Step 4 — Live dogfood protocol (replace “unit green = done”)

Mandatory handoff before anyone says fixed:

1. Reload Extension Host (load the commit/diff under test).
2. Use-repo plane / `preview` / no file / **fresh thread**.
3. Paste **exact** `LIVE_PARENT_PASS_ASK` once.
4. Pass only if answer cites/attaches Parent ValidationError in `serializers/issue.py` (or attached equivalent).
5. Capture Activity: search queries + reads. Fail smells: miss copy; 0 reads with unused reject hit; opened serializer then miss without jump/snippet attach.

Optional: soft `COPILOT_T2_ASK` paraphrase as regression — **not** a substitute for Step 4.

### Step 5 — CI honesty (extend; do not fake E2E)

- Wire contract constant into `test:agent-ship:a` cases above.
- **Do not** claim a cloud Zoekt live gate in CI unless one is actually built (recording/replay). Prefer honest: “automated rails + mandatory Host dogfood.”
- Optional later: recorded Zoekt JSON + fixture body integration test (no real network) that runs without scripted winning `planTurn` — still not a substitute for one Host run.

### Explicit keep / extend / replace

| Item | Action |
|------|--------|
| Agent-owned `planTurn` for reject | **Keep** |
| `huntWriteReject` as turn brain | **Replace** (already demoted; do not revive) |
| `attachRejectFromSearchHits` | **Extend** to seed + wrong-body + finish unused-hit rail |
| `COPILOT_T2_ASK` as Parent gate | **Replace** with exact live paste (or dual constants with live = ship gate) |
| Unit tests with forced winning search | **Extend** with adversarial cases; keep happy path |
| Manual Host dogfood as Pass authority | **Keep / strengthen** — only Host can close this gap |
| Plane path special-cases / slogan banks | **Out** (`noRepoSpecificRules`) |

---

## 5. Acceptance criteria — what MUST be true before anyone says “fixed”

### Live (non-negotiable)

- [ ] Exact `LIVE_PARENT_PASS_ASK` (paste above) on indexed plane / `preview` / no chip / fresh thread **Passes** in Extension Host after Reload.
- [ ] Answer attaches or cites Parent ValidationError in `apps/api/plane/app/serializers/issue.py` (or attached write-reject equivalent).
- [ ] Answer is **not** `API_REJECT_HUNT_MISS` and **not** a UI-only / speculative backend essay.
- [ ] Activity shows attach and/or read of write-reject evidence (not search-only then miss).

### Automated (necessary, not sufficient)

- [ ] Contract constant === live paste; soft paraphrase is separate if kept.
- [ ] Message-only Zoekt + empty remote read → attach, no miss.
- [ ] Message-only Zoekt + wrong-floor **non-empty** body → attach, no miss.
- [ ] Seed path with quote hit + immediate `{done:true}` → attach, no miss.
- [ ] Wrong-floor → jump to Parent on fixture body → attach, no miss.
- [ ] Reject ask with `planTurn` provided → `planTurn` called (≥1).
- [ ] L3 / Tripwire / calm locate still **not** ValidationError-first (`isApiRejectAsk` false where required).
- [ ] `noRepoSpecificRules` still Pass.
- [ ] `npm run lint` if types/clients touched; targeted `AgentOrchestrator` + `searchQuery` (+ intent quarterback gates) green.

### Process gate

- [ ] No PR/comment/chat claims “Parent Pass fixed” with only unit green and no Host result for the **exact** paste.
- [ ] If Host Fail after automated green → **not fixed**; open remaining hole from Activity (section 2 unknowns), do not add another slogan bank.

---

## 6. Risks / anti-patterns (fake Pass)

| Fake Pass | Why it fools | Reject |
|-----------|--------------|--------|
| Soft `COPILOT_T2_ASK` green | Different ask; may search/rank differently | Exact live paste only |
| Scripted `planTurn` always searches Parent first | Live model does not | Adversarial / seed / unused-hit rails |
| Empty-read snippet test only | Live often returns **some** body | Wrong-floor non-empty + snippet unused |
| “We removed huntWriteReject” | Necessary but not sufficient | Host still F |
| Prompt-only / brief-only change | Model still miss without rails | Finish must refuse miss with unused reject hit |
| Plane filename special-case | Breaks `noRepoSpecificRules`; won’t generalize | Evidence-class rails |
| Claiming CI E2E without Host/network | No such gate exists today | Honest Host checklist |
| Dogfood on stale Extension Host | Uncommitted rails never loaded | Reload after the diff under test |

---

## 7. Out of scope

- C2 state reject, L3/Tripwire, create-issue locate (except as non-regression).
- Invent/slogan bank expansion as the main brain.
- Silent Blast/Owner/Trace from plain English.
- Weakening calm-vs-reject.
- Full cloud Zoekt live CI (unless separately funded).
- Commits / pushes (unless user asks later).
- ICP E1–E7 canvas jobs (different scorecard).
- UI essay polish when evidence is thin — honest short miss only.

---

## 8. Inputs needed for a later fix-prompt (exact paste)

### Paste / fixtures

```
In Plane issue create/update, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent isn't in the project. Where is that raised?
```

- Use-repo: `CoopAI-Corp/plane`, branch `preview`, no file chip, fresh thread.
- Soft regression (optional): `COPILOT_T2_ASK` from `dogfoodContract.ts`.
- Body fixture: `src/api/agent/fixtures/planeIssueSerializer.validate.py`.
- Architecture: `.cursor/intent-quarterback-agent-owns-reject.prompt.md`.
- Rule: `.cursor/rules/reject-hunt-attach-before-miss.mdc`.
- This plan: `.cursor/plans/gap-01-live-parent-pass-e2e.md`.

### Commands (fix thread)

```bash
# After implementing rails + contract constant:
npx tsx src/api/agent/AgentOrchestrator.test.ts
npx tsx src/api/agent/searchQuery.test.ts
npx tsx src/chat/intentPlanner/intentQuarterback.gates.test.ts
npx tsx src/api/agent/noRepoSpecificRules.test.ts
npm run lint   # if types/clients touched
```

Then: Extension Host → Developer: Reload Window → dogfood exact paste → Pass/Fail + Activity paste into the fix thread if Fail.

### What the fix agent must return

1. What changed (seed/wrong-body/finish rail — not “more tests only”).
2. Which automated cases prove the **exact** paste.
3. Host dogfood result for the exact paste (**Pass required**).
4. Explicit: do **not** say fixed if Host was not run or was Fail.

### Suggested first debugging capture (if still Fail)

From Activity on one fail turn, paste:

- All `search_code:` summaries (queries).
- All `read_file` / skip / `(search hit reject)` / `(validate/reject)` summaries.
- Final answer first line.
- Whether Use-repo showed `preview`.

That single log distinguishes: never found hit vs unused snippet vs wrong body vs jump miss vs stale Host.
