---
title: Getting started
description: Install Coop AI and run your first chat in five minutes.
section: start
order: 1
lastUpdated: "2026-06-29"
---

This guide gets you from signup to your first useful chat in Coop AI.

## What you'll need

- VS Code 1.85 or later
- A Coop AI API key ([free signup](/signup/free) or from your org admin)
- A local workspace folder open in VS Code

## Step 1 — Create an account

**Browser** → [coop-ai.dev/signup/free](https://coop-ai.dev/signup/free)

Enter your work email. Copy your one-time API key (`coop_…`) — it is shown once and not saved in any project file.

For Pro or Enterprise, start at [Pricing](/pricing) and follow checkout to the [Welcome page](/welcome).

## Step 2 — Install the extension

See [Install the VS Code extension](/docs/install-extension) for marketplace and manual install options.

## Step 3 — Connect your API key

1. **Extension UI** — Open Coop sidebar → gear icon (or **Coop AI: Open Settings**).
2. **Account** — Paste your API key and set API base URL to `https://api.coop-ai.dev`.
3. Click **Test connection** — success calls `GET /health`.

## Step 4 — Ask your first question

![Coop VS Code sidebar — activity bar icon, quick action grid, and chat composer with slash command hints](/screenshots/docs/extension-sidebar-light.svg)

*The Coop sidebar in VS Code (light theme): select the activity bar icon, use quick actions, or type slash commands in the composer.*

1. Open a file in your workspace.
2. **Extension UI** — Type in the chat composer or click **Understand Repo**.
3. Try: `Explain this codebase. What are the main entry points?`

Coop streams an answer grounded in your workspace files and any connected integrations.

## Step 5 — Try a quick action

![Coop quick actions in the VS Code editor context menu — Trace Decision, Find Owner, Blast Radius, Understand Repo, Knowledge Gaps](/screenshots/docs/context-menu-quick-actions-light.svg)

*Right-click a selection in VS Code to open Coop quick actions from the editor context menu.*

With a file open, right-click the selection and choose **Trace Decision** or type `/trace` in chat.

## Plans at a glance

| Plan | Best for |
| --- | --- |
| **Developer (free)** | Individual use, local workspace, personal integrations |
| **Pro** | Teams with GitHub + Lightning Mode indexing |
| **Enterprise** | Self-hosted, BYOK, zero-retention, compliance |

See [Plans & billing](/docs/plans-billing) for details.

## Next

- [Extension settings](/docs/extension-settings) — workspace, tools, preferences
- [Owner's Manual](/manual) — daily use, quick actions, prompt library
