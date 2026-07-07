---
title: "CoopAI Owner's Manual"
description: "Install, configure, and use CoopAI in VS Code — quick actions, prompt library, and team conventions."
lastUpdated: "2026-07-04"
---

Congratulations on choosing CoopAI. This manual helps you get the most out of it — from your first chat to team-wide prompt libraries.

## Why Coop

### The context gap

Most AI coding tools only see the file you have open. CoopAI connects your **code graph**, **Slack threads**, **Jira tickets**, and **docs** so answers reflect how your org actually builds software — not just the current buffer.

> By just using the beta version of CoopAI I have seen at least a 50% reduction in time I spend asking / answering questions… I spend at least 6 hours each week answering questions and cut that in half this past week.
> — Senior Engineer, Row Labs

### Lightning Intelligence

CoopAI builds a secure cross-repo knowledge graph from webhooks and index jobs — not full monorepo copies on every laptop. Your source stays on your infrastructure.

**Developer (free)** uses local workspace files with AI credits. Personal tool integrations are unlimited in **developer mode** (`coopAI.devMode: true`); in production, org admins connect integrations once in the admin portal. **Pro** adds GitHub connections, team seats, and Lightning Mode for faster cross-repo search.

### Quick actions at a glance

| Action | What it does |
| --- | --- |
| **Understand Repo** | Architecture, ownership, and key files — without cloning the whole codebase |
| **Trace Decision** | Why this code exists — pull rationale from commits, PRs, and team context |
| **Find Owner** | Who owns this area and the escalation path when you need a human |
| **Blast Radius** | Impact of changing this code — integrations, APIs, and operational risk |
| **Knowledge Gaps** | Missing context and blind spots before you ship |

### Trust and data handling

| Badge | Meaning |
| --- | --- |
| **No model training** | Your code is never used to train models |
| **Zero-retention routing** | Enterprise-confidential context with retention flags disabled |
| **Keys on your server** | LLM provider keys stay server-side, not in the IDE |
| **BYOK ready** | Route inference through your own provider accounts |

See the [Security page](/security) for architecture details.

## Get Started

### Developer (free) signup

1. **Browser** — Go to [coop-ai.dev/signup/free](https://coop-ai.dev/signup/free), enter your work email, and create a password (or continue with Google).
2. **Browser** — Verify your email if prompted.
3. **Extension UI** — Install the VS Code extension (see below) and sign in under **Settings → Account** — same email, **Continue with Google**, or **Sign in with SSO** (Enterprise).
4. **Browser** — Optional: open the [admin portal](https://admin.coop-ai.dev/login) with the same credentials to manage your personal account.

> **Forgot your password?** Use [Forgot password](https://coop-ai.dev/forgot-password) on the website or admin portal, or the **Forgot password?** link in the extension.

### Enterprise checkout

1. **Browser** — Choose a plan on [Pricing](/pricing) and complete Stripe checkout.
2. **Browser** — On the [Welcome page](/welcome), wait for provisioning (usually under a minute).
3. **Email** — Check your inbox for your account welcome email.
4. **Browser** — Open the [admin portal](https://admin.coop-ai.dev/login) and sign in with your email and password, **Continue with Google**, or **Sign in with SSO** (Enterprise).
5. **Admin portal** — Connect GitHub (GitHub App on company org — use **Send link to GitHub admin** if IT owns GitHub), Slack, and other tools once for your whole org.
6. **Admin portal** — Invite teammates from the Users page.
7. **Extension UI** — Developers install CoopAI in VS Code and sign in with their work email (or Google / org SSO).

### Install the VS Code extension

1. **Browser** — Open the [VS Code Marketplace listing](https://marketplace.visualstudio.com/) for CoopAI (or use the install button on [coop-ai.dev](https://coop-ai.dev)).
2. **Extension UI** — Click **Install**, then reload VS Code if prompted.
3. **Extension UI** — Open the Coop sidebar from the activity bar (Coop icon).

### Sign in

**Extension UI** → **Settings → Account**

<!-- figures -->
![Account sign-in in VS Code — Continue with Google, email, and SSO](/screenshots/docs/settings-account-dark.png)
<!-- /figures -->

Three sign-in paths appear on one screen:

| Path | Steps |
| --- | --- |
| **Continue with Google** | Click the top button (Google icon) |
| **Continue with email** | Enter email → **Continue with email** → enter password → **Sign in** |
| **Sign in with SSO** | Click **Sign in with SSO** (Enterprise; org picker coming soon) |

**Email is two steps** (same pattern as ChatGPT / Claude):

1. Enter your email address and click **Continue with email**.
2. Enter your password and click **Sign in**.
3. Use **Forgot password?** to reset, or **← Use a different email** to go back.

**After sign-in:** Account shows your org and plan summary, plus **Sign out**.

Use [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password) if you need to reset your password outside the extension.

**Automation API keys** (`coop_…`) are for CI and scripts only — create them in the [admin portal](https://admin.coop-ai.dev) **API Keys** page, not in the extension.

### Set repository context

1. **Extension UI** — Open **Settings → Workspace**.
2. Set **Owner**, **Repository**, and **Branch** (e.g. `acme`, `api`, `main`).
3. Repo-wide quick actions like **Understand Repo** and **Find Owner** use these defaults.

In **production mode** (`coopAI.devMode: false`), org admins connect code hosts in the admin portal — developers do not paste PATs.

### Optional: connect integrations

Integrations (Slack, Jira, Confluence, Notion, Google Docs, Teams) power **Trace Decision** and **Knowledge Gaps** with cross-tool context.

| Mode | Who connects | Where |
| --- | --- | --- |
| **Production** | Org admin | [Admin portal](https://admin.coop-ai.dev) → Integrations |
| **Developer mode** | Individual | Extension **Settings → Tools** (PATs in VS Code SecretStorage) |

If integrations are not connected, Coop still works for code-only questions. Ask your org admin to connect tools for full cross-tool context.

## Using the Extension

### Open the Coop sidebar

The Coop sidebar lives in the VS Code activity bar. When chat is empty, you'll see the **Quick Action** grid and a hint to type `/understand`, `/trace`, `/owner`, `/blast`, or `/gaps`.

### Chat composer

Type free-form questions in the composer. Coop streams answers grounded in your code graph and connected integrations.

- Press **Enter** to send (Shift+Enter for a new line).
- Responses stream in real time with markdown formatting.
- Chat history persists in the session.

### @-mentions and attachments

- Type `@` to search files in your workspace (up to 3 @-mentions per message).
- Use the paperclip to attach files — images, PDFs, or text (up to 4 per message).
- Selected lines in the editor are included automatically as context.

### Slash commands

Type `/` in the composer to see available commands. Quick actions:

| Slash | Action |
| --- | --- |
| `/understand` | Understand Repo |
| `/trace` | Trace Decision |
| `/owner` | Find Owner |
| `/blast` | Blast Radius |
| `/gaps` | Knowledge Gaps |

Integration commands: `/slack`, `/jira`, `/teams`, `/confluence`, `/notion`, `/docs`.

### Settings overview

Open settings via the sidebar gear icon or **CoopAI Settings**:

| Screen | Purpose |
| --- | --- |
| **Account** | Sign in (Google, email, SSO); signed-in org/plan + Sign out |
| **Plan & Usage** | Current plan, credits, upgrade path |
| **Tools** | Code hosts and integrations (production: read-only status; dev mode: PAT entry) |
| **Workspace** | Owner, repo, branch defaults |
| **Indexing** | Lightning Mode status and indexed repos (Pro) |
| **Preferences** | Timezone, identity links, prompt library, model preferences |

Right-click any selection in the editor for **Trace Decision**, **Find Owner**, **Blast Radius**, **Understand Repo**, or **Knowledge Gaps**.

### Inline complete and edit selection

**Inline complete** — Ghost-text autocomplete as you type. Shipped in production; **off by default** (`coopAI.autocomplete.enabled: false`).

| Step | Surface | Action |
| --- | --- | --- |
| Enable | **File** — VS Code settings | Set `"coopAI.autocomplete.enabled": true` |
| Or toggle | **Extension UI** — Command Palette | **CoopAI: Toggle Autocomplete** |
| Accept | Editor | **Tab** |
| Reject | Editor | **Escape** |
| Manual trigger | Editor | **Ctrl+Shift+\\** (Windows/Linux) or **Cmd+Shift+\\** (macOS) |

**How it works:**

- VS Code `InlineCompletionItemProvider` shows streaming ghost text
- **FIM** (fill-in-the-middle) sends `prefix` + `suffix` segments when `coopAI.autocomplete.useFim` is `true` (default) — routed to Codestral or DeepSeek when configured
- **Hot Streak** keeps completions snappy after Tab-accept; **Smart Throttle** adapts debounce to typing speed and latency
- **Multi-line** completions activate after `{`, `=>`, `(`, or inside blocks (up to 200 tokens)
- **Pro:** optional graph context via `coopAI.autocomplete.useGraphContext` — dependents and ownership from indexed repos

**Copilot:** when Coop autocomplete is **on**, Coop automatically disables Copilot **inline** ghost text (`github.copilot.enable`) and restores your prior setting when you turn Coop autocomplete off. Copilot chat and other features stay available.

Full guide: [Inline autocomplete](/docs/autocomplete).

**Edit selection** — Highlight a block, describe the change, review an inline diff. Accept, retry, or undo.

**Completion-only routing** — Inline requests use a separate zero-retention path (`x-use-case: code-completion-only`), distinct from chat.

## Quick Actions

### When to use each action

| Action | Best for |
| --- | --- |
| Understand Repo | Onboarding, architecture questions, "where do I start?" |
| Trace Decision | "Why was this written this way?" before changing legacy code |
| Find Owner | CODEOWNERS vs blame mismatches, reviewer suggestions |
| Blast Radius | Refactors, API changes, pre-merge impact analysis |
| Knowledge Gaps | Pre-ship audits, stale docs, missing runbooks |

### Understand Repo

**Slash:** `/understand` (aliases: `/understandrepo`, `/repo`, `/architecture`, `/explain`)

**Works without open file:** Yes — repo-wide if no file; deeper if a file is open.

**Default prompt:** "Understand this repository's architecture, subsystems, and risks."

**Example:**

```
I'm onboarding to coop-backend — where does webhook ingestion start, and how do events flow into the job queue vs GraphCache? What are the 5 files I should read first to trace a GitHub push end-to-end?
```

```
/understand focus on the webhook ingestion path
```

### Trace Decision

**Slash:** `/trace` (aliases: `/why`, `/decision`, `/history`)

**Requires:** An open file in the editor.

**Default prompt:** "Trace the engineering decision behind this code."

**Example:**

```
Pull the Slack thread and Jira ticket tied to auth_middleware.go — why did we add zero-retention headers here? Cross-reference commits on internal/llm/router.go from the last 90 days.
```

```
/trace why was zero-retention added here
```

### Find Owner

**Slash:** `/owner` (aliases: `/who`, `/find-owner`)

**Works without open file:** Yes — requires owner + repo in Settings → Workspace.

**Default prompt (file):** "Find who owns this area and how to reach them."

**Default prompt (repo-wide):** "Map repository ownership and who to contact."

**Example:**

```
Who owns services/billing/invoice_handler.go? CODEOWNERS says @platform-payments but git blame shows @marcus. Does pkg/ledger/posting.go share the same on-call rotation?
```

### Blast Radius

**Slash:** `/blast` (aliases: `/impact`, `/blast-radius`)

**Requires:** An open file in the editor.

**Default prompt:** "Estimate the impact of changing this code."

**Example:**

```
If I refactor TokenValidator.validate() in internal/auth/token_validator.ts, what breaks downstream? List dependents in api-gateway, workers/webhook-processor, and any shared libs.
```

```
/blast what breaks if I change the token validator
```

### Knowledge Gaps

**Slash:** `/gaps` (aliases: `/unknowns`, `/knowledge-gaps`)

**Works without open file:** Yes.

**Default prompt (file):** "Audit documentation and ownership gaps for this area."

**Default prompt (repo-wide):** "Audit documentation and ownership gaps across this repository."

**Example:**

```
Before I ship changes to GraphConsistencyManager.applyEvent(), what am I missing? Any Slack threads or Jira tickets on webhook dedupe?
```

### File-level vs repo-wide

| Action | Works without open file | Notes |
| --- | --- | --- |
| Understand Repo | Yes | Repo-wide if no file; deeper if file open |
| Find Owner | Yes | Needs owner/repo in Workspace settings |
| Knowledge Gaps | Yes | Repo-wide audit vs file-level |
| Trace Decision | **No** | Requires open file |
| Blast Radius | **No** | Requires open file |

### Integration slash commands

| Slash | Description |
| --- | --- |
| `/slack` | Answer using Slack discussions as primary evidence |
| `/jira` | Answer using Jira tickets as primary evidence |
| `/teams` | Answer using Microsoft Teams threads |
| `/confluence` or `/wiki` | Answer using Confluence pages |
| `/notion` | Answer using Notion pages |
| `/docs`, `/googledocs` | Answer using Google Docs |

**Example:** `/slack what did #platform-auth decide about session TTL?`

## Prompt Library

### Saved prompts in the sidebar

Click **Prompts** in the chat composer footer to open a dropdown of your pinned prompts. Select a prompt to insert it into the composer with current file and workspace context filled in. Press **Send** when you are ready.

If you already have text in the composer, the saved prompt is appended below it.

### Pin your top 5

1. **Extension UI** — Open **Settings → Preferences → Prompt library**, or click **See all prompts…** in the **Prompts** dropdown.
2. Pin up to **5 prompts** — they appear in the **Prompts** dropdown.
3. Drag pinned rows to reorder them. Click **Use** on any row to insert it into the composer.

### Save a prompt from chat

1. **Extension UI** — Type a prompt in the chat composer.
2. Click **Save to library** (shown when you have a workspace open and text in the composer).
3. Name the prompt and click **Save**. Coop writes it to `.coop/prompts.json` and links a quick action automatically when the text starts with a slash command like `/understand`.

### Workspace prompts file

Teams share prompts via `.coop/prompts.json` in the repository root. Commit it to git so everyone gets the same library.

### Template variables

At run time, Coop substitutes:

| Variable | Source |
| --- | --- |
| `{{file}}` | Current editor file path |
| `{{lines}}` | Selected line range |
| `{{owner}}` | Workspace owner setting |
| `{{repo}}` | Workspace repo setting |
| `{{branch}}` | Workspace branch setting |

### Link prompts to quick actions

Set `actionId` on a prompt to route through a quick-action pipeline:

| actionId | Quick action |
| --- | --- |
| `understand-repo` | Understand Repo |
| `trace-decision` | Trace Decision |
| `find-owner` | Find Owner |
| `blast-radius` | Blast Radius |
| `knowledge-gaps` | Knowledge Gaps |

When `actionId` is set, your template becomes the user intent appended to the action — not a replacement for Coop's model prompt.

### Example team prompts

```json
{
  "version": 1,
  "prompts": [
    {
      "id": "onboard-webhooks",
      "title": "Onboard: webhook flow",
      "template": "Trace webhook ingestion from HTTP handler to job queue. List the 5 files to read first.",
      "actionId": "understand-repo"
    },
    {
      "id": "pre-ship-gaps",
      "title": "Pre-ship gap check",
      "template": "Audit {{file}} for missing docs, unclear ownership, and open questions before I merge.",
      "actionId": "knowledge-gaps"
    },
    {
      "id": "refactor-impact",
      "title": "Refactor impact",
      "template": "What breaks if I change {{file}}? Prioritize cross-service dependents.",
      "actionId": "blast-radius"
    },
    {
      "id": "pr-reviewers",
      "title": "Suggest PR reviewers",
      "template": "Who should review changes to {{file}} on branch {{branch}}? Prefer blame-aware experts.",
      "actionId": "find-owner"
    },
    {
      "id": "incident-trace",
      "title": "Incident decision trace",
      "template": "/trace link commits and tickets for the last auth incident in {{repo}}",
      "actionId": "trace-decision"
    }
  ]
}
```

Pin `onboard-webhooks`, `pre-ship-gaps`, `refactor-impact`, `pr-reviewers`, and `incident-trace` as your top 5.

## AGENTS.md

### What AGENTS.md is for

`AGENTS.md` is your repository's **operator manual for AI tools** — canonical URLs, docs links, UI conventions, and setup surfaces. It lives in git alongside your code, not on the marketing site.

This Owner's Manual (what you're reading) is product documentation. Your repo's `AGENTS.md` is project-specific guidance for Coop, Cursor, and other agents working in that codebase.

### What to put in it

- Canonical URLs (API, admin portal, docs)
- Build and test commands
- Architecture overview and internal API conventions
- Rules for how agents should give setup instructions to users
- Pointers to deeper docs in your repo

### How Coop uses it

When project instructions are enabled, Coop loads `AGENTS.md` (and subtree-specific files in large monorepos) on **every chat turn** — not only for Understand Repo. If no `AGENTS.md` is found, the composer shows an **Attach AGENTS.md** prompt. Keep the top-level file general; add subtree-specific `AGENTS.md` files for large monorepos.

### Cursor rules and webview UI

If your team uses Cursor, you can add `.cursor/rules/` files for IDE-specific guidance. Coop's extension webview follows design tokens in `globals.css` — see your repo's webview UI policy if you contribute to Coop itself.

### Example AGENTS.md skeleton

```markdown
# Agent guide — my-project

## Canonical URLs

| Purpose | URL |
| --- | --- |
| API | https://api.example.com |
| Staging | https://staging.example.com |

## Build & test

- `npm run build` — production build
- `npm test` — unit tests
- `npm run lint` — ESLint

## Architecture

Brief overview of services, entry points, and where to find docs.

## Agent instructions

When giving setup steps, name the surface (File / Terminal / Browser / Extension UI).
```

Ask Coop: "Update AGENTS.md based on what I told you in this thread" to generate or refresh it.

## Developer vs Pro

| Feature | Developer (free) | Pro |
| --- | --- | --- |
| Local workspace context | Yes | Yes |
| AI credits | Included | Higher limits |
| Tool integrations (personal) | Unlimited | Unlimited |
| GitHub org connection | No | Yes |
| Lightning Mode | No | Yes |
| Team seats | Individual only | Multi-seat |
| Cross-repo search | Local workspace | Indexed repos (up to 3/seat) |

See [Pricing](/pricing) for current limits and upgrade paths.

## When to ask your admin

In **production mode**, developers cannot connect Slack, Notion, Google Docs, or org-wide GitHub — org admins do that once in the [admin portal](https://admin.coop-ai.dev).

Ask your admin if:

- Quick actions return "integration not connected"
- You need access to private org repos on Pro
- Teammates need invites or seat assignments

Full admin setup is covered in the [Documentation hub](/docs).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **Not signed in** | **Settings → Account** — use Google, **Continue with email**, or **Sign in with SSO** |
| **/trace or /blast disabled** | Open a file in the editor first |
| **Repo-wide /owner fails** | Set owner + repo in Settings → Workspace |
| **No Slack/Jira context** | Ask admin to connect integrations in admin portal |
| **Forgot password** | [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password) or **Forgot password?** on the password step |
| **Can't sign in** | Verify email is verified; try Google; Enterprise: **Sign in with SSO** |

## Support

- **Email:** [hello@coop-ai.dev](mailto:hello@coop-ai.dev)
- **Demo / enterprise:** [Book a demo](/demo)
- **Documentation:** [Docs hub](/docs) for admin portal, integrations, API reference, and enterprise deployment
- **Security questions:** [Security page](/security)
