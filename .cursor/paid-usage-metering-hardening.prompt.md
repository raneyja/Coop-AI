# Paid usage metering — hardening build (Pro / Pro+ / Max)

Production-grade work. **Do not change the product model:** flat seat price (Stripe) + per-seat monthly included usage (internal USD-cent cap from catalog list rates) + hard stop at 100% + upgrade seat tier (Pro → Pro+ → Max → Enterprise). **Do not change free allowance** unless a shared helper forces a tiny neutral refactor — if so, call it out and keep free behavior identical.

**Do not** add on-demand overage billing, session-based 5-hour caps for paid, or team-wide usage pools.

---

## Goals (locked)

1. **Trust:** The usage bar and 429 blocks reflect real LLM spend we intend to cap. Silent under-recording is unacceptable for paid.
2. **Fair stops:** Users should not routinely pass quota at request start and finish far over cap, or get blocked on call 2 of 3 for a single composer send without a coherent product story.
3. **Billing truth:** What Stripe charges for a seat tier must match the usage cap tier applied to that person (`users.usage_tier` + `USAGE_TIER_LIMITS`).
4. **Autocomplete policy (locked):** Ghost text while typing does **not** consume monthly usage. **Accepting** a suggestion **does** consume monthly usage (same cent math as today’s inline LLM calls). Rejects/dismissals/tab-away = **$0** toward cap.
5. **Ship gate:** `npm run lint` clean; targeted automated tests for each fix; manual checklist for one paid test org.

---

## Locked product copy (autocomplete + monthly bar)

Use this wording (extension settings, `usageMeterCopy`, admin meter helper, `website/content/docs/plans-billing.md`):

> **Inline suggestions:** Coop may show ghost text while you type without using your monthly usage bar. **When you accept a suggestion** (Tab), that completion counts toward your monthly usage. Dismissing or ignoring suggestions does not.

Paid meter helper (`USAGE_METER_HELPER`) must still say chat, quick actions, edits, and model picks share the bar — and **add** the accept-only autocomplete sentence above.

Free tier: unchanged (autocomplete already skips free allowance check on fetch). Do not imply free users “pay per accept” unless free policy is updated elsewhere — this workstream is **paid only** for cap math.

---

## Canonical code (research must start here)

| Area | Files |
|------|--------|
| Cap limits & anniversary period | `src/server/usageTiers.ts` |
| Check, record, meters, event types | `src/server/planQuota.ts` (`LLM_USAGE_EVENT_TYPES`, `checkPaid`, `recordTokens`) |
| Event storage | `src/server/usageTracker.ts` |
| Cost & buckets | `src/config/modelCreditWeights.ts` |
| Model list rates | `src/config/llmModels.ts` |
| Chat gate + record | `src/api/chatApi.ts` |
| Inline LLM (today bills on fetch) | `src/api/inlineCompletionApi.ts`, `src/api/chatApi.ts` inline branch |
| Client inline fetch (strips usage today) | `src/api/CoopBackendClient.ts` (`fetchInlineCompletion`) |
| Autocomplete accept/reject | `src/autocomplete/registerAutocomplete.ts`, `src/autocomplete/coopAutocompleteProvider.ts` (`lastCompletionUsage` — **today only sessionMode/fileSource, no tokens**) |
| Usage events API (accept telemetry today) | `src/server/usageEventsApi.ts` → `usageTracker.record` only, **no** `planQuota` |
| Multi-call per user action | `src/chat/intentPlanner/frontDoorBilling.ts`, `frontDoorBilling.gates.test.ts` |
| Stripe seats & convert | `src/server/billing/*`, `src/server/users/userStore.ts` |
| UI meters | `admin/src/components/UsageQuotaMeter.tsx`, `src/webview/components/settings/SettingsDetailViews.tsx`, `src/config/usageMeterCopy.ts` |
| Analytics event types | `completion.requested`, `completion.suggested`, `completion.accepted`, `completion.rejected` |

**Critical today:** Paid cap sums `LLM_USAGE_EVENT_TYPES` including `completion.requested` (every ghost fetch). `completion.accepted` is **not** in that list. Accept events go to `/v1/usage/events` without `usdCents` quota metadata.

---

## Workstream A — Paid usage recording must not fail open

### Problem
`UsageTracker.record` catches insert errors and only `console.warn`s. Paid LLM can run with no `usage_events` row → cap enforcement drifts, COGS leak.

### Research — pass before design
- Trace every path that calls `recordTokens` / quota-relevant `usage_events` for paid orgs.
- Confirm ordering: check → model → record per route (`/v1/chat`, inline, accept path).
- Document behavior when `pool` is null vs insert throws.

**Pass:** Route table with ordered steps. **Fail:** Vague “make recording better.”

### Evaluation — pass before implementation
Choose one (justify): retry then fail; fail response after model (define stream behavior); outbox (last resort).

**Pass:** Decision + edge cases (SSE started, partial stream). **Fail:** Log-only fix.

### Build
- Paid (`effectiveUsageTier` set): agreed fail-closed or retry-until-recorded policy.
- Align with Workstream E so inline **fetch** no longer depends on record success for quota (accept path owns quota record).

### Test — pass/fail
- Mock insert failure on paid chat record → no silent success with missing event.
- Lint clean.

### Review
- [ ] Paid completion/quota paths cannot “succeed” without durable quota event when policy says they must.

---

## Workstream B — Pre-flight cap: estimate before serving paid LLM

### Problem
`checkPaid` ignores estimates; only past `usdCents` sum. Overshoot and parallel-tab races.

### Research — pass before design
- `estimateChatRequestTokens`, `billUsdCents`, inline body size vs estimate.
- Note: **accept-only autocomplete** pre-check runs on **accept**, not fetch (see E).

**Pass:** Formula doc per route. **Fail:** Token-weight path for paid caps.

### Evaluation
- `usedCents + estimatedCents >= limitCents` (optional small buffer for chat stream overrun).

### Build
- Wire into paid `check` for `/v1/chat` and inline **accept** quota path.
- Free unchanged.

### Test — pass/fail
- Near-cap estimate blocks; under-cap allows.
- Accept with estimate over cap → 429 before record (see E UX).

### Review
- [ ] Document residual race if any.

---

## Workstream C — One composer send, multiple model calls

### Problem
Multiple `/v1/chat` calls per send; separate checks/records; mid-flow blocks.

### Research — pass before design
- Inventory flows (front-door, quick actions, agent, evidence, retries).
- Table: user action → # HTTP calls → # quota records.

**Pass:** Inventory table. **Fail:** Fix one flow only.

### Evaluation
- Prefer **turn budget** via `quotaTurnId` (client + server).
- Document paid policy for hidden calls (`intent_suggest`, `evidence_preview`): still count unless product overrides.

### Build
- Minimal turn-coherent checks/messages per chosen strategy.

### Test — pass/fail
- Front-door gate tests updated with documented expectations.
- Manual: one send does not yield half-answer + surprise block without story.

### Review
- [ ] Free `quotaTurnId` message counting unchanged.

---

## Workstream D — Stripe subscription tier ↔ user usage tier reconciliation

### Problem
Stripe SKU vs `users.usage_tier` drift → wrong cap vs wrong invoice.

### Research — pass before design
- Webhook → `provisionOrg` / convert paths; sources of truth list.

**Pass:** Sequence diagram text + mismatch examples.

### Evaluation
- Detector + admin/ops alert and/or safe auto-repair when unambiguous.

### Build
- No silent “pay Pro+, cap Pro.”

### Test — pass/fail
- Fixture mismatch fires; repair or alert per design.
- Stripe test mode: checkout Pro+ → cap matches within 60s.

### Review
- [ ] Support runbook line for mismatch.

---

## Workstream E — Autocomplete: accept-only quota (LOCKED — not optional)

This is a **product law** for paid Pro / Pro+ / Max, not a fork.

### Policy (locked)

| Event | Monthly cap (`usdCents` sum) | `checkPaid` before action |
|--------|------------------------------|---------------------------|
| Inline LLM **fetch** (`/v1/completions/inline`) | **Does not count** | **Do not run** for quota (remove today’s paid check on inline fetch) |
| User **accepts** suggestion (Tab / accept command) | **Counts once** per accepted suggestion | **Run** check + record atomically on accept |
| User **rejects** / dismisses / Esc | **Does not count** | No |
| **Cache hit** (no LLM call) | **Does not count** on accept | No |
| NES / after-accept fetches | Research: if LLM runs, bill on accept of **that** suggestion or document $0 — **must not** bill on fetch |

**Billing math on accept:** Same as today’s inline record: Codestral (autocomplete assignment), `forceAutoBucket: true`, `billUsdCents`, store in `usage_events` with bucket + `usdCents`, event type **`completion.accepted`** (add to `LLM_USAGE_EVENT_TYPES`; **remove `completion.requested`** from that list).

Analytics telemetry (`completion.suggested`, `completion.performance`, `completion.rejected`) may continue via `/v1/usage/events` without affecting cap unless explicitly duplicated — avoid double-counting.

### Problem (why this is not a one-line change)

1. Server today records quota on **`completion.requested`** inside `inlineCompletionApi.ts` after LLM returns.
2. Client **`fetchInlineCompletion`** drops `usage` from JSON — extension never has tokens on accept.
3. **`lastCompletionUsage()`** only returns sessionMode/fileSource, not tokens/model.
4. Accept fires **`coopAI.internal.autocompleteAccepted`** → `recordUsageEvents("completion.accepted", …)` with **no** `planQuota.recordTokens`.
5. Accept is **after** insert in VS Code — research **command order**; ideal UX: **do not insert** if accept quota call fails (429).

### Research — pass before any implementation

**R1 — VS Code accept pipeline**

- Trace `buildInlineItem`, accept command, NES paths in `coopAutocompleteProvider.ts`.
- Determine earliest hook where quota check can run **before** text is applied.
- Document if fail-open accept is unavoidable; if so, product + eng must agree fallback (toast + next-chat block only — **fail** this research pass unless explicit sign-off).

**R2 — Token attribution**

- Inline API response fields today (`inlineCompletionApi.ts` JSON): `usage`, `model`, `provider`.
- Plan: return stable **`completionQuotaId`** (or reuse `contextHash`) + usage on every non-cached LLM response.
- Extension stores **pending quota** on the active suggestion: `{ completionQuotaId, inputTokens, outputTokens, provider, model, … }`.
- On accept: send to server; on reject/switch suggestion: clear pending.
- Multiple alternatives (Alt+]): each visible suggestion needs its own pending record or shared id — document choice.

**R3 — Cache & in-flight**

- `CompletionRouter` cache hits: accept must **not** call quota record (no LLM spend).
- Stale accept (pending expired): no record; log metric; do not guess tokens.

**R4 — Stream inline**

- If stream inline path exists, usage arrives on `done` chunk — same pending store as JSON path.

**Pass:** Research doc with sequence diagrams: fetch → show → accept/reject, with data on the wire at each step. **Fail:** “Bill accepted in analytics only.”

### Evaluation — pass before implementation

- **Server quota handler for accept:** Either extend `/v1/usage/events` to call `planQuota.check` + `recordTokens` when `eventType === "completion.accepted"` and metadata includes tokens, **or** add `POST /v1/usage/completion-accepted` (prefer one choke point; avoid duplicate logic).
- **Idempotency:** Same `completionQuotaId` accepted twice → one cap charge (unique constraint or metadata check).
- **Fail-closed (A):** If accept record fails, behavior per A (retry/toast); user must understand suggestion was free to see but accept didn’t land — minimize via pre-insert check.
- **Abuse:** Cannot spam accept without LLM pending; cannot use accept endpoint to bypass chat cap with fake tokens — validate server-side shape, rate limit if needed.

**Pass:** ADR paragraph + API contract (request/response, 429 body matches chat quota). **Fail:** Client-only fake `usdCents`.

### Build — pass before tests

**Server**

1. Remove `planQuota.check` on inline fetch in `chatApi.ts` inline branch.
2. Remove `planQuota.recordTokens` for `completion.requested` in `inlineCompletionApi.ts` (keep audit if separate).
3. Add `completion.accepted` to `LLM_USAGE_EVENT_TYPES`; remove `completion.requested` from that array.
4. Implement accept quota handler: resolve org plan/tier/user like `resolveChatOrg`; `checkPaid` with estimate from tokens; `recordTokens` with `eventType: "completion.accepted"`, `forceAutoBucket: true`, autocomplete model/provider.
5. Update `sumUsdCents*` queries/tests that assumed `completion.requested`.

**Extension**

1. `CoopBackendClient.fetchInlineCompletion`: parse and return `usage`, `model`, `provider`, `completionQuotaId` (generate id server-side if easier).
2. `CoopAutocompleteProvider`: maintain pending quota map keyed by suggestion id / contextHash; update `lastCompletionUsage` or replace with `pendingQuotaForAccept(contextHash)`.
3. `registerAutocomplete.ts` `autocompleteAccepted`: **await** quota accept API **before** or **as part of** accept flow per R1; on 429 show quota notice (reuse chat quota UX); do not count toward cap on failure.
4. Keep `recordUsageEvents("completion.accepted", …)` for analytics **or** merge into single accept endpoint — no double cap record.

**Docs / UI**

- Update locked copy (top of this doc) in all surfaces.
- Settings → Model & chat or autocomplete section: one short paragraph.

**Pass:** Lint clean; grep shows no paid `checkPaid` on inline fetch; grep shows cap record on accept path only.

### Test — pass/fail (automated)

**Server (`planQuota.test.ts` or new `autocompleteQuota.test.ts`)**

- Paid org: inline fetch records **no** `usdCents` toward sum (or no `completion.requested` in quota types).
- `completion.accepted` with tokens increases `usedCents` by `billUsdCents` amount.
- Two accepts same `completionQuotaId` → one charge.
- Accept over cap → 429, no increment (or increment 0).
- Reject event → sum unchanged.
- Free org: inline fetch still skips free allowance; accept does not break free allowance rules.

**Extension (unit or gate test)**

- Mock inline response with usage → accept command sends accept payload with tokens.
- Cache hit accept → no accept quota API call (or call with `cached: true` no-op server-side).

**Regression**

- `npm run test:autocomplete` if present; `frontDoorBilling.gates.test.ts` unchanged unless touched.

### Manual — pass/fail

Paid Pro test user:

1. Type until ghost text appears → **monthly bar unchanged** (or only non-autocomplete drift).
2. Tab accept → **bar moves** (small increment).
3. Esc dismiss on next suggestion → **bar unchanged**.
4. Fill bar via accepts + chat → accept → **blocked** with same upgrade copy as chat 429.
5. At cap, ghost text may still **appear** (fetch uncapped) but **accept** refuses — confirm intended UX from R1.

**Fail manual:** Every keystroke/fetch moves bar; or accept never moves bar; or accept inserts then silent fail with no user message.

### Review checklist (E)

- [ ] Locked policy matches code paths (fetch free, accept billed).
- [ ] `LLM_USAGE_EVENT_TYPES` reflects accept-not-requested.
- [ ] No double charge (requested + accepted).
- [ ] Copy in extension + admin + docs identical intent.
- [ ] COGS note in PR: high-volume typists only billed on accept (expected).

---

## Workstream F — Secondary (Phase 2 if needed)

| Item | Action |
|------|--------|
| Anniversary reset copy | Teammate FAQ + `periodEnd` label |
| API key `user_id` null | Attribute or block LLM for keys |
| Stacked bar at 100% | Copy: total cap, not “frontier left” |

Do not block A–E on F.

---

## Execution order

1. **Research spike (all streams + E R1–R4)** — no code until route table + accept pipeline doc pass.
2. **E (autocomplete)** can parallel **A** once R1 pass — accept path must implement A’s record policy.
3. **B + C** after E contract known (accept estimate).
4. **D** parallel after billing research.

---

## Global ship gate

```bash
npm run lint
npx tsx src/server/planQuota.test.ts
npx tsx src/chat/intentPlanner/frontDoorBilling.gates.test.ts
# + new autocomplete quota tests
```

**Manual:** Chat cap, accept-only autocomplete (5 steps in E), seat convert, record-failure behavior (A), multi-send (C), Stripe tier (D).

**Ship fail:** Any E manual fail; lint red; paid inline fetch still in `LLM_USAGE_EVENT_TYPES` as `completion.requested`; accept does not move bar.

---

## Anti-patterns

- Billing ghost fetches on paid
- Billing accept in analytics only without `planQuota`
- Optional “count or don’t count” autocomplete — policy is locked above
- Overage SKUs, team pools, changing `USAGE_TIER_LIMITS` without product request
- Free allowance rewrite in same PR

---

## Deliverables

1. Research summary + accept pipeline diagram (E).
2. PR(s) tagged by workstream.
3. Tests listed above.
4. Support runbook: mismatch, 503, accept-at-cap, fetch-still-shows-ghost-text.
5. Final pass/fail table per workstream.

Start with **research spike**; implement only after each workstream’s **pass before design/implement** gates are met.
