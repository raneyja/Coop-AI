# Remote highlight + change — open-file edit, hunt stays

Paste this **entire file** into a **new** agent chat. This chat is closed. Do not continue work from leftover-state, turn-isolation, or file-assistant quality threads.

Research first with subagents. Write the inspection table. Then ship **one shared choke**. Evaluate with tests. Lint. Come back with Pass/Fail. Do **not** land a “highlighted / add a comment” phrase-bank, a Blast-only regex, or “reload and try again.”

Do not weaken: indexed-repo locate / understand / change hunts, Slack/Jira/docs named this turn, L file-assistant, empty-R locate canned miss (N5), L ↔ R chip jump, turn isolation, Zero-Clone.

---

## Why this session exists (live Fail — 2026-09-22 ~13:53)

Local highlight + “add a comment / add text” already works. The user then did the **same job on a remote Use-repo file**.

- File: `.dockerignore`
- Use-repo: `raneyja/Coop-AI`, branch `main`
- Chip: `R .dockerignore L11` (honest — do not reopen chip identity)
- Composer context: `file: .dockerignore` `selection: L11` `repo: raneyja/Coop-AI` `branch: main`
- Ask (plain English, no slash, no Workflows): add one comment above the highlighted line that said `testest`

**What they saw (Fail):**

- Agent owned the turn (`propose_patch` in the hunt loop)
- Searched the repo for `testest` (the **new** text — a symbol that does not exist yet)
- Read `src/chat/timezone.test.ts` (wrong file)
- Bubble: `I couldn't find that in this repo. Try a more specific name, or open the file.`
- Patch card: failed / not applied / **No patch blocks found**
- Thinking later: first `propose_patch` had files then a later call used an **empty `files[]`**; model decided the target was `timezone.test.ts`

The chip was right. The model never received `.dockerignore` or line 11.

**Grade:** routing Fail, then empty-hunt rewriter Fail. Not a model-quality Fail. Not a leftover L-vs-R chip Fail.

Do not special-case `.dockerignore`, `testest`, `timezone.test.ts`, or the string “the line I highlighted.”

---

## Product law (do not walk back search)

**Search finds evidence you do not have yet. A live highlight on this send is evidence you already have.**

Users will not say “add a comment above the line I highlighted.” They will say “put a note here,” “write testest above it,” “add this,” “insert a line,” etc. **Do not parse those sentences.** The **selection on the chip** is the target. The sentence is only the spec.

| This turn | Evidence | Hunt? |
|---|---|---|
| Question / locate / explain (“where is,” “who calls,” “what does this do,” “what else should I check?”) | Indexed repo + optional highlight as *subject* | **Yes** (unchanged) |
| Named other target (“add a guard to `requireAuth`”) while some other file is highlighted | Hunt for that symbol | **Yes** |
| Repo-wide (“rename X everywhere / across the repo”) | Hunt | **Yes** |
| Explicit slash / Workflows (`/blast` `/trace` `/gaps` `/owner` `/understand` `/slack` … `/edit`) | That workflow | **Yes** (that workflow) — `/edit` stays anchored-edit |
| **R file + live selection + change + no other target** | Open remote file + that range | **No** — attach and patch |
| L file-assistant | Open local file | **No** (already shipped) |

Do **not** skip the hunt for every remote change, or for “file open but no selection.” Selection on **this send** is required for this choke.

Do **not** auto-set `composerMode: "edit"` from plain English. See `.cursor/rules/plain-chat-must-not-promote.mdc`. This is **not** `/edit` hijack. It is “do not give the hunt a turn whose target is already on the chip.”

Do **not** invent a fourth session mode. L vs R only. This choke is an **R (and any remote chip) open-file change gate**, not a new mode.

---

## What already shipped (do not regress)

- **L file-assistant:** `isFileAssistantSession` / `applyFileAssistantIntentPlan` / `fileAssistant` forces agent action `"none"`. Local highlight + change attaches buffer + `<editor_selection>` + `LOCAL_FILE_EDIT_DIRECTIVE`. Keep green.
- **Plain English is not a slash.** `resolveChangeSendRouting` must still refuse to auto-set `composerMode: "edit"` from a change-shaped sentence. Tests in `src/chat/editSendRouting.test.ts`.
- **Indexed-repo change → agent hunt** is still correct when the target is **missing** (no live selection, or a named other symbol / repo-wide). `editSendRouting.test.ts` “file in scope without /edit → agent-change” stays true **unless this turn also has a live selection and no other target.**
- **Empty R locate / empty change hunt:** `CUSTOMER_EMPTY_HUNT_ANSWER` / N5 (“remote code search did not return a usable implementation file” / “I couldn't find that in this repo”) stay for **real hunts** that found nothing. Must **not** fire on an anchored highlight-change after we skipped the hunt.
- **Open-file feature-add skip** (`shouldSkipAgentHuntForOpenFileFeatureAdd` / `seedOpenFileReadIfFeatureAdd`) is a **different** gate (ticket-style “we’re adding X”). Do not overload it with highlight comments. Do not delete it.
- **Zero-Clone:** remote body via `IndexedRepoWorkspace.readFile` / existing `loadRemoteFilesSyncForChat` / `fetchRemoteFileForChatAttach`. Never EDH Coop-AI disk, `rg`, or workspace walk. See `.cursor/rules/zero-clone-remote-only.mdc`.
- **Turn isolation / leftover docs:** do not reopen unless a test proves it regressed.
- **L answer quality / `LOCAL_FILE_PATH_DIRECTIVE` path wording:** do not apply “call it a local file” to a remote Use-repo path.

---

## Confirmed cause (verify; do not treat as optional)

Research already proved this class. Confirm in code. Find any sibling holes.

1. **`isFileAssistantSession`** (`src/context/sessionMode.ts`) is false for `fileSource: "remote"`. R never enters file-assistant. Correct — do not force R onto L.

2. **`classifyRepoCodeIntent` / `looksLikeChangeRequest`** (`src/chat/repoCodeIntent.ts`): leading verb `add` → `action: "change"`. That classification may stay. It must **not** imply “hunt for the new token.”

3. **`agentOwnsIndexedGather`** (`src/context/committedActivity.ts`) + **`shouldRunAgentOwnedTurn`** (`src/chat/CoopChatSession.ts` ~4771 / ~6652): R + `change` + Use-repo → agent owns the turn and **returns before** `runIntentFetch` / `enrichContextWithIndexedRepo` / `continueChatAfterContext`. Attached remote bytes never reach the model.

4. **`runAgentOwnedTurn`** passes `message` + `openFile` only. `openFile` is documented as **feature-add seed only** (`src/api/agent/agentTypes.ts`, `seedOpenFileReadIfFeatureAdd` in `AgentOrchestrator.ts`). Comment / highlight / “add text” is not seeded.

5. **`buildAgentToolPlanPrompt`** (`src/api/agent/parseAgentToolPlan.ts`): question text only. No `openFile`, no `<editor_selection>`, no “do not search for text the user asked to insert.” Planner is told to search short identifiers → it searches `testest`.

6. **`isConcreteFileEditAsk`** (`src/chat/editSendRouting.ts`) does **not** match “the line I just highlighted” (no “this file,” no named symbol). Then `resolveChangeSendRouting` with `agentCanOwnChange` still returns `agent-change` when a file is in scope. Phrase matching is the wrong fix.

7. **Empty-hunt finish:** `runAgentOwnedTurn` (~4948–4957) — `action === "change" && !agentPatch` → `customerFacingAgentAnswer`; empty → `CUSTOMER_EMPTY_HUNT_ANSWER`. `handlePatchComplete` → “No patch blocks found.” Exact dogfood.

8. **Synthesis attach already exists and is skipped:** `formatChatMessageWithLocalFiles` / `emitEditorSelectionBlock` / `loadRemoteFilesSyncForChat` / `readRepoFileForContext`. L and `/edit` use them. Agent-owned R change does not.

---

## Required behavior after this ship

### Isolation choke (one owner)

Add **one** shared function (name it; put it next to `editSendRouting.ts` or `agentRouting.ts` — not a copy in the webview). Suggested name: `openFileSelectionOwnsChange`.

It takes **this-turn** facts only:

```
{
  file?: string;                    // chip path
  selectedLines?: [number, number]; // live selection on this send
  message: string;                  // user text
  fileAssistant?: boolean;          // L already skips agent; function may return true but L path stays L
  explicitEdit?: boolean;           // /edit — do not steal; anchored-edit already owns
  hasQuickAction?: boolean;         // slash / Workflows
  integrationSlash?: boolean;
}
```

**True only when all of these hold:**

1. `file` is non-empty.
2. `selectedLines` is a real range on **this send** (not inferred from “highlighted” in the sentence).
3. The ask is a **change** (reuse existing change classification — `looksLikeChangeRequest` / the change half of `isLocalFileChangeAsk` / `classifyRepoCodeIntent.action === "change"`). Prefer **one** existing helper; do not add a third verb regex if one already works.
4. The ask is **not** a question / locate / ship-check / callers / history / Blast-shaped English (`isFileCallerQuery`, `isShipCheckQuery`, `isFileHistoryQuery`, advisory `isConcreteFileEditAsk` rejects).
5. The ask does **not** name a **different** target: other repo path, backtick/camel/snake symbol that is not explained as insert-text, or repo-wide (`REPO_WIDE_CHANGE_RE` already in `editSendRouting.ts`).
6. No explicit `/edit`, no quick action, no integration slash.

**False (hunt / workflow unchanged) when:**

- No selection on this send (file-open-only is **not** enough).
- “What does this do?” / “where is X?” / “who calls this?” / “what else should I check?”
- “Add a guard to `requireAuth`” with `.dockerignore` L11 selected.
- “Rename X across the repo.”
- `/blast` `/trace` `/gaps` `/owner` `/understand` `/slack` `/jira` `/edit`.

**Insert-text is not a hunt symbol.** Words the user asked to **write into the file** (`testest`, a comment body, a sentence in quotes) must not count as “named other target.” If you need a helper, prefer: quoted / “that says …” / “that said …” spans are spec, not locate terms. Do **not** special-case the string `testest`.

### Apply the choke at every boundary (not only `shouldRunAgentOwnedTurn`)

| Stage | Must do when choke is true | Must do when choke is false |
|---|---|---|
| Agent ownership | `shouldRunAgentOwnedTurn` / `agentOwnsIndexedGather` / `shouldRunAgentToolLoop` / `agentTurnAction` → **do not hunt** (same effect as `isEditTurn` or a dedicated skip — do not set `composerMode: "edit"`) | Today’s hunt |
| Change send routing | Not `agent-change`. Stay `none` (plain synthesis) or a new kind **only if** you cannot reuse synthesis without `/edit`. Never `anchored-edit` unless the user typed `/edit` | `agent-change` when that is today’s result |
| Attach | Fetch **this** remote file (codehost / `IndexedRepoWorkspace.readFile` / existing remote VFS attach). Put body + `<editor_selection lines="11-11" path="…">` in the model prompt (reuse `emitEditorSelectionBlock` / `formatChatMessageWithLocalFiles`) | No new attach rules |
| Prompt | Remote change directive: patch is the answer; SEARCH is the highlighted range (or a comment inserted **above** it per the spec); do **not** search the repo for insert text. **Do not** use `LOCAL_FILE_EDIT_DIRECTIVE` path wording (“local file,” “do not write in the repo”) on R | Hunt prompts unchanged |
| Finish | Patch card from streamed `File:` + ` ```patch ` SEARCH/REPLACE (same as L). Must **not** substitute `CUSTOMER_EMPTY_HUNT_ANSWER`. Must **not** show “No patch blocks found” when a valid patch was emitted | Empty real hunt still canned |
| Activity / thinking | Must not narrate `search_code` for insert text, or “Searching the repo…” | Hunt activity unchanged |

If attach fails (unreadable remote file): honest `EDIT_UNREADABLE_FILE_ERROR` (or the same class of one-liner). Do **not** fall through to hunt-for-`testest`. Do **not** invent `timezone.test.ts`.

`preferences.owner/repo` must not retarget the file. Chip file + Use-repo this turn only.

### Two-sided test (every surface)

| This turn | Leftover / contrast | Pass | Fail |
|---|---|---|---|
| R + L11 + “add a comment that says X” (any wording) | Hunt would search for X | Attach `.dockerignore` (or whatever file is on the chip). Patch that range. No canned miss | Search for X, wrong file, canned miss, no patch |
| R + L11 + “put a note here” / “write this above it” / “insert a line” | Same | Same route as above — **wording must not change the route** | Phrase-bank only matches “highlighted” |
| R + L11 + “what does this do?” | Change choke | Explain / hunt as today. No forced patch | Forced patch or canned miss |
| R + L11 `.dockerignore` + “add a guard to `requireAuth`” | Selection present | **Hunt** `requireAuth`. Do not patch `.dockerignore` | Open-file choke steals the hunt |
| R + **no** selection + “add a comment that says X” | File may be open | **Hunt or today’s agent-change** — choke is false | Steal hunt because a file tab is open |
| R locate empty (N5) | No highlight-change | Canned remote miss stays | Canned miss removed |
| L Desktop + highlight + change | Already shipped | Still file-assistant attach + patch | R choke regresses L wording or re-enables hunt |
| `/blast` on R file with leftover selection | Explicit workflow | Blast, not a comment patch | Highlight choke eats Blast |

---

## Part 1 — inspect (required, not optional)

Launch explore/generalPurpose subagents. Read the code. **Write the table in the reply before you ship.** For each site: file, function, leftover field / signal it reads, knows live `selectedLines` + change-vs-question + other-target?, user-visible, Pass/Fail, two-sided test.

If a site is already safe, one line why. Do not “fix” it.

### Surfaces you must grade

| Surface | Isolation question |
|---|---|
| `shouldRunAgentOwnedTurn` / `agentOwnsIndexedGather` | R highlight+change must not enter `runAgentOwnedTurn` |
| `agentTurnAction` / `shouldRunAgentToolLoop` | Same. Locate/understand/change **without** this choke still run |
| `resolveChangeSendRouting` / `isConcreteFileEditAsk` | Must not auto `/edit`. Must not keep `agent-change` when choke is true |
| `runAgentOwnedTurn` + `CUSTOMER_EMPTY_HUNT_ANSWER` | Must be unreachable for choke=true; still used for empty real hunts |
| `seedOpenFileReadIfFeatureAdd` | Unchanged meaning. Not the home for this gate |
| `buildAgentToolPlanPrompt` / `buildAgentAnswerPrompt` | If a change hunt still runs (choke false), do not require prompt-only “please read the chip” as the product — hard skip is the product |
| `loadRemoteFilesSyncForChat` / `fetchRemoteFileForChatAttach` / `enrichContextWithIndexedRepo` | After skip, these must actually run so the body is in the prompt |
| `formatChatMessageWithLocalFiles` / `emitEditorSelectionBlock` | Selection block present for R highlight+change |
| `LOCAL_FILE_EDIT_DIRECTIVE` vs remote | R must not be told it is a local Desktop file |
| `enrichFileAssistantResponse` | L-only. Must not run on R |
| `handlePatchComplete` / `parsePatchResponse` | Valid SEARCH/REPLACE from synthesis becomes Apply; no “No patch blocks found” |
| `propose_patch` | Still the hunt→patch bridge when choke is false. Not required when choke is true |
| Plain R “what does this file do?” (no selection / question) | Still not a silent Blast; still not this choke |
| `/edit` `/fix` | Still `anchored-edit` |
| `/compare` + named tools | Untouched |
| Activity labels in `committedActivity.ts` | No “Searching the repo…” on choke=true |

### Checklist (not complete — find more)

1. Every reader of `turnAgentAction` / `agentOwnsIndexedGather` / `skipOpenFileFeatureAdd`.
2. Every path that can call `runAgentOwnedTurn` without seeing `selectedLines`.
3. Every rewriter that replaces an answer when `!agentPatch`.
4. Whether `pendingChatLocalFiles` is populated then ignored because of the early agent return.
5. Whether insert-text is fed to `extractAgentSearchQuery` / locate job terms on a stolen hunt (must not happen after the choke).

---

## Part 2 — plan, then implement

After the table, write a short plan (choke + call sites + tests). Then implement.

**Prefer** one function + every ownership/routing caller. **Reject:**

- A regex for “highlighted” / “add a comment” / `testest`
- Extending `shouldSkipAgentHuntForOpenFileFeatureAdd` to all `add` sentences
- `fileAssistant: true` on remote chips
- Auto `composerMode: "edit"`
- Prompt-only instructions inside `buildAgentToolPlanPrompt` while the agent still owns the turn
- Seeding `read_file(openFile)` for every change (still a hunt; still searches insert text)

When choke is true and remote read fails: one honest unreadable-file line. Stop. No hunt fallback.

When choke is true and read succeeds: model sees file body + selection + change spec; streams a patch; Apply works.

---

## Tests (required)

Keep existing L leftover-hunt, N5, `editSendRouting` “no auto composer edit,” and isolation tests green.

Add or extend (dogfood **class**, not filename):

1. **Choke unit table** in the new helper’s test file (or `editSendRouting.test.ts` / `agentRouting.test.ts`):
   - R file + `[11, 11]` + “add a comment that says testest” → true
   - Same + “put a note here” / “write this above it” / “insert a line” → true
   - Same + “what does this do?” → false
   - Same + “add a guard to `requireAuth`” → false
   - Same + “Rename verifyToken across the repo” → false
   - File + **no** `selectedLines` + “add a comment that says X” → false
   - `/edit` or `hasQuickAction: true` → false (those owners stay)
   - Quoted insert text / “that said X” does **not** count as named other target

2. **Agent ownership:** `agentOwnsIndexedGather` / `shouldRunAgentToolLoop` / `agentTurnAction` — choke true → no agent loop. Choke false + change + Use-repo → loop still on.

3. **`resolveChangeSendRouting`:** choke true is **not** `agent-change` and **not** `anchored-edit` unless `explicitEdit`. Plain English still does not set `composerMode: "edit"`.

4. **Finish rewriter:** choke-true / non-agent R change must not substitute `CUSTOMER_EMPTY_HUNT_ANSWER` when synthesis has (or would have) a patch. R empty locate / empty agent change hunt still can.

5. **Attach contract (unit, not live model):** building the user message for R + selection + change includes the chip path and `<editor_selection` with those line numbers. L path wording (“local file,” ban “in the repo”) is **absent** on R.

6. **L unchanged:** Desktop file + highlight + change still file-assistant; no Use-repo hunt; `LOCAL_FILE_EDIT_DIRECTIVE` still allowed on L.

Do not assert live Gemini/GPT tokens. Do not run the full test matrix unless a change escapes the touched files.

### Eval / build / review (strict — same bar as leftover-state and isolation)

After implementation, in order:

1. **Inspect table in the reply** — every surface above graded Pass/Fail. If any Fail remains, you are not done.
2. **Touched tests** — run only the files you changed + the new choke tests. All green.
3. **`npm run lint`** from repo root (same as GitHub Actions Lint). Must pass. See `.cursor/rules/agent-git-workflow.mdc`. Do not ask Jon to lint.
4. **Two-sided proof in the reply** (not optional):
   - Highlight + change + no other target → **no hunt** (agent ownership false).
   - Highlight + “add a guard to `requireAuth`” → **hunt still on**.
   - No selection + change → **hunt still on**.
   - Question + highlight → **not** this choke.
   - N5 / empty R locate canned text **still** asserted somewhere you ran or you explicitly re-ran that existing test.
5. **Boris bar** (`AGENTS.md`): one choke, wired on the hot path, not a prompt footnote. Would a senior engineer trust this daily? If the agent can still `search_code` for insert text on the dogfood turn, Fail.
6. **Self-check before you claim done:**
   - Would “put a note here” on R L11 take the same route as “add a comment above the line I highlighted”? If no, Fail (you built a phrase-bank).
   - Would “If I change that missing-key response, what else should I check?” on Use-repo **without** this choke still hunt? If you broke that, Fail.
   - If the user has Coop-AI open locally and Use-repo is `plane`, could this attach still read Coop-AI disk? If yes, Fail (Zero-Clone).
   - Did you auto-enter `/edit` or Blast from plain English? If yes, Fail.

Do **not** commit or push unless Jon asks in that chat.

---

## Evaluate, then come back

Your **reply to Jon** (founder/PM, short):

1. Inspection table (every surface: Pass/Fail).
2. What you shipped (one choke name, where it is called).
3. Tests run + lint result.
4. Two-sided proof: highlight+change = no hunt; named other symbol / no selection / question = hunt or explain as today.
5. What you did **not** change (L leftover hunt, N5, chip jump, isolation, no auto `/edit`).

If the dogfood class can still reach `runAgentOwnedTurn` or `CUSTOMER_EMPTY_HUNT_ANSWER` without a remote read of the chip file, you are not done. Do not say “we told the agent to read `openFile`” and leave ownership in the hunt loop.

---

## Do not

- Special-case `.dockerignore`, `testest`, `timezone.test.ts`, “highlighted,” or “add a comment.”
- Skip hunt for every R `change` or every open remote file without `selectedLines`.
- Set `fileAssistant: true` on remote chips or reuse `LOCAL_FILE_EDIT_DIRECTIVE` path wording on R.
- Auto-set `composerMode: "edit"` from plain English.
- Overload `shouldSkipAgentHuntForOpenFileFeatureAdd` / `seedOpenFileReadIfFeatureAdd` as the only fix.
- Prompt-only fix inside the agent planner while `runAgentOwnedTurn` still owns the turn.
- Fall through to hunt when remote attach fails.
- Add `rg`, disk walk, or EDH workspace search.
- Reopen L answer quality, leftover-job routing, or turn-isolation docs bleed unless a test proves regression.
- Ship a heading strip / canned-string swap and call the routing bug fixed.

---

## Done when

- R + live selection + change + no other target **cannot** enter the agent hunt or search for insert text.
- That turn attaches the **chip file** + **selection** and can emit Apply SEARCH/REPLACE (same family as L / `/edit` synthesis, without becoming `/edit`).
- `CUSTOMER_EMPTY_HUNT_ANSWER` and “No patch blocks found” cannot fire on that turn after a successful attach.
- Wording variants take the **same** route (gesture + change job, not a phrase).
- “Add a guard to `requireAuth`,” no-selection changes, questions, locate, Blast, Slack, and empty-R locate still hunt / workflow / canned-miss as today.
- L highlight+change still works and still says “local file” only on L.
- Inspection table is in the reply.
- Touched tests + `npm run lint` are green.
- You did **not** ship a hunt-prompt footnote and call the job done.
