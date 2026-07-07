---
title: Extension settings
description: Account, Tools, Workspace, and Preferences in the Coop AI extension.
section: extension
order: 1
lastUpdated: "2026-07-07"
---

Open settings: Coop sidebar → gear icon, or Command Palette → **Coop AI: Open Settings**.

## Account

Sign in with your Coop account — the same credentials you use at [coop-ai.dev/signup/free](/signup/free) or the admin portal.

<!-- figures -->
![Account sign-in in VS Code (light theme)](/screenshots/docs/settings-account-light.png)

*Light theme*

![Account sign-in in VS Code (dark theme)](/screenshots/docs/settings-account-dark.png)

*Dark theme*
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

| Field | Purpose |
| --- | --- |
| **Owner** | GitHub/GitLab org or user (e.g. `acme`) |
| **Repository** | Repo name (e.g. `api`) |
| **Branch** | Default branch (e.g. `main`) |

Repo-wide quick actions (**Understand Repo**, **Find Owner**, **Knowledge Gaps**) use these defaults.

## Preferences

Profile and chat defaults — moved out of Account:

| Item | Purpose |
| --- | --- |
| **Timezone** | Quota reset times and scheduling context in chat |
| **Identity links** | Linked GitHub, Slack, Jira, and email profiles for ownership answers |
| **Model & chat** | Default provider/model and chat on/off |
| **Prompt library** | Pin up to 5 prompts for the composer footer |

## Autocomplete

Inline ghost-text completions are **off by default**. See the full guide: [Inline autocomplete](/docs/autocomplete).

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
| **Coop AI: Open Settings** | Settings hub |
| **Coop AI: Focus Chat** | Open sidebar chat |
| **Coop AI: Understand Repo** | Run Understand Repo quick action |
| **Coop AI: Trace Decision** | Run Trace Decision (file required) |

See the [Owner's Manual](/manual#using-the-extension) for chat composer and slash commands. For inline autocomplete, see [Inline autocomplete](/docs/autocomplete).
