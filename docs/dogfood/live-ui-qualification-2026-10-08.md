# Live UI Qualification Results

Use only repositories and files that are already present in the Extension Host’s indexed repository picker. Do not create local fixture files.

### Run-specific repository override

For this dogfood run, use the indexed repository identity `CoopAI-Corp/documenso` on branch `main`. Any older `documenso/documenso` label below means this exact indexed fork; do not switch to the public GitHub repository.

## Indexed repositories and exact files

- Documenso main: `documenso/documenso`
  - `/apps/remix/vite.config.ts`
  - `/apps/remix/react-router.config.ts`
  - `/AGENTS.md`
- Plane: `makeplane/plane`
  - `/package.json`
  - `/AGENTS.md`
- Documenso SDK: `documenso/sdk-typescript`
  - `/src/index.ts`
  - `/README.md`
  - Use this only for the missing-`AGENTS.md` test, after confirming the indexed tree has no root `AGENTS.md`.

If any named repository or file is absent from the indexed picker, mark that test **Blocked**. Do not substitute a local clone or newly created file.

## Test environment

- Date:
- Extension Development Host build or commit:
- Paid/free account used:
- Indexed repositories visible:
- Notes:

For every test, replace `Not run` with `Pass`, `Fail`, or `Blocked`; add one short observation and an evidence path.

## 1. `/edit`

### EDIT-01 Explicit `/edit` patch generation — recorded failure

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/react-router.config.ts`
- Select exactly the `appDirectory: 'app'` property and the adjacent line above it; do not select only the filename or type into a fresh chat.
- Ask: `/edit Add a short comment above the appDirectory property.`
- Action: Keep the selected lines and file open, then submit the explicit `/edit ...` message.
- Result: Fail
- Observation: Edit mode activated and the file/repo/branch chip was attached. CoopAI rendered a `Patch failed` card and made no changes, correctly refusing the result because the generated patch rewrote code instead of adding only a comment. Apply, Reject, and Create PR were unavailable because no valid pending patch was staged.
- Evidence: User screenshot `codex-clipboard-3b0f9556-3200-4c40-be25-62e326362ec1.png`, 2026-10-08.

### EDIT-02 Apply

- Repository: `documenso/documenso`
- Open: `/apps/remix/react-router.config.ts`
- Select: `appDirectory: 'app'`.
- Ask: `Add a short comment explaining that the app directory is app.`
- Action: Submit, inspect the diff, choose **Apply**, then use **Undo**.
- Result: Not run
- Observation:
- Evidence:

### EDIT-03 Reject

- Repository: `documenso/documenso`
- Open: `/apps/remix/react-router.config.ts`
- Select: The `ssr: true` line.
- Ask: `Add a short comment explaining that server-side rendering is enabled.`
- Action: Submit, inspect the diff, and choose **Reject**.
- Result: Not run
- Observation:
- Evidence:

### EDIT-04 Undo and stale Undo

- Repository: `documenso/documenso`
- Open: `/apps/remix/react-router.config.ts`
- Select: The `basename` property.
- Ask A: `Add a short comment above basename.`
- Ask B: `Add a short comment above ssr.`
- Action: Apply A and undo it. Apply B, then try the old Undo action for A.
- Result: Not run
- Observation:
- Evidence:

### EDIT-05 Multi-file safety

- Repository: `documenso/documenso`
- Open files: `/apps/remix/react-router.config.ts` and `/apps/remix/vite.config.ts`
- Select: The `basename` property in `react-router.config.ts`.
- Ask: `Rename the basename configuration to basePath and update the matching Vite configuration reference.`
- Action: Inspect that both files are listed before applying. Reject afterward unless you intentionally want to retain the rename.
- Result: Not run
- Observation:
- Evidence:

### EDIT-06 Keyboard focus

- Repository: `documenso/documenso`
- Open: `/apps/remix/react-router.config.ts`
- Select: The full `export default` configuration object.
- Ask: `Add a short comment above ssr.`
- Action: Open `/edit` and complete the modal using keyboard navigation only.
- Result: Not run
- Observation:
- Evidence:

### EDIT-07 Stop and follow-up after cancellation

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Select: The full `export default defineConfig` block.
- Ask: `Rewrite this configuration with extensive validation and detailed comments.`
- Action: Submit, press **Stop**, then ask: `What does the server port configuration do?`
- Result: Not run
- Observation:
- Evidence:

Pass criteria: the selected code is preserved; Apply changes only the reviewed patch; Reject changes nothing; stale Undo cannot overwrite newer work; multi-file diffs list every changed file; keyboard focus works; Stop leaves no partial patch; the follow-up is clean and unrelated to the canceled edit.

## 2. Autocomplete

### AUTO-01 Basic ghost text and acceptance

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Preconditions: Sign in under **Settings → Account**. In **Settings → Preferences → Model & chat**, enable **Enable inline autocomplete**, click **Save model settings**, and confirm the Autocomplete assignment says **On**. Ensure the trigger is `auto`, not `manual` or `off`.
- Cursor: At the end of `const cMapsDir = normalizePath(path.join(pdfjsDistPath, 'cmaps'));` in the indexed file.
- Action: Press Enter, type `const nextPath = path.join(`, and pause. If ghost text appears, press **Tab** to accept it. Enter only creates the new line; it is not the acceptance key.
- Result: Pass
- Observation: Ghost text appeared, four alternatives were available (`1/4` through `4/4`), and the user confirmed that both **Tab / Accept** and **Escape / Reject** work.
- Evidence: User screenshots `Screenshot 2026-10-08 at 1.40.19 PM.png` through `Screenshot 2026-10-08 at 1.58.03 PM.png`, plus user confirmation that accept and reject both work.

### AUTO-02 Reject, then accept the same completion

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/vite.config.ts`
- Preconditions: Complete the AUTO-01 settings check. Confirm the file still contains the original `cMapsDir` line; discard any unsaved text from AUTO-01 before starting. Do not save this test.
- Cursor: End of `const cMapsDir = normalizePath(path.join(pdfjsDistPath, 'cmaps'));`.
- Trigger: Press **Enter**, type exactly `const nextPath = path.join(`, and wait up to **3 seconds**. A valid suggestion is gray ghost text after the typed prefix.
- Phase A — reject: Press **Escape**. Pass only if the gray completion disappears and the editor still contains exactly the typed prefix, with no generated suffix inserted.
- Phase B — accept: Trigger the same completion again at the same cursor. Press **Tab**. Pass only if the suggestion becomes normal editor text (not gray ghost text) and the inserted text remains after the completion toolbar disappears.
- Cleanup: Immediately press **Cmd+Z** once. Pass only if the generated text is removed and the typed prefix remains. Close the file without saving.
- Result: Partial — accept and reject passed; undo remains unverified.
- Observation: The inline toolbar displayed `1/4`, `2/4`, `3/4`, and `4/4`, confirming four alternatives and successful navigation. The user confirmed that both Escape rejection and Tab acceptance work. Cmd+Z cleanup was not separately confirmed.
- Evidence: User screenshots `Screenshot 2026-10-08 at 1.57.26 PM.png` through `Screenshot 2026-10-08 at 1.58.03 PM.png`, plus user confirmation that accept and reject both work.

### AUTO-03 Stale-request cancellation

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Cursor: In the `plugins` array after `reactRouter(),`.
- Action: Type a prefix, immediately replace it with a different prefix before the first result arrives, and continue typing.
- Result: Not run
- Observation:
- Evidence:

### AUTO-04 Fill-in-the-middle

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Cursor: Inside the `plugins` array with existing entries before and after the cursor.
- Action: Trigger and accept a fill-in-the-middle suggestion, then undo the temporary insertion.
- Result: Not run
- Observation:
- Evidence:

### AUTO-05 Copilot coexistence

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Cursor: Inside the `plugins` array.
- Action: With Copilot enabled, trigger both completion systems and accept each once.
- Result: Not run
- Observation:
- Evidence:

### AUTO-06 Buffer-only behavior

- Repository: None by design.
- File: New unsaved TypeScript buffer only; do not save it into an indexed repository.
- Buffer: `function greet(name: string) { const trimmed = name.trim(); return \`Hello, \${trimmed}\`; }`
- Cursor: After `const trimmed = name.trim();`, press Enter.
- Action: Trigger autocomplete and confirm it does not claim Documenso or Plane repository context.
- Result: Not run
- Observation:
- Evidence:

### AUTO-07 Repository switching

- Repository A: `documenso/documenso`
- File A: `/apps/remix/vite.config.ts`
- Repository B: `makeplane/plane`
- File B: `/package.json`
- Action: Trigger completion in A, switch to B, and trigger completion for a Plane-specific package or script.
- Result: Not run
- Observation:
- Evidence:

Pass criteria: ghost text matches the current buffer; acceptance inserts only the selected suggestion; branch changes affect context; stale results are discarded; FIM respects both sides; Copilot and Coop remain distinguishable; switching A to B does not leak symbols.

## 3. Prompt library

These are UI-state tests. Keep an already indexed file open while using the composer.

### PROMPT-01 Save and insert

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Ask: `Explain the server block in this file in two sentences.`
- Action: Save it as `Dogfood prompt 2026-10-08`, then insert it into a new composer without submitting.
- Result: Not run
- Observation:
- Evidence:

### PROMPT-02 Pin, unpin, and reload

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Action: Pin the saved prompt, reload the Extension Host, reopen the library, and unpin it.
- Result: Not run
- Observation:
- Evidence:

### PROMPT-03 Edit

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Action: Edit the saved prompt name and body, save, and insert it again.
- Result: Not run
- Observation:
- Evidence:

### PROMPT-04 Delete

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Action: Delete the saved prompt, reload the library, and verify it cannot be inserted.
- Result: Not run
- Observation:
- Evidence:

### PROMPT-05 Keyboard focus and modal containment

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Action: Open the prompt library, tab through its controls, press Escape, and verify focus returns to the composer.
- Result: Not run
- Observation:
- Evidence:

### PROMPT-06 Account isolation

- Repository: `documenso/documenso`
- Open: `/apps/remix/vite.config.ts`
- Action: Save the prompt as account A, sign in as account B, reopen the library, then switch back to A.
- Result: Not run
- Observation:
- Evidence:

## 4. Model selection

Run these with an already indexed remote file open. The picker is in the **chat composer**, not in Settings. **Settings → Preferences → Model & chat** explains assignments and autocomplete; it does not mirror the model selected in the composer. Do not treat the wording or quality of a response as proof of the backend model—use the visible picker label, checkmark, and persistence.

### MODEL-01 Paid picker and visible selection

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/vite.config.ts`
- Account: A paid account where the composer currently shows the **Model** picker.
- Start state: Open a new chat and confirm the composer picker says **Auto** or shows its current selection.
- Action: Open the composer picker. Confirm it has **Auto**, **OpenAI Models**, **Anthropic Models**, and **Gemini Models**. Select **GPT-5.1**. Reopen the picker.
- Pass criteria: The menu closes after selection; the composer button reads `GPT-5.1 · Frontier`; reopening shows a checkmark beside GPT-5.1. Send `Explain the server block in this file in two sentences.` only after capturing the selected label. The answer itself is not routing evidence.
- Result: Not run
- Observation:
- Evidence: Screenshot of the open picker and screenshot of the selected button/checkmark.

### MODEL-02 Free account is Auto-only

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/vite.config.ts`
- Account: An existing verified **Free** account. Do not use a paid account for this row.
- Action: Start a new chat and inspect the composer footer. Open **Settings → Preferences → Model & chat** separately.
- Pass criteria: The chat composer has no model picker at all; there is no way to select GPT-5.1, Claude, or Gemini. The settings page may list the assigned models, but that list is informational. Do not mark this a failure because the settings page names models.
- Result: Not run
- Observation:
- Evidence: One screenshot of the composer footer and one of the Model & chat page. Record the account plan shown in Settings.

### MODEL-03 Paid selection persists across reload

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/vite.config.ts`
- Account: The same paid account used for MODEL-01.
- Action: In a new chat, select **Claude Haiku 4.5** from the composer picker. Confirm the button changes to `Claude Haiku 4.5`. Run **Developer: Reload Window** from the Command Palette. Reopen the Coop chat and the indexed file.
- Pass criteria: The composer picker still reads `Claude Haiku 4.5` after reload. Do not expect the Settings → Model & chat page to change; it is not the persistence display.
- Result: Not run
- Observation:
- Evidence: Before-reload and after-reload screenshots showing the composer label.

### MODEL-04 Return to Auto

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/vite.config.ts`
- Account: The same paid account.
- Action: Select **GPT-5.1** in the composer picker, reopen it, select **Auto**, then reopen it once more.
- Pass criteria: The composer button reads `Auto`, and the Auto row has the checkmark. Settings → Preferences → Model & chat continues to show the static assignment explanation; it should not display GPT-5.1 as the current chat selection.
- Result: Not run
- Observation:
- Evidence: Screenshot after selecting Auto with the composer picker closed and a second screenshot with the Auto checkmark visible.

### MODEL-05 Chat picker does not control autocomplete

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/vite.config.ts`
- Account: The same paid account, with autocomplete enabled and saved.
- Start state: Select **GPT-5.1** in the chat composer and leave that label visible. In Settings → Preferences → Model & chat, confirm the Autocomplete description says it always uses **Codestral**.
- Action: Return to `/apps/remix/vite.config.ts`, place the cursor at the end of the existing `cMapsDir` line, press Enter, type `const nextPath = path.join(`, and wait for ghost text. Do not use the chat model picker while the suggestion is pending.
- Pass criteria: Ghost text appears, and the chat picker still says `GPT-5.1`. This proves UI separation only. Do not claim that a screenshot proves the backend model; backend routing requires logs or request diagnostics.
- Result: Not run
- Observation:
- Evidence: Screenshot of the GPT-5.1 composer label, the Settings Codestral description, and the autocomplete suggestion.

## 5. Project instructions and `AGENTS.md`

Important: every row below is a **chat-question test**. You are not uploading, pasting, creating, or editing `AGENTS.md`. Coop loads the already-indexed repository's `AGENTS.md` automatically after you select the repository and click **Use repo**. The only text you type is the question shown under **Send in Coop chat**. Open the listed code file from the indexed tree for file context; do not attach `AGENTS.md` as a file chip. `AGENTS.md` is injected silently, so the absence of an AGENTS banner or chat chip is expected.

### INSTR-01 Instructions present in Documenso

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/react-router.config.ts` from the indexed tree. Do not upload or attach `/AGENTS.md`.
- Action: In the Remote workspace picker, select `CoopAI-Corp/documenso` → **Use repo**. Then send this exact message in Coop chat: `Using only the selected CoopAI-Corp/documenso repository context, list two concrete rules from its root AGENTS.md. Then state the value of appDirectory in /apps/remix/react-router.config.ts.`
- Pass criteria: The answer names the selected repository, gives two rules that are actually present in that repository's `/AGENTS.md`, and states the actual `appDirectory` value. Do not accept generic coding advice as evidence of AGENTS.md loading.
- Verified fixture: GitHub Contents API confirmed root `AGENTS.md` on `CoopAI-Corp/documenso@main`, 2,740 bytes, blob SHA `43915ef561627f1408c07d63cfa17c99fb550dcb`. Example actual rules: prefer `type` over `interface`; do not run `npm run build` to verify changes unless explicitly asked. These examples are the reviewer oracle, not text to paste into Coop's test question.
- Result: Fail
- Observation: Two live attempts failed on 2026-10-08. At 15:29, with the remote code-file chip, Coop correctly reported `appDirectory: 'app'` but said root AGENTS.md was not included in its context. It searched Notion, Confluence, and Google Docs despite the repository-only request. At 15:30, with repo-only context, it again searched external tools, showed `Explored AGENTS.md`, and returned the generic repository miss. The root file exists; this is not a missing-fixture case. Historical initial repair: instructions were moved before agent planning and into synthesis, with a scope guard. Independent review in the fresh chat found that guard missed the exact owner/repo wording and negated tools, and named-file seeding stopped after its first successful body. The latest user replay correctly quoted two rules actually present in the remote file (including never using classes) and ssr: true. The earlier chat incorrectly described that second rule as unsupported; one-file visible activity cannot prove automatic AGENTS loading failed because it is intentionally silent. The current source-delivery contract and candidate qualification are recorded in [repo-search-contract-2026-10-08.md](repo-search-contract-2026-10-08.md). Initial live failures remain historical evidence; current candidate results are graded separately.
- Evidence: User-pasted live transcript for both turns, 2026-10-08 15:29–15:30. Independent read-only GitHub verification of the exact fork/ref.

### Automated repair evidence (INSTR-01)

- Source changes: `src/chat/CoopChatSession.ts`, `src/api/agent/AgentOrchestrator.ts`, `src/api/agent/parseAgentToolPlan.ts`, `src/chat/agentRouting.ts`, and matching agent types.
- Targeted checks: `npm run test:agent-routing`, `npx tsx src/api/agent/vendorLoop.test.ts`, and `npm run test:project-instructions` passed. Coverage includes selected-repository scope blocking inferred Confluence/Notion/Google Docs tools and planner visibility of fetched repository instructions.
- Build gates: `npm run lint` and `npm run build:extension-dev` passed. This paragraph records the initial historical repair only. Current candidate checks and live replay results are recorded in [repo-search-contract-2026-10-08.md](repo-search-contract-2026-10-08.md).

### INSTR-02 Instructions present in Plane

- Repository: `makeplane/plane`
- Branch: Use the branch shown by the indexed picker; record it in the result.
- Open: `/package.json` from the indexed tree. Do not upload or attach `/AGENTS.md`.
- Action: Select `makeplane/plane` → **Use repo**. Then send this exact message in Coop chat: `Using only the selected makeplane/plane repository context, list two concrete rules from its root AGENTS.md. Then choose one script that is actually present in /package.json, quote its exact name, and explain what it does.`
- Pass criteria: The answer uses Plane's instructions, quotes a script name that really exists in the selected `/package.json`, and does not invent a `check` script or other absent field.
- Result: Not run
- Observation:
- Evidence: Screenshot of the selected repository/branch and the response; include the exact script name checked.

### INSTR-03 Missing instructions do not become invented instructions

- Repository: `documenso/sdk-typescript`
- Branch: Use the branch shown by the indexed picker; record it in the result.
- Open: `/README.md` and `/src/index.ts`.
- Preconditions: In the indexed tree, verify that the exact repository has no root `/AGENTS.md`. If `/AGENTS.md` exists, mark this row **Blocked** and do not run the missing-file case.
- Action: Select `documenso/sdk-typescript` → **Use repo**. Then send this exact message in Coop chat: `Does this repository have a root AGENTS.md? If not, say that no repository-specific AGENTS.md instructions were found. Then quote one export that is actually present in /src/index.ts and explain it.`
- Pass criteria: The answer reports the root instructions body unavailable unless authoritative remote evidence establishes absence, does not invent repository rules, and quotes an export actually present in `/src/index.ts`. An empty tree entry or failed read alone cannot prove absence.
- Result: Not run
- Observation:
- Evidence: Screenshot of the indexed tree showing no root AGENTS.md and the response.

### INSTR-04 Repository switching replaces instructions

- Repository A: `CoopAI-Corp/documenso`, branch `main`, file `/apps/remix/react-router.config.ts`
- Repository B: `makeplane/plane`, branch shown by the indexed picker, file `/package.json`
- Action A: Select repo A → **Use repo**, then send this exact message in Coop chat: `State the selected repository owner/name and branch, say whether a root AGENTS.md was found, and give one concrete instruction from it. If it is absent, say so.` Save the response. Start a clean chat or clear the old repo context, select repo B → **Use repo**, wait until the context identifies Plane, and send the identical message in Coop chat. Do not upload either AGENTS.md file.
- Pass criteria: Response A identifies Documenso and uses only Documenso instructions. Response B identifies Plane and uses only Plane instructions. A stale Documenso rule or file path in response B is a failure.
- Result: Not run
- Observation:
- Evidence: Before/after context screenshots and both responses.

### INSTR-05 No-repository chat has no repository instructions

- Repository: None.
- File: None; start a new chat with no Use repo selection and no file chip.
- Action: Start a clean chat with no repository/file context, then send this exact message in Coop chat: `Without using any repository or local workspace files, do you have repository instructions for this chat?`
- Pass criteria: The answer says no repository-specific instructions are available, or asks you to select/attach a repository. It must not claim rules from Documenso, Plane, or the local Coop-AI workspace.
- Result: Not run
- Observation:
- Evidence: Screenshot showing no repository/file context and the response.

### INSTR-06 Local workspace files do not override selected remote instructions

- Repository: `CoopAI-Corp/documenso`
- Branch: `main`
- Open: `/apps/remix/react-router.config.ts` from the indexed remote tree. Keep an unrelated local workspace tab open, but do not attach or select that local file.
- Action: Select `CoopAI-Corp/documenso` → **Use repo**, then send this exact message in Coop chat: `Using only the selected remote repository, name the active repository and explain appDirectory from /apps/remix/react-router.config.ts. Do not use local workspace files.` Do not upload or attach the local file or any local `AGENTS.md`.
- Pass criteria: The response identifies Documenso, gives the remote file's actual `appDirectory` value, and does not cite the local file path or local Coop-AI rules. A local AGENTS.md must not replace the selected remote AGENTS.md.
- Result: Not run
- Observation:
- Evidence: Screenshot of the selected remote context, the unrelated local tab, and the response.

## Failures and follow-ups

| Test ID | Short failure summary | Reproduction steps | Screenshot or log path | Follow-up owner/status |
|---|---|---|---|---|
|  |  |  |  |  |


## Repository search follow-up — final candidate

Scope: the user's three reported gaps only: per-file exclusions, inventory/layout combined with explicit sources, and the three observed answers that exceeded the soft 15s start-answer target.

Result: **Automated Pass and live Pass** on extension bundle `0105b6c54f7f7e7ea164d6b9a9e2212ae6be2e2b98db4365474a4adb01b5bf72`, after Reload Window. Nine fresh-chat replays use `CoopAI-Corp/documenso@main`; all nine start answering in 2.256–4.200s. Per-file guidance/source exclusions, file-count-plus-source, layout-plus-source, all three facts together, original two-file question, and the three exact latency misses pass. Inventory answers use the canonical index-stats total (2,381); layout answers match the canonical tree. Original citations open their correct remotely fetched full source and cited range; generated temporary viewers are discarded without saving.

The suite now has 182 repo-search checks. Final lint, extension build, full CI, and diff checks pass; independent review has no unresolved actionable finding. The intermediate live dotfile false-exclusion failure and attachment-only CI failure are retained alongside their regression fixes. See [the current target, implementation contract, success criteria, exact prompts, turn IDs, and timings](repo-search-contract-2026-10-08.md#follow-up-qualification-for-the-three-reported-gaps).

This follow-up does not reopen unrelated historical qualifications or promise perfect parsing of every phrasing or a hard provider latency bound. No commit, push, or deployment was performed.
