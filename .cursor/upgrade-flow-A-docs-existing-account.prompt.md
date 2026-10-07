# Upgrade flow A — Docs: existing account upgrade path

Paste this **entire file** into a **new** agent chat. Workstream **A** only. Do not change product code except doc-adjacent tests if any exist.

Research first. Write touch list. Implement. **`npm run lint`**. Pass/Fail table in reply. Do **not** commit unless Jon asks.

---

## Product law (locked)

- **In scope:** Tell people who **already have a Free account** how to upgrade **without** using Pricing → **Start Pro** / `/signup?tier=pro` (that path **409** for existing email).
- **Out of scope:** Rewriting Free tier model copy (Gemini Flash vs Auto). **Do not** edit pricing page Free feature bullets for model names.

Correct paths to document:

- **VS Code** → Settings → **Plan & Usage** → **Upgrade to Pro** → Stripe.
- **Admin portal** → **Billing** → **Upgrade to Pro** → Stripe.

---

## Research — pass before edits

Read and cite current text:

- `website/content/docs/plans-billing.md` (Pro section + “already have a free account” line)
- `website/content/docs/faq.md` (“How do I upgrade to Pro?”, Free plan bullet if it implies Pricing-only upgrade)
- `website/src/app/pricing/page.tsx` footer (“Already have an account? Sign in”) — optional one-line clarify only if it currently implies Start Pro after sign-in

**Pass:** Short note: what each file says today vs what must change. **Fail:** Vague “update docs.”

---

## Plan — pass before implementation

Touch list only these surfaces unless research proves another doc duplicates the wrong instruction:

| File | Change |
| --- | --- |
| `plans-billing.md` | Keep existing “do not second checkout” rule; add **Extension → Plan & Usage** as equal path to Admin Billing |
| `faq.md` | Replace “Pricing → Stripe checkout” with: new users → Pricing; **existing Free → Extension or Admin Billing → Upgrade to Pro** |
| `pricing/page.tsx` | **Optional:** footer sign-in line → “Upgrade from Billing or the extension” — **not** “Start Pro again” |

**Fail plan:** Any edit to Free model/marketing bullets on pricing. Any new Stripe product or API change.

---

## Build

- Prose: founder-readable, one happy path, no engineering jargon in customer-facing docs.
- Links: use existing `/docs/plans-billing`, admin portal URL pattern already in repo docs.
- `lastUpdated` on edited doc frontmatter if the file uses it.

---

## Test — pass/fail

**Automated:** None required unless you add a website content test; optional grep gate in an existing doc test file is bonus, not required.

**Manual (operator):**

1. FAQ “upgrade to Pro” does **not** tell an existing Free user to click Pricing **Start Pro** as step 1.
2. Plans & billing names **both** Extension and Admin Billing before Stripe.
3. Pricing page Free bullet still says rolling window / Auto (unchanged — **Pass** if untouched).

---

## Review checklist

- [ ] No Gemini Flash / “Auto only” rewrites on marketing pricing.
- [ ] Existing account path is explicit in FAQ and plans-billing.
- [ ] No code changes outside `website/` except lint-relevant imports (prefer docs-only PR).
- [ ] `npm run lint` if any TS touched; else `cd website && npm run lint` if website has lint in CI for edited paths — run what CI would hit for website edits.

**Ship Fail:** FAQ still says upgrade = Pricing → checkout for everyone with no existing-account branch.
