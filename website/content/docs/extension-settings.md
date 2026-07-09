---
title: Extension settings
description: Account, Tools, Workspace, and Preferences in the CoopAI extension.
section: extension
order: 1
lastUpdated: "2026-07-08"
---

Open settings from the **gear icon** in the Coop sidebar title bar. Settings open in a dedicated editor tab — Account, Tools, Workspace, Indexing, and Preferences. You can also run **CoopAI: Open Settings** from the Command Palette.

<!-- figures -->
![Settings gear — opens CoopAI Settings in an editor tab](/screenshots/docs/extension-settings-button.png)
<!-- /figures -->

<!-- figures -->
![CoopAI Settings hub — Account, Tools, Workspace, Indexing, and Preferences](/screenshots/docs/extension-settings-hub.png)
<!-- /figures -->

## Account

Sign in with your Coop account — the same credentials you use at [coop-ai.dev/signup/free](/signup/free) or the admin portal.

<!-- figures -->
![Account sign-in in VS Code — Continue with Google, email, and SSO](/screenshots/docs/extension-account-dark.png)
<!-- /figures -->

### Sign-in options

Three paths on one screen, separated by **or** dividers:

| Path | What to do |
| --- | --- |
| **Continue with Google** | Click the top button (Google icon) |
| **Continue with email** | Enter email → **Continue with email** → password → **Sign in** |
| **Sign in with SSO** | Click **Sign in with SSO** (Enterprise) |

Email sign-in is **two steps**:

1. Enter your email and click **Continue with email**.
2. Enter your password and click **Sign in**.
3. **Forgot password?** resets your password. **← Use a different email** returns to step 1.

### Signed in

After sign-in, Account shows your **org and plan** summary and a **Sign out** button.

**Forgot password?** Use the link on the password step or [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password).

### Automation API keys

Not in the extension UI. For CI and scripts, create keys in the admin portal **API Keys** page.

## Tools

Shows connection status for code hosts and integrations.

| Mode | Behavior |
| --- | --- |
| **Production** (`coopAI.devMode: false`) | Read-only status. Org admins connect in the [admin portal](/docs/admin-portal). |
| **Developer** (`coopAI.devMode: true`) | Paste PATs/tokens in VS Code SecretStorage for local testing. |

Supported tools: GitHub, GitLab, Bitbucket, Slack, Jira, Confluence, Notion, Google Docs, Microsoft Teams.

## Workspace

Pick indexed repos your org admin authorized and set your primary branch.

<!-- figures -->
![Workspace settings — org repos, AGENTS.md, and primary branch](/screenshots/docs/extension-settings-workspace.png)
<!-- /figures -->

| Field | Purpose |
| --- | --- |
| **Workspace repos** | Deep-Indexed repos your org admin enabled (read-only list) |
| **Primary branch** | Default branch for repo-wide quick actions (e.g. `main`) |
| **AGENTS.md** | Project instructions loaded on every message |

Repo-wide quick actions (**Understand Repo**, **Find Owner**, **Knowledge Gaps**) use your selected repo and branch.

## Preferences

Profile and chat defaults — moved out of Account:

| Item | Purpose |
| --- | --- |
| **Timezone** | Quota reset times and scheduling context in chat |
| **Identity links** | Linked GitHub, Slack, Jira, and email profiles for ownership answers |
| **Model & chat** | LLM provider, **Enable live LLM chat**, **Enable inline autocomplete** |
| **Prompt library** | Pin up to 5 prompts for the composer footer — see [Prompt library](/manual#prompt-library) |

<!-- figures -->
![Model & chat — Enable inline autocomplete on or off](/screenshots/docs/extension-autocomplete-settings-on-off.png)
<!-- /figures -->

<!-- figures -->
![Prompt library — search, pin, and create team prompts](/screenshots/docs/prompt-library.png)
<!-- /figures -->

## Autocomplete

Inline ghost-text completions are **off by default**. Turn them on from the chat header (**Autocomplete On/Off**) or **Preferences → Model & chat** → **Enable inline autocomplete** → **Save model settings**. See the full guide: [Inline autocomplete](/docs/autocomplete).

| Setting | Default | Description |
| --- | --- | --- |
| `coopAI.autocomplete.enabled` | `false` | Enable inline ghost-text autocomplete |
| `coopAI.autocomplete.trigger` | `auto` | `auto` \| `manual` \| `off` — when to request completions |
| `coopAI.autocomplete.useFim` | `true` | FIM `segments` for Codestral / DeepSeek routing |
| `coopAI.autocomplete.useGraphContext` | `false` | Indexed graph context (**Pro** plan) |
| `coopAI.autocomplete.model` | `haiku` | Fast model preset: `haiku` \| `gpt35` \| `custom` |
| `coopAI.autocomplete.customModel` | `""` | Model id when `model` is `custom` |
| `coopAI.autocomplete.debounceMs` | `300` | Ms after typing before auto-trigger (0–2000) |
| `coopAI.autocomplete.requestTimeoutMs` | `400` | Drop slow requests after this many ms (100–2000) |
| `coopAI.autocomplete.maxSuggestionLength` | `200` | Max characters per suggestion (8–500) |
| `coopAI.autocomplete.showMultipleSuggestions` | `false` | Cycle alternatives with Alt+[ / Alt+] |
| `coopAI.autocomplete.projectImports` | `[]` | Extra import paths to bias completions |

**Command Palette:** **CoopAI: Toggle Autocomplete**, **CoopAI: Show Autocomplete Help**

## Production vs developer mode

| | Production | Developer mode |
| --- | --- | --- |
| **Setting** | `coopAI.devMode: false` | `coopAI.devMode: true` |
| **Credentials** | Coop server (org OAuth) | VS Code SecretStorage |
| **Who connects** | Org admin | Individual developer |

Enterprise customers should keep dev mode **off** in workspace settings.

## Command Palette shortcuts

| Command | Action |
| --- | --- |
| **CoopAI: Open Settings** | Settings hub |
| **CoopAI: Focus Chat** | Open sidebar chat |
| **CoopAI: Understand Repo** | Run Understand Repo quick action |
| **CoopAI: Trace Decision** | Run Trace Decision (file required) |

See the [Owner's Manual](/manual#using-the-extension) for chat composer and slash commands. For inline autocomplete, see [Inline autocomplete](/docs/autocomplete).
