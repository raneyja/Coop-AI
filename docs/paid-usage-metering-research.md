# Paid usage metering — research spike (A–E)

Status: **research pass**. No product-model change. No code in this spike.

Caps stay: flat Stripe seat price, per-seat monthly included cents (`USAGE_TIER_LIMITS`), hard stop at 100%, upgrade Pro → Pro+ → Max → Enterprise. No overage, no paid 5-hour windows, no team pools. Free allowance behavior stays as it is.

---

## Gate table

| Stream | Research | Evaluation (decision below) | Build |
| --- | --- | --- | --- |
| A Recording must not fail open | **Pass** | **Pass** — hold before the model | Not started |
| B Estimate before serve | **Pass** | **Pass** — cents, not token weights | Not started |
| C One send, many calls | **Pass** | **Pass** — finish this send; next send blocks | Not started |
| D Stripe tier vs cap tier | **Pass** | **Pass** — repair only when one tier; else alert | Not started |
| E Accept-only autocomplete | **Pass** (R1–R4) | **Pass** — server-priced accept endpoint | Not started |
| F Secondary | Out of scope | — | Do not block A–E |

---

## A — Paid recording must not fail open

### What happens today

`PlanQuotaService.recordTokens` always calls `UsageTracker.record`. That method:

- **`pool` null:** returns immediately. No row. No error.
- **Insert throws:** `console.warn` only. Caller still succeeds.

`checkPaid` is stricter: if `canRead()` is false (`pool` null), it throws `PlanQuotaUnavailableError` → HTTP **503** before the model. So a missing database blocks the start. A database that dies, or an insert that fails, after the check does not.

`POST /v1/usage/events` is not a quota writer today, but it will become one if `completion.accepted` is added to the cap sum and the client can set `usdCents`. The sum uses a **signed** integer (`^-?\d+$`), so a client can post negative cents and shrink the bar. Quota math must not trust that endpoint.

### Route table (ordered)

| Route | Steps today | `pool` null | Insert throws |
| --- | --- | --- | --- |
| `POST /v1/chat` | Resolve org (user tier, else org tier) → `check` (paid branch ignores the estimate argument) → SSE headers **200** → stream deltas → on `done`, `recordTokens` `chat.message` → then write the `done` event | **503** before the model | Warn, `done` still sent, **no row** |
| `POST /v1/completions/inline` | Same `check` with `skipFreeAllowance: true` → LLM (JSON or SSE) → `recordTokens` `completion.requested` with `forceAutoBucket: true` | **503** before the LLM | Warn, ghost text still returned, **no row** |
| `POST /v1/usage/events` | Auth → `usageTracker.record` for each event. **No** `planQuota` | Handler 503 only if the tracker dependency is missing. A tracker with a null pool returns **200** and writes nothing | Warn, still **200** |
| Accept command | `completion.accepted` via the events API. No tokens, no `usdCents` | Telemetry is swallowed in the extension | Same |

Only two production callers of `recordTokens`: `recordV1ChatUsageTokens` and `inlineCompletionApi` (stream `done`, and JSON after the body is sent).

Free recording uses the same `record()` swallow. **Do not change `UsageTracker.record`.** Paid quota needs its own method that throws. Analytics and free stay fail-open.

### Decision

**Retry, then fail the hold — before the model runs.** Not log-only. Not an outbox.

1. Paid chat only: after `check` passes, insert one durable quota row for this request (estimated cents, `requestId`). Retry 3 times, short backoff.
2. If the insert still fails: **503** `quota_metering_unavailable`. Do not open the SSE stream. Do not call the model.
3. On a normal `done`: update that row to actual `billUsdCents`. If the update fails, **leave the estimate** (we over-count rather than drop spend). The answer may finish, because a row already exists.
4. Provider error or client disconnect before `done`: leave the estimate in place. Same fail-closed bias.
5. `dev` org: skip, as today.

Edge cases:

| Case | Behavior |
| --- | --- |
| SSE already started | Must not happen for a failed hold. Deltas only start after the row commits. |
| Partial stream, no usage chunk | Hold stands at the estimate. |
| User Stop mid-stream | Hold stands at the estimate. |
| Free org | Unchanged. Still `record()`, still swallow. |
| Inline **fetch** | No quota row (see E). Accept uses the same throw-on-failure insert, and it runs **before** text is applied. |

Autocomplete accept does not need a pre-model hold: the LLM already ran on fetch (uncapped), and the insert is the accept itself. If that insert fails after retries, the accept API returns 503 and the editor does not keep the text.

---

## B — Estimate before serving

### What happens today

`/v1/chat` and inline fetch both compute `estimateChatRequestTokens(...)` and pass it into `check`. The parameter is named `_estimatedAdditionalTokens` and **is never read**. `checkPaid` blocks only when **past** `usedCents >= limitCents`.

`estimateChatRequestTokens` returns **weight-adjusted tokens** (`billTokensForQuota`), not cents. Paid caps are cents from `billUsdCents` (catalog list rates, 1 cent minimum if cost &gt; 0). Using the token estimate as if it were cents would be the wrong unit.

### Formula (cents)

**Chat `POST /v1/chat`** (paid only):

```
inputTokens  = estimateTokensFromText(history + message) + 2500
outputTokens = resolved maxTokens (default chat max, not a guessed weight)
estimatedCents = billUsdCents({ inputTokens, outputTokens, provider, model, visionWeighted })
block when usedCents + estimatedCents >= limitCents
```

The +2500 and the full `maxTokens` output are already the overrun buffer. Do not add a second buffer.

**Accept** (paid only): tokens are already known, stored on the server at fetch time.

```
estimatedCents = billUsdCents(stored input, stored output, codestral, forceAutoBucket)
block when usedCents + estimatedCents >= limitCents
```

No client-supplied cents. Exact, so no extra buffer.

**Inline fetch:** no check.

**Free:** `check` keeps ignoring the estimate. Free branch untouched.

### Residual race

Two tabs can both pass the same `usedCents` before either hold commits. The hold insert (A) narrows this to the gap before commit. It does not need a new lock table for v1. If both commits land, the second request’s check should re-read the sum **after** its own insert attempt fails the cap — implementation detail: re-check the sum in the same transaction as the hold insert, and roll the hold back if the new total would cross the cap.

---

## C — One composer send, many model calls

`beginQuotaTurn()` runs at the start of every `handleChatSend` and sticks on `SecureApiClient` until the next send. Every later `streamChat` (including PR notes) reuses that id. The server stores `quotaTurnId` on the row and uses it for **free message collapsing only**. Paid `checkPaid` ignores it.

Free rule to preserve: events with the same `quotaTurnId` and `countsAsMessage` count as **one** free message. `intent_suggest`, `evidence_preview`, `pr_summary`, and `inline_completion` do not count as a free message (`countsAsFreeQuotaMessage`).

### Inventory

| User action | `/v1/chat` calls | Quota rows today | Same `quotaTurnId`? |
| --- | --- | --- | --- |
| Plain chat, no interpreter | 1 answer | 1 `chat.message` | Yes |
| Plain chat, interpreter on | 1 `intent_suggest` + 1 answer | 2 | Yes, until re-entry |
| Slash / workflow re-entry | New `handleChatSend` → **new** id + 1 answer | 1 more | **No** — id reset |
| Length stop continue | +1 same send | +1 | Yes |
| Quick action | Interpreter (sometimes) + 1 answer | 1–2 | Yes |
| Agent locate / understand / change | Tool-plan each round (max 8) + opened-hit notes (1 per hit, `useCase: "chat"`) + 1 answer + optional length continue | Often 3–12 | Yes, this send |
| Sources AI blurbs | `evidence_preview`, one or more, fail-open | 1 per blurb | Yes if inside the send |
| PR notes button | 1 `pr_summary` | 1 | **Stale id** from the previous send |
| Inline ghost | Not `/v1/chat` | `completion.requested` today | No |

Hidden calls **still count toward the paid bar** (`intent_suggest`, `evidence_preview`, tool-plan, opened-hit notes, PR notes, length continue). No product exception.

### Decision

**This send finishes. The next send blocks.**

1. First paid call in a turn runs the estimate check (B) and writes the hold (A).
2. Later `/v1/chat` calls with the **same** `quotaTurnId` skip the hard stop and still record actual cents (update or extra rows — extra rows are fine; they must not be dropped).
3. Clear `quotaTurnId` when `handleChatSend` ends, so PR notes and the next send are checked on their own.
4. Slash re-entry that is still the same user send must **reuse** the id (do not call `beginQuotaTurn()` again).
5. Free message counting stays on `countsAsMessage` + `quotaTurnId`. Do not change `countFreeMessages`.

Residual: an agent turn can record several calls after the bar was already near full. The user story is one sentence: this reply finishes; the next one is blocked. Parallel opened-hit notes can race the first check; the hold re-check in B covers that as well as it can without a queue.

---

## D — Stripe seat vs usage cap

### Sequence

```
Checkout (tier on the session)
  → fulfillCheckout: org plan pro, org usage_tier, admin user.usage_tier = that tier
  → webhook customer.subscription.updated
       → homogeneous inventory: org.usage_tier = that tier
       → mixed inventory: org.usage_tier left as-is (fallback Pro)
       → does NOT rewrite each users.usage_tier
       → canceled: plan free, clear every users.usage_tier

Convert one person
  → Stripe subscription item quantities change first
  → then users.usage_tier = new tier
  → org seat inventory updated
  → webhook may run before or after the user row write
```

Cap resolution (`resolveChatOrg`): **user.usage_tier, else org.usage_tier, else Pro** on a `pro` plan. Enterprise and free do not use monthly cents.

### Mismatch examples

| What Stripe has | What the cap uses | Result |
| --- | --- | --- |
| All seats Pro+ | User row still `pro` (webhook never updates users; convert crashed after Stripe succeeded) | Pay Pro+, cap Pro |
| All seats Pro | User row `max` (convert user write happened, Stripe webhook not applied, or manual DB) | Pay Pro, cap Max |
| Mixed Pro and Max | Org `usage_tier` is a single label; each user row is the real cap | OK if user rows match who sits in which SKU. Not OK if a user row was never written |
| Unknown price id | `usageTierFromStripePriceId` returns **Pro** and logs a warning | Custom price billed, cap Pro |
| User row null, org Pro+ | Cap uses org tier | OK |
| API key with `user_id` null | Sum is `user_id IS NULL`, tier from org | Separate ghost pool, not a person’s bar. Workstream F. Do not block A–E |

### Decision

Detector on subscription webhook and after convert:

- **Homogeneous** subscription (every paid item is one known price) and a user’s `usage_tier` differs → **set the user to that tier**. Unambiguous.
- **Mixed** inventory and a user’s tier is not one of the purchased tiers → **alert only** (audit log + ops). Do not guess which person is Max.
- **Unknown price** → alert. Do not silently treat it as Pro for new writes. Existing Pro fallback can stay for checkout continuity, but the alert is the support signal.
- Convert: if Stripe succeeded and the user write fails, the detector on the following webhook repairs the homogeneous case. Add an explicit error path so convert does not return success when the user row did not update (already throws today if `setUserUsageTier` returns false — good).

### Support runbook — mismatch

Org paid Pro+ (or Max) on Stripe, person still blocked at the Pro cap (or the reverse):

1. Ops: Stripe subscription items vs `users.usage_tier` for that email.
2. If every seat is the same price and the user row disagrees, the webhook repair should have fixed it within a minute. Re-send the subscription event or run the repair once.
3. If the subscription mixes Pro and Pro+ / Max, do not auto-change the person. Match them to the seat the admin converted. Convert again from the admin portal if the row is wrong.
4. Unknown Stripe price: the cap is not trustworthy. Fix the price id env (`STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_PRO_PLUS`, `STRIPE_PRICE_ID_MAX`) before telling the customer to retry.

Checkout Pro+ → that admin’s cap is Pro+ within webhook latency (target 60s). Test already covers the checkout metadata path in `billingApi.test.ts`; the new test is a user row stuck on `pro` while the subscription is all Pro+.

---

## E — Accept-only autocomplete

### Policy (locked)

| Event | Monthly cap | Check before the action |
| --- | --- | --- |
| Ghost fetch `/v1/completions/inline` | No | No (remove today’s paid check) |
| Accept (Tab or accept command) of an LLM suggestion | Yes, once | Yes |
| Reject / Esc / dismiss | No | No |
| Cache hit | No | No |
| LSP or pattern suggestion | No | No |
| NES / next ghost after accept | No on that fetch. Yes when **that** ghost is accepted, if it came from an LLM call | On accept only |

Math: Codestral assignment, `forceAutoBucket: true`, `billUsdCents` (in $0.30 / M, out $0.90 / M, 1 cent floor). Event type `completion.accepted`. Remove **new** `completion.requested` quota rows.

**Deploy effect:** `completion.requested` leaves `LLM_USAGE_EVENT_TYPES`, so ghost cents already stored this period **drop off the bar** on deploy. That matches the new rule (those fetches should not have counted). Say so in the PR. Do not also write `completion.accepted` for old fetches.

Analytics (`completion.suggested`, `completion.performance`, `completion.rejected`) stay on `/v1/usage/events` and must not carry `usdCents` or `bucket`. One `completion.accepted` row, written only by the accept quota handler.

### R1 — When text is inserted

`InlineCompletionItem.command` runs **after** VS Code inserts the text. Today that command is `coopAI.internal.autocompleteAccepted`, and it only sends analytics. It cannot refuse the insert.

VS Code engine is `^1.92.0`. `handleDidShowCompletionItem` is on the provider and is the hook that means **our** ghost is on screen (Copilot shares the generic `inlineSuggestionVisible` context, so a bare Tab override would steal Copilot accepts).

**Pre-insert path (primary):**

1. On show, set context `coopAI.coopInlineVisible`.
2. Tab, and the partial-accept commands (`acceptNextWord` / `acceptNextLine`), while that context is set, run `coopAI.acceptInlineWithQuota` instead of the built-in commit.
3. That command awaits the accept API. **429 or 503:** hide the ghost, show the same upgrade notice as chat, do not commit. **200:** `editor.action.inlineSuggest.commit`.
4. The item command still runs after insert for hot streak and NES arm only. It must **not** call the quota API again.

**Backstop:** command palette `editor.action.inlineSuggest.commit` skips the keybinding. Text lands, then the item command runs. If the quota call then returns 429 or 503, run **one** `undo` (VS Code puts the inline insert in its own undo stop) and show the same notice. That is not a silent success.

R1 passes. Fail-open accept is not the design.

### R2 — Token attribution

Server generates `completionQuotaId` (uuid) on every non-cached LLM inline response. It stores the real token counts server-side (short-lived row, about 10 minutes, unique id, org + user). The client receives the id plus `usage`, `model`, and `provider` so the pending map can be built. **Accept sends only the id.** Fake token fields are ignored.

Pending map on the provider, keyed by `contextHash`:

```
{ completionQuotaId, source: "llm" | "cache" | "lsp" | "pattern", nes: boolean }
```

Clear on reject, supersede, or a newer fetch for that hash.

**Multiple alternatives:** one inline HTTP response is one LLM call, even if several ghosts are shown. They **share one id**. The first accept charges once. A second accept of the same id is a no-op success (already charged). Alt+] does not create a new charge.

### R3 — Cache and stale

`CompletionRouter` cache hit (`fromCache: true`) must not get an id. Accept skips the quota API.

LSP (`source: "lsp"`) and pattern fillers never get an id.

Stale accept (id missing, expired, or pending cleared): **no charge**, no guessed tokens. Response 404. Client does not insert (or undoes). Log a metric.

### R4 — Stream

The live autocomplete path is **SSE** (`streamInlineCompletion` → `stream: true`). The JSON helper exists and drops `usage` today; the stream helper drops `usage` on the `done` chunk (it keeps `model` and `provider` only).

`completionQuotaId` and `usage` go on the stream `done` chunk and on the JSON body. The extension stores them the same way. There is no second billing path for stream vs JSON.

### Wire sequence

```
Fetch (paid or free)
  Extension → POST /v1/completions/inline
  Server: no paid check, no quota cents
  LLM runs
  Server stores pending { id, tokens, model, provider, user }
  Server → text + done { completionQuotaId, usage, model, provider }
  Extension: show ghost, save pending by contextHash
  Bar: unchanged

Accept
  Tab → POST /v1/usage/completion-accepted { completionQuotaId }
  Server: load pending for this org+user
          checkPaid(used + billUsdCents(stored) >= limit) → 429, no insert
          else recordTokens completion.accepted (retry, else 503)
          mark id consumed
  200 → commit text, arm NES / hot streak
  Bar: moves by that one charge

Reject
  Esc → POST /v1/usage/events completion.rejected (analytics)
  Clear pending
  Bar: unchanged

Cache / LSP / pattern accept
  No completionQuotaId
  Commit text
  No quota call
  Bar: unchanged
```

### API contract

`POST /v1/usage/completion-accepted`

Request: `{ "completionQuotaId": string, "languageId"?: string, "nes"?: boolean, "sessionMode"?: string, "fileSource"?: string }`

| Status | Body | Bar |
| --- | --- | --- |
| 200 | `{ ok: true, charged: true, usdCents, usedCents, limitCents }` or `charged: false` when this id was already accepted | +cents once |
| 429 | Same JSON as `writePlanQuotaExceededResponse` (`error: quota_limit_reached`, `pool: "paid"`, upgrade copy) | unchanged |
| 404 | Unknown, expired, or not this user | unchanged |
| 503 | `{ error: quota_metering_unavailable }` after retries | unchanged |

Free org: **200** `{ ok: true, charged: false }` and no `recordTokens`. Inline fetch still uses `skipFreeAllowance`. Accept must not set `countsAsMessage`.

Abuse: no pending row, no charge. Client cents ignored. Public `/v1/usage/events` **strips `usdCents` and `bucket`** so it cannot mint or erase cap. Rate-limit the accept route per user (same order as inline fetch is fine; a tight cap like 60/min is enough).

### Copy (identical intent)

Add to `USAGE_METER_HELPER` in `src/config/usageMeterCopy.ts` and `admin/src/lib/usageMeterCopy.ts`, and to `website/content/docs/plans-billing.md`, and one short paragraph on Settings → Model & chat (autocomplete toggle):

> Inline suggestions: Coop may show ghost text while you type without using your monthly usage bar. When you accept a suggestion (Tab), that completion counts toward your monthly usage. Dismissing or ignoring suggestions does not.

The existing sentence stays: chat, quick actions, and models you pick share the bar; base uses less; frontier fills it faster.

### COGS

Ghost text is unpaid. A typist who never tabs does not move the bar and does cost an LLM call. That is the locked policy. Cache accepts are also unpaid, including when the cache was filled by an earlier LLM call the user dismissed — sunk cost, not recovered.

### Support runbook

| Situation | What the person sees | What it means |
| --- | --- | --- |
| 503 on chat | “Usage metering is temporarily unavailable. Try again in a moment.” No answer. | The quota row could not be saved. Nothing was served. Retry. |
| Accept at cap | Same upgrade sentence as chat 429. Ghost can still appear. Tab does not insert. | Fetch is uncapped. Accept is the stop. |
| Ghost while typing, bar still | Bar does not move until Tab | Expected after E. |
| Bar jumped down on deploy day | Old ghost fetches left the meter | Expected once. New accepts move it again. |
| Pay Pro+, blocked as Pro | See D runbook | Tier drift, not the usage bar math |

---

## Implementation order (when build starts)

1. E + A on the accept path (new endpoint, stop billing fetch, client pending + Tab gate).
2. A + B on `/v1/chat` (hold, cents estimate, events API cannot write cents).
3. C (turn id reuse / clear, skip hard stop after the first success in the turn).
4. D (homogeneous repair + alert).
5. Copy in extension, admin, docs.
6. Tests listed in the build prompt. `npm run lint`. Free `quotaTurnId` message tests unchanged.

Do not change `USAGE_TIER_LIMITS`, free allowance limits, or Stripe prices in this work.
