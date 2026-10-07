# Upgrade flow C — Plan sync after Stripe (no stale Free)

Paste this **entire file** into a **new** agent chat. Workstream **C** only.

Research first. Plan touch list. Implement polling + UX. **`npm run lint`**. Pass/Fail. Do **not** commit unless Jon asks.

---

## Product law (locked)

After **Free → Pro** Stripe Checkout completes:

1. Webhook upgrades the **same org** (existing `linkPaidCheckoutToExistingOrg` — do not duplicate).
2. User returns to VS Code (or admin portal). Within **60 seconds** without reinstall:
   - Extension **Plan & Usage** shows **Pro** (free bar gone).
   - Preferences used for chat: not Flash-forced, not free-capped.
3. Show **“Confirming upgrade…”** (or reuse seat-convert processing copy family) while plan is still `free` but checkout was started — not silent stale Free.

**Out of scope:** Rewriting webhook provisioning. New Stripe products. Paid Pro+ checkout via Stripe Checkout (convert stays in-app charge).

---

## Research — pass before design

Trace today:

| Step | File / behavior |
| --- | --- |
| Open checkout | `CoopChatSession.handleUpgradeToPro` → `createUpgradeCheckoutSession` → `openExternal(session.url)` |
| Return refresh | `onDidChangeWindowState` → **one** `refreshAllSessionsPreferences()` when focused |
| Admin Billing upgrade | `admin/src/app/(admin)/billing/page.tsx` `handleUpgrade` → redirect Stripe → return to admin |
| Plan source | Extension prefs fetch; admin `useOrgPlan` / billing fetch |
| Checkout status API | `GET /v1/billing/checkout-status?session_id=` in `billingApi.ts` (if usable for poll) |

**Pass:** Sequence diagram text: pay → webhook lag → what UI shows today (gap). **Fail:** “Refresh more often” without defining stop condition.

---

## Evaluation — pass before implementation

**Decision (locked unless research proves impossible):**

- After opening upgrade checkout URL, extension starts **bounded poll** (e.g. every 2s, max 60s) of org plan / billing status until `plan === "pro"` or timeout.
- Poll triggers: window focus **and** immediately after `openExternal` returns (user may already be back).
- On success: refresh preferences, clear “confirming” state, optional subtle toast “You're on Pro.”
- On timeout: plain message — “Payment received? Open Plan & Usage or wait a minute and try chat again.” Not pricing page.

Admin portal: after return from Stripe with `session_id` query (if present on success URL), poll same status endpoint or refetch billing until paid — mirror extension behavior.

**Reject:** Infinite poll. Requiring user to reload window manually as the only fix.

---

## Build — pass before tests

Touch list (minimal):

- Extension host: `handleUpgradeToPro` + shared `pollPlanUntilUpgraded()` (or name it) using existing API client methods — **no** new public checkout route.
- Webview: optional `settings:upgrade-pending` / processing banner on Plan & Usage (reuse `seatConvertProcessingCopy` tone if paid upgrade pending).
- Admin billing page: post-checkout poll if `session_id` in URL.
- Do **not** break cancel path (user closes Stripe → stays Free, poll stops).

---

## Test — pass/fail

**Automated (required):**

- Unit test poll helper: mock API — free → free → pro stops; timeout stops; abort on new checkout.
- If checkout-status handler exists, one test for “complete + org pro” response shape (fixture from `billingApi.test.ts`).

```bash
npm run lint
npx tsx src/server/billing/billingApi.test.ts   # if you touch billing status
# + new poll unit test
```

**Manual (Stripe test mode):**

1. Free admin → Upgrade to Pro → pay → return to VS Code within 30s → Plan shows **Pro** without Cmd+R reload.
2. Simulate slow webhook (if possible in test): “Confirming upgrade…” visible, then Pro.
3. Cancel Stripe → still Free, no stuck “Confirming.”

**Fail manual:** Step 1 requires manual reload or second trip to Billing to see Pro.

---

## Review checklist

- [ ] Same org after webhook (no second org) — unchanged provisioning.
- [ ] Poll bounded and stops on success/cancel/timeout.
- [ ] Free → Pro still opens Stripe directly (B/C must not regress).
- [ ] `npm run lint` passed.
- [ ] No new dependency on coop-ai.dev/pricing for sync.
