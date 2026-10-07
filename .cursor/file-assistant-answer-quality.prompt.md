# File-assistant answer quality — fix once

Paste this whole file into a **new** agent chat. Research first, then ship one complete L-answer contract. Do **not** land another one-line strip, heading filter, or “reload and try again” patch.

Do not weaken indexed-repo locate. Do not reopen leftover-job routing unless a test proves it regressed.

---

## Why the last sessions failed (read this)

This is the same user turn, dogfooded three times:

> Local file, no slash, no Workflows.  
> “If I make any changes to this file, what else should I check?”  
> Chip: `file: /Users/jonraney/Desktop/cody-vs-main/src/Cody.Core/Agent/SetHtmlEvent.cs` (L / Local).  
> UI: Explored 1 file. File was read.

| Session | What shipped | What the user still saw |
|---|---|---|
| 1 | Drop leftover locate jobs; skip canned remote-search replace | Streamed a decent file answer, then **finish swapped** it for “remote code search did not return a usable implementation file.” |
| 2 | Skip leftover incident / callers / packages on L; expand `LOCAL_FILE_PATH_DIRECTIVE` | Routing Pass. Quality Fail: **Technical checks / Security / Tests / Where to look next**, invented DI, audit, rotation, and “If you want I can search.” |
| 3 | Same directive + `enrichFileAssistantResponse` (cut at first `**Heading**`, drop “If you want I can”, append honest-limit) | Lead still invented **every consumer, serialized contracts, callers, serializers, docs, tests**, then a checklist and a patch offer. The stripper, if it even ran in that Host, only helps after the first heading. It does **not** fix an invented first paragraph. |

The pattern is the same each time: fix the last symptom, leave the writer that caused it.

**Stop doing that.** The product gap is not “one more regex.” L turns still use the **generic chat system prompt**. That prompt tells the model to be dense, actionable, and teammate-helpful. “What else should I check?” then becomes a review + search plan. A last-line user directive does not beat that. A heading trim does not rewrite an invented lead.

---

## What already shipped (do not regress)

Routing / leftover-state (keep green):

- `isFileAssistantSession` / `applyFileAssistantIntentPlan` / `jobsKeptOnFileAssistantTurn` in `src/context/sessionMode.ts`
- `resolvePlainChatSynthesisRoute({ sessionMode })` — L + leftover locate → `plain`, not `intent-job`. L + leftover incident English → not `incident`.
- `enrichIntentJobResponse` — `fileAssistant` / `localWorkspaceAttached` must not replace with the canned remote-search miss. N5 in `src/chat/intentPlanner/chatIntentSynthesis.gates.test.ts` still uses that canned text on indexed-repo empty locate.
- `enrichChatResponseForAction({ fileAssistant })` skips leftover Use-repo incident / callers / package injectors and does not run hunt-miss intern-speak (“in this repo”).
- Empty change-hunt must not substitute `CUSTOMER_EMPTY_HUNT_ANSWER` (“I couldn't find that in this repo”) on L.

Prompt / trim (incomplete — you may replace, do not delete path wording):

- `LOCAL_FILE_PATH_DIRECTIVE` in `src/prompts/systemPrompts.ts` is now a local-file turn directive + path wording. Appended from `formatChatMessageWithLocalFiles` and `buildUserMessageWithContext` when `fileAssistant` is true. **User-message last line only.** System prompt is still generic `chat`.
- `enrichFileAssistantResponse` in `src/chat/fileAssistantAnswer.ts` cuts at the first topic heading / “If you want I can” and may append an honest-limit sentence. **L-only.** Must not run on R, intent-job, or slash. This is a safety net, not the product.

Path wording still required: call it a local file and use the path. Do not write “in the repo”, “this repository”, “the codebase”, or a GitHub repo name.

Do not special-case `SetHtmlEvent.cs`, `SecretNotificationHandlers.cs`, or the string “what else should I check.”

---

## The remaining Fail (quality, not routing)

Latest user-visible answer (10:24, same L file). Routing did not enter Blast or the canned remote miss. The answer still failed the bar:

```
If you change the local file \Users\...\SetHtmlEvent.cs, check every consumer and any
serialized contracts that depend on these event types/properties — renaming a property
is a breaking change. Also note the apparent typo Messsage on SetWebviewRequestEvent
… update callers, serializers, docs, and tests.

**Concrete spot to review**
[citation of Messsage]

**Quick checklist (what to search & update)**
Search the codebase … JsonPropertyName … full build … NuGet … release notes

**Risks & small improvements**
[Obsolete] shim, constructors, EventHandler<T>

If you want, I can produce the exact code patch to rename Messsage to Message …
```

What is actually in the attached ~file: `EventArgs` subclasses (`SetHtmlEvent`, `SetWebviewRequestEvent` with `Handle` + `Messsage`, `AgentResponseEvent`). That is the evidence. `Messsage` is in the file. Consumers, serializers, NuGet, test plans, and a patch offer are not.

Grade: routing Pass, quality Fail. Too long. Most of it is not in the file.

---

## Confirmed cause (verify; do not treat as optional)

1. L synthesis still picks `useCase: "chat"` (`continueChatAfterContext` → `resolveChatUseCase` / `useCaseForSynthesisRoute` → `systemPromptForUseCase("chat")`).
2. `GENERAL_CHAT_BODY` + `OPERATING_CONTEXT` in `src/prompts/systemPrompts.ts` tell the model: professional engineer, concrete and **actionable**, **dense**, match depth to the ask. “Open-file explain / walk-through: one-screen briefing” **only** applies to explain/walk-through. “What else should I check?” is treated as an impact/review ask, so the model writes a checklist.
3. `LOCAL_FILE_PATH_DIRECTIVE` is appended on the **user** message. Last-line theory lost to the system prompt in live dogfood. Twice.
4. `enrichFileAssistantResponse` keeps the **entire lead** until the first `**Heading**`. The 10:24 Fail’s first paragraph already invents consumers / serializers / docs / tests. A heading cut cannot fix that.
5. Finish-time leftover-state enrichers are already skipped on L. They are not this Fail.

---

## Product law

- Plain English is plain chat. “If I change this, what else should I check?” must not enter Blast, Trace, locate hunt, intent-job remote-search, or a generic security/impact review. See `.cursor/rules/plain-chat-must-not-promote.mdc`.
- L file = attached body only. Named tools the user actually named may stay. Repo hunts and invented dependents do not. Zero-clone: no `rg`, disk walk, or “search the folder.” See `.cursor/rules/zero-clone-remote-only.mdc`. Honest limit: this turn only has the open file.
- Chat code surfaces: cite the open file with real integers + path. Do not dump the whole file. See `.cursor/rules/chat-code-surfaces.mdc`.
- Founder/PM quality: short, on the file, then stop. Extra headings are fatigue. See `.cursor/rules/founder-pm-comms.mdc`.

---

## Required behavior after this ship

For any L file (Explorer / git / external / untitled / absolute Desktop path) and a change / check / explain ask, **no slash, no Workflows**:

**PASS shape**

1. 1–3 sentences from the attached file. “Local file” + the path. Name symbols that are in the file.
2. Optional: at most 4 bullets that are contracts in that file (signatures, attributes, logging, return types). One short citation fence is allowed.
3. One honest-limit sentence: other files were not read, so callers / implementations of imported types are unknown.
4. Stop. No second heading. No offer to patch, search, or attach more files.

**PASS example** (bar, not a string the model must copy):

> The local file /Users/jonraney/Desktop/cody-vs-main/src/Cody.Core/Agent/SetHtmlEvent.cs defines three EventArgs types. SetWebviewRequestEvent has Handle and Messsage (spelled that way in the file). Other files were not read, so callers and any serializers are unknown.

**FAIL — must not appear on an L turn**

- Headings: Technical checks, Security & operational, Tests & integration, Where to look next, Concrete spot to review, Quick checklist, Risks & small improvements
- Invented dependents: “check every consumer”, “search the codebase”, “update all call sites”, EventHandler lists not in the file
- Invented ops: DI / container, threading, reentrancy, access control, audit logs, rotation, TTL, encryption at rest, JsonPropertyName, NuGet, release notes, test-plan lists — unless those words are in the attached file
- “If you want, I can produce a patch / search / attach more files”
- “in the repo” / a GitHub repo name
- Blast / Trace / Owner / “remote code search” / “no local clone is required”
- Stream-then-replace with the canned locate miss

Indexed-repo (R) is unchanged. Same-path clone of the remote pin stays R and may still use graph / dependents when that evidence is attached. Empty R locate still uses the N5 canned remote-search text.

---

## What “once and for all” means (implementation)

Ship **one** L-answer contract that wins on every L synthesis path. Three layers, one owner. Do not ship layer 3 without layer 1.

### Layer 1 — system prompt (required)

L turns must not use the generic “actionable / dense / checklist” chat contract as the winner.

Research the cleanest choke (prefer the smallest complete one):

- `systemPromptForUseCase("chat", { fileAssistant: true })` (or equivalent) builds or selects an L contract, **or**
- `withOutputContract` / `OPERATING_CONTEXT` gets an L override that is not limited to explain/walk-through.

Do **not** add a new billing `UseCase` unless you prove `chat` cannot carry a `fileAssistant` flag. If you add a use case, you must update types, `systemPromptForUseCase`, `CoopChatSession` stream `useCase`, and billing tests in the same commit.

The L system contract must include all six rules already sketched in `LOCAL_FILE_PATH_DIRECTIVE`:

1. Evidence = attached file body only. Imports may be named; do not describe how those types work, get registered, or get called.
2. Shape: 1–3 sentence lead + at most 4 in-file bullets + one honest-limit sentence + stop.
3. Ban the review template on L unless those words are in the file.
4. “What else should I check?” = contracts in this file, not Blast and not a locate job.
5. No offer to continue (patch / search / attach more files).
6. Path wording: local file + path, never “in the repo.”

Wire `fileAssistant` into the **system** prompt path that `continueChatAfterContext` already uses (`sessionMode` is already sent on `streamChat`). Confirm the API/honored-model path does not drop the flag.

`fileAssistant: false` / omitted must not include those L-only lines (keep existing systemPrompts tests).

### Layer 2 — last-line user directive (keep, do not duplicate)

Keep `LOCAL_FILE_PATH_DIRECTIVE` on every path that already appends it (`formatChatMessageWithLocalFiles`, `buildUserMessageWithContext` when `fileAssistant`). If you rename the constant, update all call sites and `src/prompts/systemPrompts.test.ts`. Do not append the same essay twice. Path wording stays.

### Layer 3 — finish gate (required, L-only, not a second product)

`enrichFileAssistantResponse` (or its replacement) must run only when `fileAssistant` is true and there is no slash / quick action / integration provider.

It must do more than “cut at first heading”:

- Drop extra headings and everything under them (current behavior can stay as part of this).
- Drop “If you want I can…” offers.
- Drop leftover hunt/review **lead** language that the model invented: search the codebase, every consumer, all call sites, serializers/docs/tests to update, NuGet/release notes — unless those words appear in the attached file (you will not have the file body in the enricher; so refuse those **phrases**, do not try to invent a better lead).
- Ensure the honest-limit sentence is present.
- If the lead is only hunt language, do not return an empty bubble and do not substitute `CUSTOMER_EMPTY_HUNT_ANSWER`. Keep the in-file facts if any remain; otherwise keep a short honest-limit-only answer.

Must **not** run on R, intent-job, slash, or Workflows. Must **not** delete R dependents / Blast / incident sections.

Prefer one function, one call site (`enrichChatResponseForAction` when `fileAssistant`). Do not add a second trim in `CoopChatSession`.

### Do not

- Special-case this `.cs` file or this question string.
- Add `rg`, disk walk, or “search the rest of the folder.”
- Change `applyFileAssistantIntentPlan` job-clearing unless a test proves locate jobs are back on L.
- Leave L on generic `chat` and hope the last-line directive wins. Live dogfood already falsified that.
- Ship only a stronger regex and call it done.

---

## Part 1 — inspect (required)

Write the table in the reply. For each site: file, what it does on L today, whether the generic chat contract still wins, what the user would see, Pass/Fail.

1. Every L synthesis prompt: `systemPromptForUseCase`, `streamChat` `useCase` / `sessionMode`, `LOCAL_FILE_PATH_DIRECTIVE` append sites, `OPERATING_CONTEXT` open-file explain line.
2. Every finish rewriter that can still change an L bubble: `enrichFileAssistantResponse`, `enrichIntentJobResponse`, `enrichChatResponseForAction`, `rewriteCustomerFacingProse`, `CUSTOMER_EMPTY_HUNT_ANSWER`, agent-owned empty hunt (should already be off on L).
3. Similar L asks (same contract, do not special-case): “what does this file do?”, “explain this”, “walk me through this”, “review this”, “is this safe to change?”, “who calls this?”, outage English, “how is this repo structured?”, “check Slack too” (named tool may stay; leftover locate must not).
4. Confirm R + empty locate still gets N5 canned text. Confirm R ship-check may still use attached dependents.

---

## Tests

- `src/prompts/systemPrompts.test.ts`: L system and/or user prompt includes attached-file-only, max 4 bullets, no offer to continue, no “in the repo.” `fileAssistant: false` / omitted does **not** include those L-only lines. Keep “local file turn says local path and drops leftover Use-repo” in meaning (no `repo:` / `branch:` stamp on L).
- Fixture the 10:24 Fail (Quick checklist / “check every consumer” / “If you want I can produce the exact code patch”) and assert the **finish gate** removes checklist, hunt-lead phrases, and the offer, and keeps an honest-limit. Do not assert live model output.
- Keep `src/chat/fileAssistantAnswer.test.ts` / enrichment tests green or update them to the stronger gate. Keep L leftover Use-repo injectors skipped.
- If you touch sessionMode or synthesisRouting: L-drops-locate and R-keeps-intent-job stay green. N5 meaning unchanged.
- Run the touched test files only.

---

## Done when

- An L “what else should I check?” is **instructed at system-prompt level** to answer from the attached file in one screen and stop. Not only a user-message footnote.
- The 10:24 Fail (invented consumers + Quick checklist + patch offer) cannot survive the L finish gate.
- A short in-file lead (Messsage typo, EventArgs names) is kept. Hunt/review leftovers are not.
- R empty-locate still uses the canned remote-search answer.
- Path wording still says local file, not repo.
- The inspection table lists every prompt + finish site you checked.
- You did **not** ship another isolated regex and leave generic `chat` as the winner.

If layer 1 is not wired into the actual `streamChat` system prompt for L, you are not done.
