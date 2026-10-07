# Upgrade flow — Stripe-first, plan sync everywhere (unified build)

Paste this **entire file** into a **new** agent chat. This chat is closed. Do not continue from pricing-analysis or chip threads unless this file says to.

You may run **Workstreams A → B → C → D in order** in this same chat, **or** Jon may split them — each workstream still has its own **Pass/Fail gate**. Do **not** mark the build done until **every assigned workstream** passes its gate and **Global manual smoke** passes.

Research first per workstream. Write touch lists before code. **`npm run lint`** before claiming any workstream Pass. Do **not** commit or push unless Jon asks. See `.cursor/rules/agent-git-workflow.mdc`.

---

## Product law (Jon — locked)

| Upgrade | Correct behavior |
| --- | --- |
| **Free → Pro** | Signed-in org → **Stripe Checkout** (`POST /v1/billing/upgrade-checkout-session`, `existing_org_id`, `upgrade`). **Same org** after webhook. **Not** public `/signup?tier=pro` (409 for existing email). |
| **Pro → Pro+ → Max** | **In product:** admin **Confirm upgrade** → charge card on file (`convertOwnSeat`). Member **Request upgrade**. **Not** marketing site. **Not** “open Billing and hunt.” |
| **After payment** | Extension + admin show new plan **without reinstall**. No second manual upgrade click. |

**Out of scope (do not do):**

- Rewriting marketing Free copy (Gemini Flash vs Auto on pricing page).
- Changing `USAGE_TIER_LIMITS`, Stripe prices, or free allowance caps.
- New Stripe products or second org on upgrade.
- Overage billing, team usage pools, paid 5-hour windows.

**Banned (Global Fail):**

- Any **signed-in** upgrade CTA whose **primary** action is **https://coop-ai.dev/pricing** or **Start Pro** signup.
- Paid usage cap **Upgrade** that **only** opens Admin **/billing** with no convert / request / checkout handler.

---

## Workstream map

| ID | Delivers | Depends on |
| --- | --- | --- |
| **A** | Docs: existing Free → Extension or Admin Billing → Stripe | — |
| **B** | Paid cap chat: Upgrade = convert or request (same as Settings) | — |
| **C** | After Stripe: poll until Pro; “Confirming upgrade…” UX | B touches shared handlers (OK same PR) |
| **D** | Paid metering hardening + accept-only autocomplete | Independent; run after A–C or parallel |

---

# Workstream A — Docs (existing account path)

## A — Research (pass before edits)

Read and cite:

- `website/content/docs/plans-billing.md`
- `website/content/docs/faq.md`
- `website/src/app/pricing/page.tsx` (footer sign-in line only — optional)

**Pass:** What each file says today vs required change. **Fail:** “Update docs” with no citations.

## A — Plan (pass before implementation)

| File | Change |
| --- | --- |
| `plans-billing.md` | Existing Free users: **Extension → Plan & Usage → Upgrade to Pro** **and** **Admin → Billing → Upgrade to Pro** → Stripe. Keep “do not second checkout with same email.” |
| `faq.md` | **New users:** Pricing → checkout. **Existing Free:** Extension or Admin Billing — **not** Pricing Start Pro. |
| `pricing/page.tsx` | **Optional only:** footer clarifies upgrade in app — **do not** change Free feature bullets. |

**Fail plan:** Edits to Free model bullets on pricing. Any backend/API change.

## A — Build

Docs only under `website/` unless lint requires otherwise.

## A — Test (pass/fail)

**Manual:**

1. FAQ upgrade steps branch new vs existing account.
2. Plans-billing names Extension + Admin Billing.
3. Pricing Free bullet unchanged (Auto / 5-hour OK to leave as-is).

**A Fail:** FAQ still says everyone upgrades via Pricing → checkout only.

## A — Review

- [ ] No Gemini/Auto marketing rewrite
- [ ] Existing-account path explicit
- [ ] Website lint if TS touched

---

# Workstream B — Paid cap: Stripe-first / in-app ladder

## B — Research (pass before design)

| Area | Files |
| --- | --- |
| Paid cap + next tier | `src/server/planQuota.ts`, 429 in `src/api/chatApi.ts` |
| Notice UI | `src/webview/components/QuotaExceededNotice.tsx`, `ChatPanel.tsx` |
| Host handlers | `CoopChatSession.ts` — `handleUpgradeToPro`, `handleConvertOwnSeat`, `handleRequestSeatUpgrade` |
| Settings reference | `SettingsDetailViews.tsx`, `connectionCopy.ts` (`resolveUpgradeCta`) |
| URL builder | `src/chat/quotaNotice.ts` (`buildQuotaExceededUpgradeUrl`) |
| Types / client | `src/chat/types.ts`, `CoopBackendClient.ts` |

**Pass:** Table — paid user at cap: chat **Upgrade** today vs Settings today. **Fail:** “Change link to Stripe” without convert/request.

## B — Evaluation (pass before implementation)

**Locked choke:**

- Extend quota notice payload: `upgradeAction`: `checkout-pro` | `convert-seat` | `request-seat`, plus `nextTier` / labels from meters.
- Webview dispatches same messages as Settings (`billing:upgrade-to-pro`, convert, request).
- **Paid:** button handler — **not** bare `<a href={upgradeUrl}>` to Billing/pricing for admin convert.
- **Free:** unchanged — `onUpgradeToPro` → Stripe URL only.

**Reject:** Admin sent to Billing page as only step. New public checkout for Pro+ convert.

## B — Build

- Remove `coop-ai.dev/pricing` fallback for **paid** cap when admin portal URL missing — show error or in-app action.
- Reuse `buildPaidCapMessage`, `seatConvert*Copy`, Settings convert modal patterns.
- Do not change `convertSeat.ts` SKU math or free allowance.

## B — Test (pass/fail)

```bash
npm run lint
npx tsx src/chat/quotaNotice.test.ts
```

Add/extend: paid cap → `convert-seat` for admin + `nextTier: pro_plus`; free still `checkout-pro`.

**Manual (Stripe test, Pro admin at cap):** Chat **Upgrade** → convert flow without manually opening Billing.

**B Fail:** Paid **Upgrade** only opens admin `/billing`.

## B — Review

- [ ] Free Upgrade to Pro → checkout.stripe.com
- [ ] Paid Upgrade = convert or request
- [ ] No pricing primary for signed-in upsell
- [ ] `npm run lint` clean

---

# Workstream C — Plan sync after Stripe

## C — Research (pass before design)

Trace:

- `CoopChatSession.handleUpgradeToPro` + `onDidChangeWindowState` → single `refreshAllSessionsPreferences`
- `admin/src/app/(admin)/billing/page.tsx` `handleUpgrade`
- `GET /v1/billing/checkout-status` in `src/server/billing/billingApi.ts`
- Webhook: `linkPaidCheckoutToExistingOrg` (do not duplicate)

**Pass:** Pay → webhook lag → UI gap in prose. **Fail:** “Refresh more” with no stop rule.

## C — Evaluation (pass before implementation)

**Locked:**

- After opening upgrade checkout: **bounded poll** (~2s interval, **max 60s**) until `plan === "pro"` or timeout.
- Poll on window focus **and** after checkout opens.
- UI: “Confirming upgrade…” while still Free post-checkout (reuse seat-convert processing tone).
- Success: refresh prefs, clear pending, optional toast “You're on Pro.”
- Timeout: plain copy — not pricing page.
- Admin: if `session_id` on return URL, same poll/refetch.
- Cancel Stripe → stop poll, stay Free.

**Reject:** Infinite poll. Manual reload as only fix.

## C — Build

- Shared poll helper + extension host wiring; optional webview pending state.
- Admin billing post-checkout poll if applicable.
- No new checkout routes.

## C — Test (pass/fail)

```bash
npm run lint
```

Unit test poll: free→free→pro stops; timeout; cancel.

**Manual:** Free → pay → return VS Code → **Pro within 60s** without Cmd+R.

**C Fail:** Must reload or visit Billing again to see Pro.

## C — Review

- [ ] Same org (provisioning unchanged)
- [ ] Bounded poll
- [ ] Cancel path clean
- [ ] `npm run lint` clean

---

# Workstream D — Paid metering (trust + accept-only autocomplete)

**Canonical spec:** `.cursor/paid-usage-metering-hardening.prompt.md` — execute **Workstreams A–E** there with the same pass/fail gates. **Do not** change free allowance in D.

**D summary (locked product):**

- Ghost **fetch** does **not** move paid monthly bar; **Tab accept** does (`completion.accepted`, not `completion.requested`).
- Paid recording must not fail open; pre-flight cents estimate on chat; turn-coherent multi-call sends; Stripe tier ↔ `users.usage_tier` repair.

**D ship gate:**

```bash
npm run lint
npx tsx src/server/planQuota.test.ts
npx tsx src/chat/intentPlanner/frontDoorBilling.gates.test.ts
# + autocomplete quota tests when added
```

**D Fail:** Ghost fetch still bills paid bar; accept does not move bar; lint red.

Jon may defer D for first customer; A+B+C must Pass first.

---

# Global manual smoke (after A+B+C — Stripe test mode)

1. Free at cap → **Upgrade to Pro** → **checkout.stripe.com** (not coop-ai.dev/pricing).
2. Pay → return → **Pro in Plan & Usage ≤60s**; chat not Flash-blocked.
3. Admin same login shows paid without second upgrade click.
4. Pro at cap → chat **Upgrade** → convert/request **without** Billing-only detour.
5. `/signup?tier=pro` existing email → **409** (unchanged).

**Global Fail:** Any step above fails.

---

# Reply to Jon (required format)

1. **Pass/Fail table** — rows: A, B, C, D (or N/A if skipped), Global smoke.
2. **What shipped** — one line per workstream.
3. **Tests run** + lint result.
4. **Open Failures** — plain English, no code dump.

**Self-check (Boris bar):** Would a paying customer hit pricing or Billing twice to finish an upgrade they already paid for? If yes, Fail.

Do **not** commit or push unless Jon asks in that chat.
