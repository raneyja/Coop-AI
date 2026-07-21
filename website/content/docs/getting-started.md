---
title: Getting started
description: Install CoopAI and run your first chat in five minutes.
section: start
order: 1
lastUpdated: "2026-07-21"
---

This guide gets you from signup to your first useful chat in CoopAI.

## What you'll need

- VS Code 1.85 or later
- A CoopAI account ([free signup](/signup/free) or invited by your org admin)
- A local workspace folder open in VS Code

## Step 1 — Create an account

**Browser** → [coop-ai.dev/signup/free](https://coop-ai.dev/signup/free)

Enter your work email and create a password, or continue with Google. Coop sends a verification link on password signup; you can sign in before verifying (soft verify).

For Pro or Enterprise, start at [Pricing](/pricing) and follow checkout to the [Welcome page](/welcome). Sign in with the same email you used at checkout.

**Forgot your password?** → [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password)

## Step 2 — Install the extension

See [Install the VS Code extension](/docs/install-extension) for marketplace and manual install options.

## Step 3 — Sign in

1. **Extension UI** — Open Coop sidebar → gear icon (or **CoopAI: Open Settings**).
2. **Account** — Choose a sign-in path:

<!-- figures -->
![Account sign-in in VS Code — Continue with Google, email, and SSO](/screenshots/docs/extension-account-dark.png)
<!-- /figures -->

| Path | Steps |
| --- | --- |
| **Continue with Google** | Click the Google button at the top |
| **Continue with email** | Enter email → **Continue with email** → password → **Sign in** |
| **Sign in with SSO** | Enterprise: enter **Organization name** → **Sign in with SSO** → finish in your browser |

3. **Success:** Account shows your org and plan. Open chat and ask a question.

**Enterprise SSO:** Organization name is required before **Sign in with SSO**. Coop opens your system browser for IdP login; VS Code completes the session when you return. Name matching is case-insensitive.

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
2. **Extension UI** — Confirm the **file chip** in the composer:
   - **`filename` · `owner/repo`** → remote / codehost context
   - **`filename` · Local Workspace** → local disk / editor context
3. Type in the chat composer or click **Understand Repo**.
4. Try: `Explain this codebase. What are the main entry points?`

<!-- figures md -->
![Remote file chip in the Coop chat composer — Dockerfile labeled raneyja/Coop-AI](/screenshots/docs/extension-remote-file-chip.png)
<!-- /figures -->

*Remote chip example — filename plus `owner/repo` means Coop is attaching remote context. See [File context — remote vs local](/docs/file-context).*

Coop streams an answer grounded in your attached file context, workspace, and any connected integrations. Plain chat uses **GPT-4o mini** — see [Model assignments](/docs/model-assignments).

## Step 5 — Try a quick action

With a file open, highlight a few lines of code, then **right-click** the selection. Choose **CoopAI: Trace Decision for Selection** (or **Find Owner**, **Blast Radius**, **Understand Repo**, **Knowledge Gaps**).

<!-- figures -->
![VS Code editor context menu — CoopAI quick actions for the current selection](/screenshots/docs/context-menu-quick-actions-dark.png)
<!-- /figures -->

You can also type `/trace` in the chat composer for the same action.

Quick actions route to **Claude Sonnet 4.6** for structured, repo-grounded answers.

## Inline autocomplete

CoopAI shows ghost-text code completions **by default** as you type.

The sidebar header shows **Autocomplete On** for most installs. To turn it off: click **Autocomplete** in the header, or open **CoopAI Settings** → **Preferences** → **Model & chat** and uncheck **Enable inline autocomplete** → **Save model settings**.

<!-- figures -->
![Model & chat — Enable inline autocomplete](/screenshots/docs/extension-autocomplete-settings-on-and-off.png)
<!-- /figures -->

<!-- figures -->
![Inline autocomplete — ghost-text suggestion in the editor](/screenshots/docs/inline-autocomplete.png)
<!-- /figures -->

Type in a code file — ghost text appears after a short pause; **Tab** to accept.

See [Inline autocomplete](/docs/autocomplete) for FIM, graph context (indexed repos), Copilot coexistence, and how to turn off intentionally.

## Verify production (smoke check)

After sign-in, confirm the hot path:

| Check | Success looks like |
| --- | --- |
| **API health** | **Browser** → [api.coop-ai.dev/health](https://api.coop-ai.dev/health) returns OK |
| **Model & chat** | **Settings → Preferences → Model & chat** — four assigned models (Chat, Quick actions, /edit, Autocomplete), no provider picker |
| **Autocomplete** | Sidebar **Autocomplete On** → type in `.ts` → ghost text → **Tab** accepts |
| **Edit mode** | `/edit add a comment above this function` → **Apply** / **Undo** on the patch notification |
| **Quick action** | **Understand Repo** or `/trace` on a selection → structured answer with sources |
| **Plain chat** | Composer question → grounded reply (GPT-4o mini) |

More fixes: [Troubleshooting](/docs/troubleshooting).

## Plans at a glance

| Plan | Best for |
| --- | --- |
| **Developer (free)** | Individual use — full integrations, 3-repo Deep-Index cap, solo seat |
| **Pro** | Teams — unlimited indexing, team seats ($20/seat/month), usage analytics |
| **Enterprise** | Self-hosted, BYOK, zero-retention, SAML SSO, compliance |

**Enterprise org admins:** configure SAML in the admin portal before rolling SSO to your team — see [Single Sign On (SSO)](/docs/sso).

See [Plans & billing](/docs/plans-billing) for details.

## Next

- [File context — remote vs local](/docs/file-context) — composer chips: `owner/repo` vs Local Workspace
- [Model assignments](/docs/model-assignments) — per-feature models and settings UI
- [Inline autocomplete](/docs/autocomplete) — ghost-text completions
- [Extension settings](/docs/extension-settings) — workspace, tools, preferences
- [Owner's Manual](/manual) — daily use, quick actions, prompt library
