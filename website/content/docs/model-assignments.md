---
title: Model assignments
description: How CoopAI routes chat, quick actions, edit mode, and autocomplete to assigned models.
section: extension
order: 2
lastUpdated: "2026-07-10"
---

CoopAI assigns an LLM per feature in production. You do not pick provider or model on Developer or Pro — Coop routes each use case to the model below. **Custom model selection is an Enterprise capability (coming soon).**

## Assigned models

| Feature | Provider | Model | Routes via |
| --- | --- | --- | --- |
| **Chat** (free-form composer) | OpenAI | GPT-4o mini | Chat session → `resolveAssignedModelForUseCase()` |
| **Quick actions** (Understand Repo, Trace Decision, Find Owner, Blast Radius, Knowledge Gaps; integration chat) | Anthropic | Claude Sonnet 4.6 | Same |
| **/edit patches** (`/edit`, `/patch`, `/fix`) | OpenAI | GPT-5 mini | Same (`code_edit` use case) |
| **Autocomplete** (inline ghost text) | Mistral | Codestral | `completionRouter.ts` → FIM when available |
| **Embeddings** (Deep-Index semantic search) | OpenAI | text-embedding-3-small | Backend only — not shown in settings |

Quick actions and integration chat share the **quick actions** assignment. Plain chat in the composer uses the **chat** assignment regardless of which model you might have used in an older install.

## Settings UI — Model & chat

**Extension UI** → **Settings** (gear) → **Preferences** → **Model & chat**

Production users see:

- Copy: *Models are assigned by Coop for chat, quick actions, and edit mode. Custom model selection is an Enterprise capability (coming soon).*
- Four **read-only** rows — feature name, provider · model, and an **On** / **Off** badge
- Two toggles you **can** change:
  - **Enable live LLM chat** — master switch for chat, quick actions, and edit mode
  - **Enable inline autocomplete** — master switch for ghost-text completions
- **Save model settings** persists only the toggles (and dev overrides when dev mode is on)

The Preferences hub subtitle shows **Assigned models** plus chat and autocomplete status (for example, `Assigned models · Chat on · Autocomplete on`).

There is **no provider or model picker** for normal users. Model routing is operator cost — not user-facing credits or per-model pricing.

### Developer mode override

Set `coopAI.devMode: true` in VS Code settings to unlock **LLM provider** and **Model** overrides on the same screen. Dev overrides apply to **local testing only**; production orgs should keep dev mode off.

The extension blocks writes to `coopAI.llmProvider` and `coopAI.defaultModel` from the settings UI unless dev mode is enabled.

## Related settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `coopAI.llm.enabled` | `true` | Same as **Enable live LLM chat** |
| `coopAI.autocomplete.enabled` | `true` | Same as **Enable inline autocomplete** (global scope) |
| `coopAI.devMode` | `false` | Unlock provider/model overrides and local PAT flows |

See [Extension settings](/docs/extension-settings) for the full settings hub.

## Next steps

- [Inline autocomplete](/docs/autocomplete) — default on, global persistence, turn off intentionally
- [Edit mode](/docs/edit-mode) — `/edit` uses GPT-5 mini
- [Plans & billing](/docs/plans-billing) — seat-based Pro pricing
