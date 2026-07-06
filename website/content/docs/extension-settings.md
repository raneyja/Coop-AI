---
title: Extension settings
description: Account, Tools, Workspace, and Preferences in the Coop AI extension.
section: extension
order: 1
lastUpdated: "2026-07-06"
---

Open settings: Coop sidebar → gear icon, or Command Palette → **Coop AI: Open Settings**.

## Account

Sign in with your Coop account — the same credentials you use at [coop-ai.dev/signup/free](/signup/free) or the admin portal.

| Method | When to use |
| --- | --- |
| **Email + password** | Default for free and Pro accounts |
| **Continue with Google** | Same Google account you used at signup |
| **Sign in with SSO** | Enterprise orgs with SAML (enter organization name) |

After sign-in:

| Field | Value |
| --- | --- |
| **API base URL** | `https://api.coop-ai.dev` (default) or your self-hosted URL |

Click **Test connection** to verify `GET /health`.

**Forgot password?** Use the link in Account settings or [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password).

### Automation API key (optional)

Expand **Automation API key** only for scripts and CI — not for everyday sign-in. Issue keys from the admin portal **API Keys** page if you need headless access.

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

- **Prompt library** — pin up to 5 prompts for the composer footer
- **Model preferences** — default provider/model where applicable
- **Dev mode** — enable PAT-based local integration testing (not for production orgs)

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
