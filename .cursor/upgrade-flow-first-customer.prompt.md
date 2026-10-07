# Upgrade flow — Stripe-first, plan sync everywhere (first customer)

**Orchestrator.** Paste **one workstream section** into a **new** agent chat per session. Do not mix workstreams in one PR unless Jon asks. This chat is closed when you start a child session.

**Product law (Jon — locked):**

- Upgrades do **not** send signed-in users to **coop-ai.dev/pricing** or **Start Pro** signup to pay.
- **Free → Pro:** browser opens **Stripe Checkout** for the **existing org** (`upgrade-checkout-session`). Same org after webhook.
- **Pro → Pro+ → Max:** **confirm in product** → **charge card on file** (existing convert paths). No marketing site pit stop.
- After payment succeeds, **extension + admin** must reflect the new plan **without reinstall** and without “go click Billing again.”
- **Do not** change public Free marketing copy (Gemini vs Auto on the website). Out of scope.

**Do not** change: `USAGE_TIER_LIMITS`, Stripe prices, free allowance caps, public new-account `checkout-session` behavior (409 for existing email stays).

**Ship gate (every workstream):** `npm run lint` clean. Targeted tests listed in that workstream. Reply with Pass/Fail table. Do **not** commit or push unless Jon asks. See `.cursor/rules/agent-git-workflow.mdc`.

---

## Agent assignments

| Agent | Prompt file | Delivers |
| --- | --- | --- |
| **A — Docs** | `.cursor/upgrade-flow-A-docs-existing-account.prompt.md` | FAQ + plans-billing: existing Free → upgrade in Coop, not Pricing signup |
| **B — Paid cap UX** | `.cursor/upgrade-flow-B-paid-cap-stripe-first.prompt.md` | Chat paid 429 **Upgrade** = convert or request, not Admin Billing link |
| **C — Plan sync** | `.cursor/upgrade-flow-C-plan-sync-after-stripe.prompt.md` | After Stripe return, poll until plan/tier matches; no stale Free |
| **D — Paid metering** | `.cursor/paid-usage-metering-hardening.prompt.md` | Accept-only autocomplete + metering trust (separate epic; run after B/C or parallel) |

**Order:** C can follow B (shared extension handlers). A is independent. D does not block A/B/C.

---

## Global manual smoke (after A+B+C — one operator, Stripe test mode)

1. **Existing Free org** — Extension → hit free cap → **Upgrade to Pro** → URL host is **checkout.stripe.com** (not coop-ai.dev/pricing, not admin `/billing` only).
2. Pay test card → return → within **60s** extension **Plan & Usage** shows **Pro**; new chat is not Flash-blocked.
3. Same login → admin portal **Billing** shows paid without manual “upgrade again.”
4. **Pro org at cap** — chat notice **Upgrade** → admin: convert modal or charge path **without** opening admin Billing as the only action; member: request path.
5. **Wrong path still blocked** — `/signup?tier=pro` with email that already has Free → **409** (unchanged).

**Global Fail:** Any in-app upgrade primary action opens **coop-ai.dev/pricing** for a signed-in user. Any paid cap **Upgrade** that only deep-links to **Admin → Billing** with no convert/checkout/request.

---

## Final orchestrator review (Jon)

When all assigned agents report Pass:

- [ ] Existing Free users are not told to use Pricing **Start Pro** in docs.
- [ ] Free upgrade = Stripe for same org (already shipped; C makes reflection reliable).
- [ ] Paid cap upgrade = same ladder as Settings (convert / request), not Billing bookmark.
- [ ] Marketing site Free bullets unchanged (Gemini/Auto not required).
- [ ] D optional for first dollar but required before heavy Pro+ dogfood.
