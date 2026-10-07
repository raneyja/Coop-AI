# Free allowance and Upgrade to Pro

Production build. Do not change paid Pro, Pro+, or Max metering. Do not stop attaching the whole open file.

The extension’s “Upgrade to Pro” link currently opens the admin billing page. Signed-in free orgs already have `POST /v1/billing/upgrade-checkout-session`, which returns a Stripe Checkout URL and tags `existing_org_id` plus `upgrade`. `checkout.session.completed` already turns that same org into Pro through `linkPaidCheckoutToExistingOrg`. Reuse that path. Do not create a second org, and do not send an existing account through the public `checkout-session` route (that route returns 409 when the email already exists).

## Locked product rules

- Free model for every model call except autocomplete: `gemini-2.5-flash`. Chat, quick actions, edit, agent, intent, sources preview, and PR notes. The server enforces this for `plan === "free"` even if the client sends another model.
- Autocomplete stays on Codestral. An accepted suggestion counts as one message and spends the free dollar budget; fetching, showing, or dismissing a suggestion does not.
- Paid assignments and the model picker stay as they are.
- Still attach the whole file. Do not truncate it to save the allowance.
- Remove the 1.5× free credit-weight multiplier. Free is no longer a weighted-token meter.
- One cycle is a rolling 6-hour window.
- Inside a cycle, stop at **15 user messages** or **$1.75** of Gemini 2.5 Flash list cost, whichever comes first.
- A week stops at **$7** of that same cost. The week resets 7 days after it opened, anchored so the resume time is stable. Show the weekday and clock when that week opens again.
- One composer send, quick action, or edit counts as one message. Intent classification, autocomplete, and a length retry do not.
- Every Flash call in the cycle and the week adds real provider cost (input × $0.30 and output × $2.50 per million). Do not use the 1.5× weight. Do not round each call up to 1 cent. A 1-cent floor would trip the cap on cheap calls.
- Several model calls inside one Understand Repo or edit still count as one message and add every call’s cost.
- The account usage line has no numbers, no “80K”, no “15”, and no dollar amounts. It fills with whichever budget is furthest along: messages/15, cycle dollars/$1.75, or week dollars/$7.
- While they still have room, the line has no caption.
- Once, when the line crosses about 80%, say: “You’re close to the free limit.”
- Cycle used up: “You can continue at 6:44 PM. Upgrade to Pro for a monthly allowance.” Use their local time.
- Week used up, or both used up: “You can continue on Tuesday at 3:00 PM. Upgrade to Pro for a monthly allowance.” Use their local weekday and time. Never tell them to come back in five hours if the week is what blocked them.
- Same sentence in the chat notice and under the usage line. A button labeled **Upgrade to Pro** opens Stripe Checkout for this org.

## Research — pass before any code

Read and cite the current path. Fail this phase if a new checkout or a new org is proposed.

- `POST /v1/billing/upgrade-checkout-session` in `src/server/billing/billingApi.ts`
- `StripeService.createCheckoutSession` (`existingOrgId`, `upgrade`, success URL)
- `fulfillCheckout` and `linkPaidCheckoutToExistingOrg` in `src/server/billing/provisionOrg.ts`
- Extension settings “Upgrade to Pro” in `src/webview/components/settings/SettingsDetailViews.tsx` (today it opens `${adminBase}/billing`)
- Chat limit notice in `src/webview/components/QuotaExceededNotice.tsx` (today it links `upgradeUrl`, which is the pricing page)
- Free model routing in `resolveHonoredChatModel` (`src/config/featureModelAssignments.ts`). Free quick actions currently resolve to Sonnet and edit to GPT-5.1. That must stop.
- Free token math in `src/server/planQuota.ts` (`DEFAULT_FREE_TOKEN_LIMIT`, `billTokensForQuota`, the 1.5× weight)
- Admin portal already calls `upgrade-checkout-session` from `admin/src/lib/coopApi.ts`

Pass: a short note that names the reused session, the webhook, and the two UI buttons that must open it. Fail: a new Stripe product, a second organization, or a button that only opens `coop-ai.dev/pricing` or the admin billing page.

## Plan — pass before implementation

Write the touch list first. Fail if paid cents, seat convert, or file attachment is in the change.

- Server forces `gemini-2.5-flash` for every free `/v1/chat` use case. Autocomplete stays Codestral.
- Quota check and record use message count plus real Flash dollars for the 5-hour window and the week. Resume time is when the oldest events age out enough that both cycle rules are under the line again, and when the week is under $8.
- Snapshot for the extension is a fill ratio and, only when blocked, the resume time and which window (cycle or week). No token or credit counts in the payload the UI renders.
- One client action, used by the chat notice and by Settings, calls `upgrade-checkout-session` for tier `pro` and opens the returned Stripe URL in the browser.
- After Checkout success, the existing webhook sets that org to Pro. The extension refreshes the signed-in plan so the next chat is paid routing, the free line is gone, and the admin portal shows Pro on reload. Do not ask the user to reinstall.

Pass: the touch list matches the files above and says what each one will do. Fail: the plan still meters free users in weighted tokens, or the button targets the marketing site.

## Build — pass before tests

Implement only that list.

- Free over-the-limit response stays a 429 with `resetsAt` and the new sentence. It does not include used tokens, the number 20, or dollar amounts.
- Upgrade button states: opens Checkout, shows a plain error if Stripe is not configured or the user is not the org admin, and does nothing to the plan until the webhook marks the checkout paid.
- Cancel on Stripe leaves them on Free.
- A replayed webhook does not create a second org or a second seat.

Pass: `npm run lint` is clean. Fail: a free quick action or edit can still resolve to Sonnet or GPT-5.1, or the public checkout route is used for an existing account.

## Test — all must pass

Automated:

- A free chat and a free quick action are honored as `gemini-2.5-flash`.
- A paid Auto chat is not forced onto Flash.
- Message 15 in a 6-hour window is allowed. Message 16 is refused with a same-day clock and no token text.
- A cycle under 15 messages but at $1.75 is refused the same way.
- Weekly spend at $7 is refused with a weekday and clock, even if the 6-hour window is empty.
- An accepted autocomplete suggestion increments the 15; fetching, showing, dismissing, and an intent call do not.
- Two model calls inside one send increment messages by 1 and add both costs.
- Dollar sum is real cost. A tiny call is not stored as 1 cent against this cap.
- Upgrade checkout for a free org returns a Stripe URL and sends `existing_org_id` and `upgrade`.
- Completing that checkout updates the same org to Pro. A second org is not created.
- The quota notice and Settings both use “Upgrade to Pro for a monthly allowance” and the Upgrade to Pro button. The usage line has no digits when under the limit.

Manual, Stripe test mode, one free account:

1. Send a chat with a large file open. The file is still attached. The usage line moves a little and shows no numbers. The model on the request is Gemini 2.5 Flash.
2. Hit the cycle limit. The chat notice and the account line say they can continue at a clock time, with “Upgrade to Pro for a monthly allowance.”
3. Click **Upgrade to Pro**. The browser is Stripe Checkout, not the marketing site and not only the admin billing page.
4. Pay with a Stripe test card. Return through the success URL.
5. Extension Plan & Usage shows Pro without a reinstall. A new chat is not on Flash and is not stopped by the free cap.
6. Admin portal for that same login shows Pro on that same org.
7. Cancel a second checkout from another free account. That account stays Free.

Fail the manual pass if step 5 or 6 is still Free, or if step 3 did not open Stripe.

## Review — ship only if every line is true

- Whole files are still attached.
- Free never uses Sonnet, GPT-5.1, or the 1.5× weight.
- The cycle dollar cap is $1.75. It can stop a sitting before 15 messages when prompts are large. The dollar cap is what stops repeated max-size prompts.
- The user never sees 20, $2, $8, or a token count.
- Cycle copy uses a clock. Week copy uses a weekday and a clock. The week wins when both are blocked.
- Upgrade opens Stripe Checkout for the signed-in free org, the webhook upgrades that org, and both the extension and the admin portal show Pro.
- Paid metering, seat convert, and public new-account checkout are unchanged.
- `npm run lint` passed.
