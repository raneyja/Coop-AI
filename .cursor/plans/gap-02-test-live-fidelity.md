# Gap 02 — Test ↔ live fidelity (reject hunt)

**Agent:** 2 of 5 · **Mode:** planning only · **Date:** 2026-09-29  
**Grade claimed by thread:** D — tests green while live canned-missed.

---

## 1. Gap statement

Reject-hunt regressions were written against **idealized search hits**: full `raise serializers.ValidationError("…")` lines plus a successful remote body fetch. Live Zoekt (via Lightning `/search` → `Fragments[].Match`) often returns **only the quoted error string**, with **no** `raise` / `ValidationError` keywords. Body fetch can return `undefined`. Ranking can empty `preferredHits` so auto-read never runs.

**Product fail (dogfood):** Exact Parent ask on indexed `plane` / `preview` → many `search_code`, **0** `read_file`, canned `API_REJECT_HUNT_MISS` — while the index already held the error line.

**Test fail class:** mocks that encode the *solved* shape, not the *broken* shape. A late Zoekt-shaped suite was added, but it still **cannot make green-tests-that-miss-live impossible**, because:

1. Most reject orchestrator tests still mock full raise lines + happy-path `readRemoteFile`.
2. The new Zoekt tests only pass under a **quoted Exact ask**; canonical `COPILOT_T2_ASK` + message-only hit still returns `contentLooksLikeAskedFieldReject === false` (proven below).
3. Wrong-floor “live fixture” invents a hit class (`IssueFlatSerializer`) that **does not exist** in `planeIssueSerializer.validate.py`.
4. **GitHub Actions `npm run test:ci` does not run `test:agent-ship:a`**, so `AgentOrchestrator.test.ts` and `searchQuery.test.ts` are **not** on the PR gate.

---

## 2. How tests lied (mock vs live)

| Surface | What tests mocked | What live did | Why green ≠ fixed |
|--------|-------------------|---------------|-------------------|
| Hit `content` | `'raise serializers.ValidationError("Parent is not valid issue_id")'` | Zoekt fragment: `'"Parent is not valid issue_id please pass a valid issue_id"'` (or bare message) — **no raise keyword** | Matcher path that requires `contentLooksLikeWriteReject` never runs on live snippets |
| Ask text | Late Zoekt tests use Exact ask **with** error in quotes | Dogfood Exact also quotes; **paraphrase T2** (`COPILOT_T2_ASK`) does **not** | Quote-only recovery (`askedRejectErrorQuotes`) is untested for the ask shape used in most suite cases |
| Body fetch | `readRemoteFile` returns full serializer body | Often `undefined` (Zero-Clone / codehost miss) | Attach-from-hit was never forced until one late test; older suite always “re-found” via body |
| `preferredHits` | Implicitly non-empty via high-score raise hits | Ranking/`pickSearchHitsToRead` emptied preferred → **0 auto-reads** | No orchestrator test asserts recovery when preferred starts empty but raw `hits` hold evidence |
| Wrong-floor | Synthetic short body *or* fixture + invented hit line `class IssueFlatSerializer…` | Opened real `issue.py` at wrong window; Parent raise elsewhere in file | Fixture has Parent raise at L185 but **no** `IssueFlatSerializer` — jump is tested against a fictional open line |
| Branch | No branch coordinate in mocks | Wrong branch → wrong/missing body while index hit is on `preview` | Zero coverage |
| CI | Local / `test:agent-ship` / enterprise | `test:ci` → ship **b/c/d/e only** | Entire reject suite can rot without red CI |

### Proven matcher gap (run 2026-09-29)

| Ask | Hit content | `contentLooksLikeAskedFieldReject` |
|-----|-------------|--------------------------------------|
| Exact (quoted Parent message) | `"Parent is not valid…"` only | **true** |
| Exact (quoted) | bare `Parent is not valid…` | **true** |
| `COPILOT_T2_ASK` (no quote) | `"Parent is not valid…"` only | **false** |
| `COPILOT_T2_ASK` | bare message only | **false** |
| `COPILOT_T2_ASK` | full `raise … ValidationError("Parent…")` | **true** |

`contentLooksLikeWriteReject` is also **false** on message-only lines (`lineLooksLikeWriteReject` requires `raise` / `ValidationError` / throw / client 400 patterns).

So: **any regression that only uses full raise lines, or only uses Exact+quote for Zoekt fragments, still allows live miss on T2 paraphrase + message-only Zoekt.**

### Production hit shape (source of truth)

`src/indexing/lightningSearch.ts` (Zoekt HTTP):

```text
content: fragmentText || match.Line || file.FileName
fragmentText = match.Fragments?.map(part => part.Match ?? "").join("")
```

When the query is the error string, `Fragments[].Match` is often **just that string**. Local `zoektIndexer` fallback can return whole lines; unit mocks historically copied the *fallback* / ideal line, not the fragment path.

Wire path into the agent: `indexBackend.search` → `handleSearchCode` → `hits[].content` unchanged → `decorateToolResult` → `preferredHits` → `attachRejectFromSearchHits` / auto-read.

---

## 3. Inventory of existing tests vs missing live shapes

### 3.1 Helper layer — `searchQuery.test.ts`

| Existing test | Covers | Omits |
|---------------|--------|-------|
| `asked-field reject matches Zoekt string-only error line (no raise keyword)` | Exact+quote × (quoted fragment, bare, wrong-field State) | `COPILOT_T2_ASK` × message-only; no `askedRejectErrorQuotes` / `contentIncludesAskedRejectQuote` named unit tests |
| `asked-field reject keeps the matching ValidationError…` | Full raise lines × T2/C2/assignee | Message-only fragments |
| `wrong-field validate() is not an asked-field reject` | Full raise HTML vs parent | Zoekt fragment of sibling field |
| `API-reject pick prefers asked-field…` / `keeps serializer with wrong-field…` | Full raise snippets in `pickSearchHitsToRead` | Message-only preferred recovery; empty preferred from noise-only pool |
| Ranking / C2 skip suites | Path noise, converters, UI | Empty `preferredHits` decorate-recovery contract (lives in orchestrator) |

### 3.2 Orchestrator — `AgentOrchestrator.test.ts` (reject-relevant)

| Existing test | Hit shape | Body fetch | Verdict |
|---------------|-----------|------------|---------|
| `T2 hunt attaches parent ValidationError, not converters` | **Full raise** | Happy path | Lies vs Zoekt fragment |
| `T2 wrong-floor serializer window jumps…` | Field line / wrong window; **full raise in body** | Happy path | Wrong-floor OK in spirit; not Zoekt-fragment attach |
| `live Plane issue.py wrong-floor hit jumps…` | Invented `IssueFlatSerializer` line **absent from fixture** | Fixture body | Partial; **hit≠file** lie |
| `reject attaches ValidationError from search hit when remote read fails` | Message-only Zoekt ✓ | `undefined` ✓ | Best live shape — but **Exact+quote only**; no search-count / preferredHits assertions |
| C2 / assignee / invite / reviewer reject tests | Mostly **full raise** or richer snippets | Happy path | Do not encode fragment-only |
| `API-reject ask uses planTurn…` / miss paths | Empty or non-reject hits | N/A | Miss honesty — not attach-before-miss |

### 3.3 Fixture — `fixtures/planeIssueSerializer.validate.py`

| Present | Missing for fidelity |
|---------|----------------------|
| Real Parent / State / Estimate ValidationError strings in `IssueCreateSerializer.validate` | `IssueFlatSerializer` (or any real wrong-floor open target that appears in live hits) |
| Usable as body for jump tests | Paired **hit snippets** extracted from the same file (message-only line at L185, state line, etc.) as frozen constants |

### 3.4 CI

| Script | Runs Orchestrator / searchQuery reject tests? |
|--------|-----------------------------------------------|
| `npm run test:agent-ship:a` | **Yes** |
| `npm run test:agent-ship` / `test:agent-enterprise` | Yes (via `:a`) |
| `npm run test:ci` (`.github/workflows/ci.yml`) | **No** — only `:b`–`:e` |
| `npm run test:codegen` | Orchestrator only (not searchQuery) |

**Conclusion:** PR CI can stay green while reject fidelity tests never execute.

---

## 4. Build plan

### 4.1 Fixture strategy — “mocks cannot invent the happy path”

**Rule:** Every reject regression that claims live fidelity must load evidence from **frozen live shapes**, not hand-typed raise lines.

1. **Canonical asks (two obligatory):**
   - `EXACT_PARENT_REJECT_ASK` — Exact dogfood string with `"Parent is not valid issue_id please pass a valid issue_id"` in quotes (share one constant; stop duplicating inline).
   - `COPILOT_T2_ASK` — paraphrase **without** the quote (already in `dogfoodContract.ts`).

2. **Canonical hit fragments (export from a shared fixture module, e.g. `rejectHuntLiveShapes.ts`):**
   - `ZOEKT_PARENT_MESSAGE_ONLY` = `'"Parent is not valid issue_id please pass a valid issue_id"'` (exact Lightning fragment shape).
   - `ZOEKT_PARENT_BARE` = unquoted message line.
   - `ZOEKT_PARENT_FULL_RAISE` = full raise line (control — must still pass).
   - `ZOEKT_STATE_MESSAGE_ONLY` — sibling field (must not attach on Parent ask).
   - Extract strings by reading `planeIssueSerializer.validate.py` in the fixture helper (or hard-freeze copies with a comment pointing at fixture line numbers) so message text cannot drift from the body used for jump tests.

3. **Canonical body:**
   - Always `fs.readFileSync(…/planeIssueSerializer.validate.py)` for wrong-floor / jump.
   - Hit `content` for wrong-floor must be a **substring that actually appears** in that file (e.g. `class IssueCreateSerializer` / `parent_id = serializers…` / early validate line) — never a class name absent from the fixture.

4. **Canonical backends:**
   - `readRemoteFile: async () => undefined` for attach-from-snippet Pass.
   - `readRemoteFile` returns fixture body for wrong-floor Pass.
   - Optional: `readRemoteFile` returns body for **wrong branch content** (e.g. file without Parent raise) while Zoekt hit still has message-only — must attach from hit, not invent from wrong body.

5. **preferredHits-empty harness:**
   - Mock `search` returns raw hits with message-only serializer snippet **plus** high-score noise (UI / converters).
   - After decorate, either assert preferred non-empty **or** assert attach still happens from raw hits when preferred is forced empty (spy/hook if needed). Do not rely on incidental ranking.

### 4.2 Required regressions (must exist; names are fix-prompt inputs)

#### A. Matcher / quote layer (`searchQuery.test.ts`)

| ID | Spec |
|----|------|
| A1 | `contentLooksLikeAskedFieldReject` is **true** for `ZOEKT_PARENT_MESSAGE_ONLY` under **Exact quoted ask** |
| A2 | Same helper is **true** for `ZOEKT_PARENT_MESSAGE_ONLY` under **`COPILOT_T2_ASK`** (today **false** — product/fix must make this Pass, or attach must use a broader path; tests must fail until fixed) |
| A3 | `askedRejectErrorQuotes(Exact)` contains Parent message; `askedRejectErrorQuotes(COPILOT_T2_ASK)` is `[]` |
| A4 | `contentIncludesAskedRejectQuote` true only when ask quotes + content carries message |
| A5 | State message-only fragment is **false** for Parent asks (Exact and T2) |
| A6 | `pickSearchHitsToRead` with noise + message-only Parent hit keeps serializer path for both asks |

#### B. Orchestrator attach / miss (`AgentOrchestrator.test.ts`)

| ID | Spec |
|----|------|
| B1 | **Keep/strengthen** `reject attaches ValidationError from search hit when remote read fails` — Exact + `ZOEKT_PARENT_MESSAGE_ONLY` + `readRemoteFile → undefined` → attached snippet; **no** `API_REJECT_HUNT_MISS`; assert `readRemoteFile` call count allowed but result unused |
| B2 | **New:** same as B1 with **`COPILOT_T2_ASK`** + message-only + undefined body → must attach (or short miss only if product explicitly refuses paraphrase-without-quote — then document; default product law says attach when snippet matches asked field) |
| B3 | **New:** `preferredHits` emptied / noise-ranked — raw hits still contain message-only Parent → attach **before** further `search_code`; assert search count ≤ 1 (or ≤ 2 with planned seed), reads from snippet ≥ 1 |
| B4 | **Fix** `live Plane issue.py wrong-floor…` — hit content must exist in fixture; body = fixture; jump attaches Parent raise; no miss |
| B5 | **Keep** synthetic wrong-floor T2 test but add variant: wrong-floor open + **message-only was never in hits** (body-only evidence) vs wrong-floor + message-only already in hits (must attach/jump without extra search) |
| B6 | **New wrong branch:** Zoekt hit message-only on `issue.py`; `readRemoteFile` returns truncated/wrong-branch body **without** Parent raise → still attach from hit; no miss |
| B7 | **Negative:** message-only State fragment + Parent ask + undefined body → honest miss (or no Parent attach); must not attach State as Parent |

#### C. CI hooks

| ID | Spec |
|----|------|
| C1 | Add `npm run test:agent-ship:a` to `test:ci` (or a slim `test:agent-ship:reject` that runs **only** `AgentOrchestrator.test.ts` + `searchQuery.test.ts` if `:a` is too heavy — but **must** be in `.github/workflows/ci.yml` path) |
| C2 | Optional gate comment in `reject-hunt-attach-before-miss.mdc`: “CI must run ship:a / reject fidelity suite” |
| C3 | Do not claim fixed until: local `npx tsx …AgentOrchestrator.test.ts` + `searchQuery.test.ts` + CI job includes them |

### 4.3 Implementation order for a fix agent (not this agent)

1. Land **failing** A2/B2/B3/B6 tests (red = honesty).
2. Fix matcher / attach / preferred recovery until red → green.
3. Repair B4 fixture fidelity.
4. Wire C1 into `test:ci`.
5. Only then claim live dogfood Pass.

---

## 5. Acceptance criteria

**“Green tests that still miss live” must be impossible for these shapes:**

| # | Shape | Required Pass condition |
|---|-------|-------------------------|
| 1 | Message-only Zoekt fragment + Exact quoted ask + `readRemoteFile → undefined` | Snippet attached; no canned miss |
| 2 | Message-only Zoekt fragment + `COPILOT_T2_ASK` + `readRemoteFile → undefined` | Snippet attached; no canned miss (**currently fails matcher** — must be red until product fixed) |
| 3 | Raw hits contain (1) or (2) but `preferredHits` empty / noise-only preferred | Attach from raw hits; no search parade; no miss |
| 4 | Wrong-floor: opened serializer body from **fixture**, hit line **present in fixture**, Parent raise elsewhere | Jump/attach Parent; no miss |
| 5 | Wrong branch / empty body while hit has message-only Parent | Attach from hit; no miss |
| 6 | Sibling field message-only (State) on Parent ask | Do not attach as Parent evidence |
| 7 | Suite runs on PR CI | `test:ci` executes the files that contain 1–6 |

Self-check: delete the full-raise happy-path mocks from B1/B2 temporarily — suite must still fail closed if fragment attach regresses.

---

## 6. Anti-patterns

| Reject | Prefer |
|--------|--------|
| Mocking full `raise ValidationError(...)` as the only hit shape | Message-only + bare + full as three fixtures |
| “Zoekt-shaped” test that only uses Exact+quote | Dual-ask matrix (Exact + `COPILOT_T2_ASK`) |
| Happy-path `readRemoteFile` in attach regressions | `undefined` body as the default for attach-from-hit |
| Invented hit lines not in the body fixture | Hit ⊆ fixture file text |
| Asserting only final answer prose | Assert attached `read_file` content + no miss + search budget |
| Claiming fixed after local green while CI skips ship:a | Put suite on `test:ci` |
| Unit-testing only `contentLooksLikeAskedFieldReject` without orchestrator attach | Both layers (helper + `attachRejectFromSearchHits` path) |
| Padding fixture with blank lines / unrelated classes to “make jump work” | Minimal real excerpt from Plane |

---

## 7. Out of scope

- Rewriting quarterback / killing `huntWriteReject` script brain (Agent 1 / intent-quarterback prompt).
- Invent-query / slogan ranking polish as the primary fix.
- Live Extension Host dogfood execution in this planning agent.
- Create-issue locate, Calm vs reject classification, UI-only miss copy (except as negative controls).
- Changing Zoekt itself / Lightning scoring — only how Coop consumes `hit.content`.
- Full `test:agent-ship:a` runtime optimization beyond ensuring reject tests are gated.

---

## 8. Fix-prompt inputs (exact names / specs to require)

Paste into the implementing agent. **Do not mark done until all are green on CI.**

### Must add or rewrite

1. **`searchQuery.test.ts`**
   - Rewrite/extend: `asked-field reject matches Zoekt string-only error line (no raise keyword)` → dual-ask matrix (Exact + `COPILOT_T2_ASK`) × (`ZOEKT_PARENT_MESSAGE_ONLY`, bare, State negative).
   - New: `askedRejectErrorQuotes extracts Exact Parent message and is empty for COPILOT_T2_ASK`.
   - New: `contentIncludesAskedRejectQuote matches Zoekt fragment for Exact ask only`.
   - New: `pickSearchHitsToRead keeps message-only Parent serializer among noise for T2 and Exact`.

2. **`AgentOrchestrator.test.ts`**
   - Keep: `reject attaches ValidationError from search hit when remote read fails` (Exact + message-only + undefined body).
   - New: `reject attaches Zoekt message-only hit for COPILOT_T2_ASK when remote read fails`.
   - New: `reject attaches from raw hits when preferredHits empty (message-only Parent present)`.
   - New: `reject attaches message-only hit when remote body is wrong-branch (no Parent raise)`.
   - New: `reject does not attach State message-only fragment for Parent ask`.
   - Rewrite: `live Plane issue.py wrong-floor hit jumps to Parent ValidationError` — hit content must appear in `fixtures/planeIssueSerializer.validate.py`.

3. **Shared fixture module (new)**
   - e.g. `src/api/agent/fixtures/rejectHuntLiveShapes.ts` exporting asks + Zoekt fragments + path constants + fixture body loader.

4. **CI**
   - `package.json` `test:ci` must invoke `test:agent-ship:a` **or** a dedicated `test:reject-hunt-fidelity` that runs:
     - `npx tsx src/api/agent/searchQuery.test.ts`
     - `npx tsx src/api/agent/AgentOrchestrator.test.ts`

### Must not count as Pass

- Any test whose only Parent evidence is a full raise line with successful body fetch.
- Any “live” wrong-floor test whose hit class/line is absent from the fixture file.
- Green local ship:a while CI still skips those files.

### Rule cross-check

Align with `.cursor/rules/reject-hunt-attach-before-miss.mdc`:

> Unit tests that only mock happy-path body fetch → Fail.  
> Regression: hit has raise **or message-only** + `readRemoteFile → undefined` → still attach.

---

## Appendix — Skeptical notes for other agents

- Late tests at the bottom of `AgentOrchestrator.test.ts` (≈L3879+) are **necessary but not sufficient**. They do not close the T2 paraphrase × message-only hole.
- `decorateToolResult` recovery today re-adds `isServerWritePath` / `contentLooksLikeAskedFieldReject` hits when preferred is empty — but **attach** still requires `contentLooksLikeAskedFieldReject`, which fails for T2+message-only. Keeping preferred non-empty does not equal attach Pass if body fetch fails.
- Prefer fixing the matcher to treat field-named API error strings as reject evidence even without ask quotes, **or** ensure Exact dogfood is the only supported ask — product must pick one; tests must encode both until decided.
