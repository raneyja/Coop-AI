---
title: Model assignments
description: How CoopAI routes chat, quick actions, edit mode, and autocomplete to assigned models.
section: extension
order: 2
lastUpdated: "2026-07-29"
---

CoopAI assigns an LLM per feature in production. You do not pick provider or model on Developer or Pro — Coop routes each use case to the model below. **Custom model selection is an Enterprise capability (coming soon).**

<!-- figures ml -->
![Model & chat — read-only assigned models for Chat, Quick actions, /edit, and Autocomplete](/screenshots/docs/extension-settings-models-and-chat.png)
<!-- /figures -->

## Assigned models

| Feature | Provider | Model | Routes via |
| --- | --- | --- | --- |
| **Chat** (free-form composer) | OpenAI | GPT-5 mini | Chat session → `resolveAssignedModelForUseCase()` |
| **Quick actions** (Understand Repo, Trace Decision, Find Owner, Blast Radius, Knowledge Gaps; integration chat) | Anthropic | Claude Sonnet 4.6 | Same |
| **/edit patches** (`/edit`, `/patch`, `/fix`) | OpenAI | GPT-5.1 | Same (`code_edit` use case) |
| **Autocomplete** (inline ghost text) | Mistral | Codestral | `completionRouter.ts` → FIM when available |
| **Intent suggest** (quick-action chips when phrase match is weak) | OpenAI | GPT-4o mini | Same (`intent_suggest` use case) |
| **Sources expand preview** (short AI overview for expanded source cards) | OpenAI | GPT-4o mini | Same (`evidence_preview` use case) |
| **PR notes** (Create pull request summary) | OpenAI | GPT-4o mini | Same (`pr_summary` use case) |
| **Embeddings** (Deep-Index semantic search) | OpenAI | text-embedding-3-small | Backend only — not shown in settings |

Quick actions and integration chat share the **quick actions** assignment. Plain chat in the composer uses the **chat** assignment regardless of which model you might have used in an older install. Intent suggest runs for everyone when the local phrase classifier is unsure — it never auto-runs a quick action (chips confirm first). Sources expand previews use a short AI overview when the body is long; expanded panels never dump full commit/PR/thread text — use the outbound link for the full record. Create pull request **Notes** use the same cheap OpenAI mini model and are labeled **(AI Generated)** — you can edit them before submit.

## Settings UI — Model & chat

**Extension UI** → **Settings** (gear) → **Preferences** → **Model & chat**

Production users see:

- Copy: *Models are assigned by Coop for chat, quick actions, and edit mode. Custom model selection is an Enterprise capability (coming soon).*
- Read-only assignment rows — feature name, provider · model, and an **On** / **Off** badge
- One toggle you **can** change:
  - **Enable inline autocomplete** — master switch for ghost-text completions
- Chat, quick actions, edit mode, and intent suggest assignment are always on in this list (no toggle)
- **Save model settings** persists the autocomplete toggle

The Preferences hub subtitle shows **Assigned models** plus autocomplete status (for example, `Assigned models · Autocomplete on`).

There is **no provider or model picker** in settings. Model routing is operator cost — not user-facing credits or per-model pricing.

### Developer mode override

Set `coopAI.devMode: true` in VS Code User settings to unlock local `coopAI.llmProvider` and `coopAI.defaultModel` overrides for testing. The Model & chat screen does **not** expose pickers — edit VS Code settings directly if needed.

## Related settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `coopAI.autocomplete.enabled` | `true` | Same as **Enable inline autocomplete** (global scope) |
| `coopAI.devMode` | `false` | Unlock provider/model overrides and local PAT flows |

See [Extension settings](/docs/extension-settings) for the full settings hub.

## Next steps

- [Inline autocomplete](/docs/autocomplete) — default on, global persistence, turn off intentionally
- [Edit mode](/docs/edit-mode) — `/edit` uses GPT-5.1 |
- [Plans & billing](/docs/plans-billing) — seat-based Pro pricing
