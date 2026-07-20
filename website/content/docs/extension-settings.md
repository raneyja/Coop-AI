---
title: Extension settings
description: Account, Tools, Workspace, and Preferences in the CoopAI extension.
section: extension
order: 1
lastUpdated: "2026-07-10"
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
| **Sign in with SSO** | Enter **Organization name** → **Sign in with SSO** → complete IdP sign-in in your browser |

Email sign-in is **two steps**:

1. Enter your email and click **Continue with email**.
2. Enter your password and click **Sign in**.
3. **Forgot password?** resets your password. **← Use a different email** returns to step 1.

### Enterprise SSO

1. Enter your **Organization name** (case-insensitive — must match your Coop org).
2. Click **Sign in with SSO**.
3. Your system browser opens for IdP login; VS Code shows a notice to complete sign-in there.
4. When you return, Account updates with your org and plan.

If your org enforces SSO, password and Google sign-in are blocked — use SSO only.

If the browser redirect fails or you close the tab early, VS Code shows an error from the callback URL (`?error=…&message=…`). Common codes:

| Error | Fix |
| --- | --- |
| `sso_not_configured` | Ask your admin to finish **Settings → Single sign-on** in the admin portal |
| `sso_required` | Use **Sign in with SSO** — password and Google are disabled for your org |
| `email_not_verified` | Verify your Google email address, then try **Continue with Google** again |
| `rate_limited` | Too many sign-in attempts — wait ~15 minutes, then retry |
| `saml_validation_failed` | IdP cert, clock skew, or SP URL mismatch — ask your admin to check IdP config |
| `missing_org` | Re-enter your **Organization name** before **Sign in with SSO** |
| No session token | Complete IdP login in the browser; do not close the tab before redirect back to VS Code |

Full error table: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

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
| **Timezone** | Usage reset times and scheduling context in chat |
| **Identity links** | Linked GitHub, Slack, Jira, and email profiles for ownership answers |
| **Model & chat** | Read-only assigned models, **Enable live LLM chat**, **Enable inline autocomplete** |
| **Prompt library** | Pin up to 5 prompts for the composer footer — see [Prompt library](/manual#prompt-library) |

The Preferences hub subtitle shows **Assigned models** plus chat and autocomplete status.

<!-- figures -->
![Model & chat — Enable inline autocomplete on or off](/screenshots/docs/extension-autocomplete-settings-on-and-off.png)
<!-- /figures -->

## Model & chat

**Preferences → Model & chat** shows how Coop routes each feature in production:

| Row | Assignment |
| --- | --- |
| Chat | OpenAI · GPT-4o mini |
| Quick actions | Anthropic · Claude Sonnet 4.6 |
| /edit patches | OpenAI · GPT-5.1 |
| Autocomplete | Mistral · Codestral |

Production users see these rows as **read-only** with **On** / **Off** badges. Copy on the screen:

> Models are assigned by Coop for chat, quick actions, and edit mode. Custom model selection is an Enterprise capability (coming soon).

**What you can change:**

| Toggle | Setting | Default |
| --- | --- | --- |
| **Enable live LLM chat** | `coopAI.llm.enabled` | `true` |
| **Enable inline autocomplete** | `coopAI.autocomplete.enabled` (global scope) | `true` |

Click **Save model settings** to persist toggles. Provider and model fields are not writable in production — the extension blocks updates to `coopAI.llmProvider` and `coopAI.defaultModel` unless `coopAI.devMode: true`.

Full table and routing details: [Model assignments](/docs/model-assignments).

<!-- figures -->
![Prompt library — search, pin, and create team prompts](/screenshots/docs/prompt-library.png)
<!-- /figures -->

## Autocomplete

Inline ghost-text completions are **on by default**. Turn them off from the chat header (**Autocomplete On/Off**) or **Preferences → Model & chat** → **Enable inline autocomplete** → **Save model settings**. Autocomplete toggles persist at **global** (User) scope. See the full guide: [Inline autocomplete](/docs/autocomplete).

| Setting | Default | Description |
| --- | --- | --- |
| `coopAI.autocomplete.enabled` | `true` | Enable inline ghost-text autocomplete (global scope) |
| `coopAI.autocomplete.trigger` | `auto` | `auto` \| `manual` \| `off` — when to request completions |
| `coopAI.autocomplete.useFim` | `true` | FIM `segments` for Codestral routing |
| `coopAI.autocomplete.useGraphContext` | `false` | Indexed graph context (auto when Deep-Index is ready) |
| `coopAI.autocomplete.debounceMs` | `300` | Ms after typing before auto-trigger (0–2000) |
| `coopAI.autocomplete.requestTimeoutMs` | `1500` | Drop slow requests after this many ms (100–5000) |
| `coopAI.autocomplete.maxSuggestionLength` | `200` | Max characters per suggestion (8–500) |
| `coopAI.autocomplete.showMultipleSuggestions` | `false` | Cycle alternatives with Alt+[ / Alt+] |
| `coopAI.autocomplete.projectImports` | `[]` | Extra import paths to bias completions |

Production routing uses **Mistral Codestral** — not user-selected models. See [Model assignments](/docs/model-assignments).

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

See the [Owner's Manual](/manual#using-the-extension) for chat composer and slash commands. For model routing and inline autocomplete, see [Model assignments](/docs/model-assignments) and [Inline autocomplete](/docs/autocomplete).
