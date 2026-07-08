---
title: Getting started
description: Install Coop AI and run your first chat in five minutes.
section: start
order: 1
lastUpdated: "2026-07-07"
---

This guide gets you from signup to your first useful chat in Coop AI.

## What you'll need

- VS Code 1.85 or later
- A Coop AI account ([free signup](/signup/free) or invited by your org admin)
- A local workspace folder open in VS Code

## Step 1 — Create an account

**Browser** → [coop-ai.dev/signup/free](https://coop-ai.dev/signup/free)

Enter your work email and create a password, or continue with Google. Verify your email if prompted.

For Pro or Enterprise, start at [Pricing](/pricing) and follow checkout to the [Welcome page](/welcome). Sign in with the same email you used at checkout.

**Forgot your password?** → [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password)

## Step 2 — Install the extension

See [Install the VS Code extension](/docs/install-extension) for marketplace and manual install options.

## Step 3 — Sign in

1. **Extension UI** — Open Coop sidebar → gear icon (or **Coop AI: Open Settings**).
2. **Account** — Choose a sign-in path:

<!-- figures -->
![Account sign-in in VS Code — Continue with Google, email, and SSO](/screenshots/docs/extension-account-dark.png)
<!-- /figures -->

| Path | Steps |
| --- | --- |
| **Continue with Google** | Click the Google button at the top |
| **Continue with email** | Enter email → **Continue with email** → password → **Sign in** |
| **Sign in with SSO** | Enterprise: click **Sign in with SSO** |

3. **Success:** Account shows your org and plan. Open chat and ask a question.

Automation API keys are for CI/scripts only — create them in the [admin portal](https://admin.coop-ai.dev) if needed, not in the extension.

## Step 4 — Ask your first question

<!-- figures -->
![Coop sidebar in VS Code (light theme) — quick actions and chat composer](/screenshots/docs/extension-sidebar-light.png)

*Light theme*

![Coop sidebar in VS Code (dark theme)](/screenshots/docs/extension-sidebar-dark.png)

*Dark theme*
<!-- /figures -->

Open the Coop icon in the activity bar. Click a quick action or type in the composer.

1. Open a file in your workspace.
2. **Extension UI** — Type in the chat composer or click **Understand Repo**.
3. Try: `Explain this codebase. What are the main entry points?`

Coop streams an answer grounded in your workspace files and any connected integrations.

## Step 5 — Try a quick action

With a file open, highlight a few lines of code, then **right-click** the selection. Choose **CoopAI: Trace Decision for Selection** (or **Find Owner**, **Blast Radius**, **Understand Repo**, **Knowledge Gaps**).

<!-- figures -->
![VS Code editor context menu — CoopAI quick actions for the current selection](/screenshots/docs/context-menu-quick-actions-dark.png)
<!-- /figures -->

You can also type `/trace` in the chat composer for the same action.
## Optional — Inline autocomplete

Coop AI can show ghost-text code completions as you type. The feature is **off by default**.

Click **Autocomplete** in the sidebar header for a quick **On** / **Off**, or open **CoopAI Settings** → **Preferences** → **Model & chat** and check **Enable inline autocomplete** → **Save model settings**.

<!-- figures -->
![Autocomplete toggle in the Coop sidebar header](/screenshots/docs/extension-autocomplete-toggle.png)
<!-- /figures -->

<!-- figures -->
![Model & chat — Enable inline autocomplete](/screenshots/docs/extension-autocomplete-settings-on-off.png)
<!-- /figures -->

<!-- figures -->
![Inline autocomplete — ghost-text suggestion in the editor](/screenshots/docs/inline-autocomplete.png)
<!-- /figures -->

1. **Extension UI** — Use either toggle above, or set `"coopAI.autocomplete.enabled": true` in VS Code settings
2. Type in a code file — ghost text appears after a short pause; **Tab** to accept

See [Inline autocomplete](/docs/autocomplete) for FIM, graph context (indexed repos), Copilot coexistence, and shortcuts.

## Plans at a glance

| Plan | Best for |
| --- | --- |
| **Developer (free)** | Individual use — full integrations, 3-repo Deep-Index cap, solo seat |
| **Pro** | Teams — unlimited indexing, team seats, higher AI limits |
| **Enterprise** | Self-hosted, BYOK, zero-retention, compliance |

See [Plans & billing](/docs/plans-billing) for details.

## Next

- [Inline autocomplete](/docs/autocomplete) — ghost-text completions (opt-in)
- [Extension settings](/docs/extension-settings) — workspace, tools, preferences
- [Owner's Manual](/manual) — daily use, quick actions, prompt library
