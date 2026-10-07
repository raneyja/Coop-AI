# Upgrade flow B — Paid cap: Upgrade = convert or request (not Billing bookmark)

Paste this **entire file** into a **new** agent chat. Workstream **B** only. Do not implement plan-sync polling (workstream C) in the same PR unless trivial shared types.

Research first with subagents if needed. Inspection table. One **upgrade action choke** for paid quota notices. **`npm run lint`**. Pass/Fail. Do **not** commit unless Jon asks.

---

## Product law (locked)

When a **paid** user hits the monthly usage cap (`pool: paid` / auto / frontier):

| Role | Primary action |
| --- | --- |
| **Org admin**, next tier Pro+ or Max | Same as Settings → **Confirm upgrade** → charge card on file (`convertOwnSeat`). **No** “open Admin Billing and find the button.” |
| **Member** (non-admin) | **Request upgrade** (`requestSeatUpgrade`) — same as Settings. |
| **Free** | Unchanged: button → `upgrade-checkout-session` → Stripe (already shipped). |

**Banned for signed-in upgrade CTAs:**

- Opening **https://coop-ai.dev/pricing** as the primary paid-cap action.
- Opening **admin `/billing`** as the **only** action with no convert/request/checkout handler.

Fallback to admin Billing is allowed **only** when convert/request APIs are unavailable (503) — show plain error, not silent redirect to pricing.

---

## Research — pass before design

Canonical code today:

| Area | Files |
| --- | --- |
| Paid cap message + next tier | `src/server/planQuota.ts` (`buildPaidCapMessage`, `buildPaidUsageMeters`, 429 body) |
| Notice UI | `src/webview/components/QuotaExceededNotice.tsx` |
| Chat wiring | `src/webview/ChatPanel.tsx`, `src/chat/CoopChatSession.ts` (quota notice payload, `handleConvertOwnSeat`, `handleRequestSeatUpgrade`, `handleUpgradeToPro`) |
| Settings reference UX | `src/webview/components/settings/SettingsDetailViews.tsx`, `connectionCopy.ts` (`resolveUpgradeCta`) |
| Upgrade URL builder | `src/chat/quotaNotice.ts` (`buildQuotaExceededUpgradeUrl` → admin `/billing` or **pricing**) |
| Server 429 fields | `src/api/chatApi.ts`, `src/api/CoopBackendClient.ts`, `src/chat/types.ts` |

**Pass:** Table: user state → what chat **Upgrade** does today vs Settings. **Fail:** “Change the link to Stripe.”

---

## Evaluation — pass before implementation

Choose one choke (justify in plan):

1. **Preferred:** Extend quota notice payload with `upgradeAction: "checkout-pro" | "convert-seat" | "request-seat"` + `nextTier` + `nextTierName`; webview dispatches same messages as Settings (`billing:upgrade-to-pro`, convert, request). Remove paid `<a href={upgradeUrl}>` for convert/request cases.
2. **Reject:** Link-only fix that still sends admins to Billing page first.
3. **Reject:** New public checkout for paid seat convert (use existing convert API).

**Free org:** Still `onUpgradeToPro` only. Do not show convert-seat for Free.

---

## Build — pass before tests

- `buildQuotaExceededUpgradeUrl`: for paid cap notices, **do not** use `coop-ai.dev/pricing` when `adminPortalUrl` is missing — use in-app action or error; document behavior in test.
- Paid notice button label: match server message (“Upgrade to Pro+”, etc.) — reuse `buildPaidCapMessage` / meter `nextTierName` where possible.
- Admin convert errors: reuse Settings toast / notice patterns (`seatConvertErrorCopy`).
- Do **not** change Stripe SKUs, `convertSeat.ts` billing math, or free allowance.

---

## Test — pass/fail

**Automated (required):**

- `src/chat/quotaNotice.test.ts` — update if URL builder behavior changes.
- New or extended test: paid quota notice mapping — admin + `nextTier: pro_plus` → action convert (not external billing URL only).
- `connectionCopy.test.ts` or webview unit: paid cap notice renders **button**, not bare external link, for admin convert case (if test harness exists; else gate test on host message handler table).

Run:

```bash
npm run lint
npx tsx src/chat/quotaNotice.test.ts
# + any new test file you add
```

**Manual (Stripe test mode, paid Pro admin at cap):**

1. Hit cap → chat notice → **Upgrade** → confirm modal or processing copy (same family as Settings) → seat becomes Pro+ without visiting Billing page manually.
2. Member at cap → **Request** path; no convert modal.

**Fail manual:** Admin **Upgrade** only opens admin Billing tab with no convert flow.

---

## Review checklist

- [ ] Free **Upgrade to Pro** still opens Stripe Checkout URL directly.
- [ ] Paid cap **Upgrade** matches Settings ladder (convert / request).
- [ ] No new path sends signed-in users to coop-ai.dev/pricing for paid upsell.
- [ ] `npm run lint` passed.
- [ ] Boris bar: wired on hot path, not a docs-only “use Billing” note.
