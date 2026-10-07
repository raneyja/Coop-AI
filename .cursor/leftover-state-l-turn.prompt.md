# Leftover-state on file-assistant (L) turns — fix + inspect

Paste this whole file into a new agent chat. Research first, then fix. Do not weaken indexed-repo locate.

## What already shipped (do not regress)

A Desktop `.cs` file, no Use-repo, “If I change this file, what else should I check?” was answered with the canned remote-search miss. The local file had already been read.

That specific hole is closed:

- `applyFileAssistantIntentPlan` in `src/context/sessionMode.ts` now drops locate and code-host jobs, plus matching tasks/todos. Named Slack/Jira/docs jobs stay.
- `jobsKeptOnFileAssistantTurn` is the shared filter.
- `resolvePlainChatSynthesisRoute` takes `sessionMode`. File-assistant + leftover locate only → `plain`, not `intent-job`. Indexed-repo + locate still → `intent-job`.
- `enrichIntentJobResponse` takes `fileAssistant`. When true, it must not replace the model answer with the remote-search canned text.
- Tests: `src/context/sessionMode.test.ts` (L drops workflow + locate, keeps named tool). `src/chat/intentPlanner/chatIntentSynthesis.gates.test.ts` (L leftover locate is not intent-job; R leftover locate is; L open-file answer is not replaced). N5 still asserts “remote code search did not return a usable implementation file.”

Do not revert those. Do not special-case the `.cs` filename or the string “what else should I check.”

## The leftover-state rule (the real job)

The miss was not “we forgot the local file existed.” The file was on the turn. Leftover **indexed-repo hunt state** survived a cleanup that looked finished. Downstream steps only looked at that leftover state and only counted **remote** file bodies. The open local file did not count, so a good answer was replaced.

**Rule:** Local-file vs indexed-repo is a fact about the turn. Every step that can pick a writer, start a hunt, or replace an answer must be told that fact. Do not guess it from the question. A cleanup that leaves hunt fields behind is not done. A file already on the turn is evidence.

Same-path clone of the remote pin stays indexed-repo (R) and may still locate. A different local file, an absolute Desktop path, git, and untitled stay L. See `isFileAssistantSession` / `decideExplicitEditorChip`.

## Product law

- Plain English is plain chat. Do not enter Blast Radius, Trace, a locate hunt, or intent-job synthesis unless the user sent a slash command or a Workflows action on this turn. See `.cursor/rules/plain-chat-must-not-promote.mdc`.
- An L file is file-assistant: answer from the open file only. Named tools the user actually named may stay. Repo workflows and repo hunts do not. See `applyFileAssistantIntentPlan` and `src/chat/agentRouting.ts` (`fileAssistant` forces action `"none"`).
- Zero-clone: do not add a disk walk, `rg`, or local-clone search. See `.cursor/rules/zero-clone-remote-only.mdc`. Honest limit: this turn only has the open file.
- Local-path wording already shipped: `LOCAL_FILE_PATH_DIRECTIVE` in `src/prompts/systemPrompts.ts`. Do not regress it. An absolute path is a local file. Do not say “in the repo.”

## Part 1 — inspect (required, not optional)

Find every leftover-state hole of this class. Do not stop at the canned locate answer. For each call site, record: file, what leftover field it reads, whether it knows L vs R, what the user would see, and whether it is a Fail.

### Inspection checklist

1. **Every reader of `intentPlan.jobs` / `locateJobTerms` / `codeIntent.action`.** Does it receive `sessionMode` or `fileAssistant`? If it only sees leftover jobs, it is a hole even after `applyFileAssistantIntentPlan` if any caller skips that function.

   Confirmed readers to verify (do not treat as a complete list):

   - `src/chat/intentPlanner/frontDoorBilling.ts` — `resolvePlainChatSynthesisRoute` has **no** `sessionMode`. `planRawChatAskFromRules` does **not** run `applyFileAssistantIntentPlan`. An L ship-check can still pick `intent_job` for billing / model assignment / thinking.
   - `src/chat/CoopChatSession.ts` `enrichChatContextWithSemanticSearch` (~4077) — `locateJobTerms(request.params.intentPlan?.jobs)` then searches the leftover Use-repo. Later in the same function, `willRunIndexedCodeSearch({ fileAssistant: false, ... })` is hardcoded.
   - `src/chat/CoopChatSession.ts` `mergeIntegrationChatContext` (~5018 / ~5035) — still passes `jobs: request.params.intentPlan?.jobs` and treats `jobs.length > 0` as “spend gather budget.” Safe only if every request plan already went through `applyFileAssistantIntentPlan`.
   - `src/chat/agentRouting.ts` `agentTurnAllowsRepoTools` — a leftover locate job returns true. The loop is gated by `shouldRunAgentToolLoop({ fileAssistant })`, but any caller that forgets the flag can hunt the leftover Use-repo.
   - `src/chat/intentPlanner/intentPlanTrust.ts` — status / preamble still say “named files” / list locate jobs if those jobs are still on the plan.
   - `src/context/committedActivity.ts` — already takes `sessionMode`. Confirm leftover locate terms cannot seed “Searching the repo…” or “Find files that rely on…” on an L turn.

2. **Every answer rewriter that can replace or prepend based on empty remote evidence.** Same two-sided test as the locate canned text: L + leftover hunt keeps the open-file answer; R + empty remote evidence keeps the honest miss.

   Confirmed rewriters:

   - `enrichIntentJobResponse` — already flagged. Keep N5.
   - `src/chat/chatResponseEnrichment.ts` `enrichChatResponseForAction` — **no** `sessionMode`.
     - Incident: `isIncidentShapedQuery` wins in `resolvePlainChatSynthesisRoute` **before** jobs. An L outage ask still becomes `kind: "incident"`. `incidentCodePathsFromBundle` only walks `agentFiles` / `focusFiles` / `entryFiles` / `repoSemanticFiles`. It does **not** count `localFiles`. Then `enrichIncidentReconstructionResponse` can add **Code paths** / **Integrations** / **Gaps** as if this were a Use-repo incident.
     - Callers: `isFileCallerQuery` includes ship-check English. `enrichPlainChatCallerResponse` can prepend **Callers** from leftover Use-repo blast/dependents on the bundle.
     - Repo structure: `isRepoStructureQuery` / `isRepoPackageBoundaryQuery` can run `enrichPackageStructureResponse` and inject leftover Use-repo `apps/` / `packages/` on an L turn.
   - Customer-facing hunt miss: `CUSTOMER_EMPTY_HUNT_ANSWER` / “I couldn't find X in this repo” on an L turn.

3. **Every L-plan producer.** Confirm `applyFileAssistantIntentPlan` is the only choke and that every L caller uses it. If a plan is built from `planRawChatAskFromRules` / `planChatFrontDoorFromRules` and then used for synthesis, billing, gather, or activity without that choke, fix the choke — do not add a one-off in the UI.

4. **Thinking and activity.** If thinking is just the model following an `intent_job` / incident / locate prompt, fixing the route is enough. Do not add a second thinking filter unless research shows planner state is rendered as thought text on its own. Activity must not narrate a locate job, idle remote index, or empty remote dependents list on an L turn.

5. **Similar user asks on an L file** (absolute Desktop path, no repo/branch on the chip). For each: what route fires today, what leftover state it still has, what the user would see. Classification may stay for indexed-repo (R). It must not drive synthesis, gather, or replacement on L.

   - “If I change this file, what else should I check?” (already closed for intent-job canned text — still check caller enricher + thinking + billing)
   - “Where is this implemented?”
   - “Who calls this?” / “what else is affected?” / “is it safe to change?”
   - “What files should I read first?”
   - Outage / “what Jira tickets and Slack threads are related?”
   - “How is this repo structured?” / “how many files?”
   - “Check Slack too” (named tool stays; leftover locate must not become a remote code search)
   - Follow-up after an L answer (no sticky `[blast-radius]` / last `/blast` onto a later plain L turn)

6. **Do not invent a fourth session mode.** L vs R only. Same-path clone of the remote pin is R.

Write the inspection table in the PR/commit notes or in the reply. Fix every Fail you find. If a site is already safe, say why in one line — do not “fix” it.

## Part 2 — required behavior after the fix

For an L question on an absolute path outside the Use-repo:

- Answer from the attached local file. Do not invent other file paths.
- Say, in plain language, that other files were not searched. Do not tell the user to clone, `rg`, or open a local copy.
- Do not show **Code location**, **Gaps**, “remote code search,” “remote index,” “usable implementation file,” or “no local clone or on-disk search is required.”
- Do not show leftover-Use-repo **Callers**, **Concrete packages**, or incident **Code paths** / **Integrations** / **Gaps** unless the user named that tool or sent a slash / Workflows action on this turn.
- Do not run Blast Radius or offer a workflow chip.
- Thinking must not narrate a locate job, an idle remote index, or an empty remote dependents list.

For an indexed-repo locate with no remote file body and no integration hits, KEEP the canned `enrichIntentJobResponse` text. N5 must still pass.

## Implementation constraints

- Prefer `applyFileAssistantIntentPlan` so every L caller drops repo hunts. If jobs must remain for a named Slack/Jira tool the user actually asked for, no rewriter may treat a leftover locate job as a remote code search on an L turn.
- Routers and rewriters that can replace an answer must take `sessionMode` or an explicit `fileAssistant` flag. Do not infer L from the question text.
- Pass session mode into `planFrontDoorChatCompletions` / `resolvePlainChatSynthesisRoute` so billing and model pick match the turn the user is in.
- `incidentCodePathsFromBundle` must not start counting local files as remote Use-repo proof. On L, skip the incident rewriter unless the user explicitly sent an incident/slash/workflow on this turn — or refuse to add remote-miss sections when the only body is the open local file.
- On L, `enrichPlainChatCallerResponse` / `enrichPackageStructureResponse` must not prepend leftover Use-repo graph or inventory.
- Gather must not search leftover Use-repo because leftover locate terms are still on the plan. Prefer cleaned jobs from `applyFileAssistantIntentPlan`. Do not hardcode `fileAssistant: false` on a path that can run for L.
- Do not add a disk walk, `rg`, or local-clone search.
- Do not special-case question strings or filenames.

## Tests

Keep existing N5 meaning unchanged.

Add or extend:

- Session plan: already required — L + workflow + locate job → no workflow, no locate job; named non-repo tools kept.
- Synthesis routing: already required — L + leftover locate ≠ intent-job; R + locate = intent-job.
- `enrichIntentJobResponse`: already required — L open-file answer is not replaced; R empty remote still is.
- Front-door billing / `planFrontDoorChatCompletions`: L + leftover locate (or L + ship-check English) does not select `intent_job`. R + locate still can.
- `enrichChatResponseForAction` / incident: L + outage-shaped English + attached local file is not rewritten into incident **Code paths** / **Gaps** about remote search. R incident with empty remote evidence stays honest.
- Caller enricher: L + ship-check / “who calls this” + leftover Use-repo dependents in the bundle does not prepend those callers.
- Package/structure enricher: L + “how is this structured?” does not inject leftover Use-repo package names.
- If you change gather: L + leftover locate jobs does not start a Use-repo semantic search.

Run the touched test files. Do not run the full matrix unless a change escapes those files.

## Done when

- An L turn with a leftover hunt cannot reach a remote-search / leftover-Use-repo canned or prepended answer.
- The open local file is the evidence.
- An indexed-repo locate with empty remote evidence still uses the canned locate answer.
- The inspection table lists every jobs/rewriter/gather site you checked, including the ones that were already safe.
- Thinking and activity on L do not narrate locate / idle remote index / empty dependents.
