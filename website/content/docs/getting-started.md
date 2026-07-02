---
title: Getting started
description: Install Coop AI and run your first chat in five minutes.
section: start
order: 1
lastUpdated: "2026-06-30"
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
2. **Account** — Sign in with your email and password, or **Continue with Google**. Enterprise: **Sign in with SSO**.
3. Set API base URL to `https://api.coop-ai.dev`.
4. Click **Test connection** — success calls `GET /health`.

API keys are for automation and CI only — expand **Automation API key** under Account if you need one for scripts.

## Step 4 — Ask your first question

1. Open a file in your workspace.
2. **Extension UI** — Type in the chat composer or click **Understand Repo**.
3. Try: `Explain this codebase. What are the main entry points?`

Coop streams an answer grounded in your workspace files and any connected integrations.

## Step 5 — Try a quick action

With a file open, right-click the selection and choose **Trace Decision** or type `/trace` in chat.

## Optional — Inline autocomplete

Coop AI can show ghost-text code completions as you type. The feature is **off by default**.

1. **File** — VS Code settings: set `"coopAI.autocomplete.enabled": true`
2. Type in a code file — ghost text appears after a short pause; **Tab** to accept

See [Inline autocomplete](/docs/autocomplete) for FIM, graph context (Pro), Copilot coexistence, and shortcuts.

## Plans at a glance

| Plan | Best for |
| --- | --- |
| **Developer (free)** | Individual use, local workspace, personal integrations |
| **Pro** | Teams with GitHub + Lightning Mode indexing |
| **Enterprise** | Self-hosted, BYOK, zero-retention, compliance |

See [Plans & billing](/docs/plans-billing) for details.

## Next

- [Inline autocomplete](/docs/autocomplete) — ghost-text completions (opt-in)
- [Extension settings](/docs/extension-settings) — workspace, tools, preferences
- [Owner's Manual](/manual) — daily use, quick actions, prompt library
