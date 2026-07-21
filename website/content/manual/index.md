---
title: "CoopAI Owner's Manual"
description: "Install, configure, and use CoopAI in VS Code — quick actions, prompt library, and team conventions."
lastUpdated: "2026-07-21"
---

Congratulations on choosing CoopAI. This manual helps you get the most out of it — from your first chat to team-wide prompt libraries.

## Why Coop

### The context gap

Most AI coding tools only see the file you have open. CoopAI connects your **code graph**, **Slack threads**, **Jira tickets**, and **docs** so answers reflect how your org actually builds software — not just the current buffer.

> By just using the beta version of CoopAI I have seen at least a 50% reduction in time I spend asking / answering questions… I spend at least 6 hours each week answering questions and cut that in half this past week.
> — Senior Engineer, Row Labs

### Lightning Intelligence

CoopAI builds a secure cross-repo knowledge graph from webhooks and index jobs — not full monorepo copies on every laptop. Your source stays on your infrastructure.

**Developer (free)** includes full tool connectivity (code hosts and collaboration integrations via the admin portal), Deep-Index on up to 3 repos org-wide, workspace repos, chat, and quick actions in production mode — with AI usage capped at 80,000 tokens per 5-hour window. **Pro** adds unlimited Deep-Indexed repos, team seats, Collections, and higher seat-based limits.

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
3. **Extension UI** — Install the VS Code extension (see below) and sign in under **Settings → Account** — **Continue with Google** or **Continue with email** (same address as signup).
4. **Browser** — Optional: open the [admin portal](https://admin.coop-ai.dev/login) with the same email/password or Google to manage your personal account.

> **Website login has no SSO.** SAML sign-in is available on the [admin portal](https://admin.coop-ai.dev/login) and in the VS Code extension only — not on [coop-ai.dev/login](https://coop-ai.dev/login). Enterprise developers use **Sign in with SSO** in the extension; org admins use **Continue with SSO** on the admin portal login page.

> **Forgot your password?** Use [Forgot password](https://coop-ai.dev/forgot-password) on the website or admin portal, or the **Forgot password?** link in the extension.

### Enterprise checkout

1. **Browser** — Choose a plan on [Pricing](/pricing) and complete Stripe checkout.
2. **Browser** — On the [Welcome page](/welcome), wait for provisioning (usually under a minute).
3. **Email** — Check your inbox for your account welcome email.
4. **Browser — Admin portal** — Open [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login). Sign in with email/password, **Continue with Google**, or (Enterprise) enter **Organization name** → **Continue with SSO**. The marketing site login at [coop-ai.dev/login](https://coop-ai.dev/login) does **not** offer SSO — use the admin portal for SAML.
5. **Admin portal** — Connect GitHub (GitHub App on company org — use **Send link to GitHub admin** if IT owns GitHub), Slack, and other tools once for your whole org.
6. **Admin portal** — Invite teammates from the Users page (or rely on IdP JIT after SSO is configured).
7. **Extension UI** — Developers install CoopAI in VS Code and sign in with **Continue with Google**, email/password, or **Organization name** + **Sign in with SSO** (Enterprise).

### Enterprise onboarding timeline

Typical sequence for a new Enterprise org (org admin + IT). Adjust for your IdP and GitHub ownership.

| Phase | Owner | Tasks | Target |
| --- | --- | --- | --- |
| **Week 0 — Provision** | Coop / billing | Stripe checkout, welcome email, admin account | Day 1 |
| **Week 0 — SSO** | IT + org admin | IdP SAML app with Coop SP values (step 1) → admin **Settings → Single sign-on** → paste IdP config (step 2) → **Test connection** → enable **Require SSO** (step 3) when ready | Day 1–3 |
| **Week 1 — Integrations** | Org admin (+ GitHub admin if needed) | Admin portal **Integrations** — GitHub App, Slack, Jira, etc. | Day 3–7 |
| **Week 1 — Indexing** | Org admin | **Indexing** → Deep-Index company repos; set **Repository access** mode | Day 3–7 |
| **Week 1 — Users** | Org admin | **Users** → invite or rely on IdP JIT; assign per-user repo grants if using **Per-user grants** | Day 5–10 |
| **Week 2 — Validate** | Developers + admin | Extension sign-in (SSO), **Workspace** repo, quick actions, autocomplete smoke | Day 7–14 |

Detail: [Single Sign On (SSO)](/docs/sso), [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting), [admin portal](/docs/admin-portal), and operator guide `docs/enterprise-integration-onboarding.md`.

### SSO-only org playbook

Use this when **Require SSO** is enabled in **Settings → Single sign-on → Sign-in policy** (password and Google blocked for new interactive sign-ins and token refresh).

1. **Browser — IdP** — Provision users in Okta / Entra / your SAML IdP with an **email** attribute (or email-format NameID). Map the same email your org uses in Coop.
2. **Browser — Admin portal** — **Settings → Single sign-on** → complete steps 1–2 (SP values into IdP, paste IdP Entity ID / SSO URL / cert) → **Save SSO** → **Test connection** with your admin identity.
3. **Browser — Admin portal** — Step 3: enable **Require SSO** only after a successful test. Coop shows a confirmation — a misconfigured IdP can lock everyone out. Enabling **Require SSO** also ends existing password/Google sessions for the org (SAML sessions stay). **Allow email and password** and **Allow Google** are hidden while **Require SSO** is on.
4. **Browser — Admin portal** — **Users** → promote at least one SSO user to **admin** if JIT created them as **member** (first SAML login defaults to **member**).
5. **Browser — Admin portal login** — All admins and members sign in at [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login) with **Organization name** + **Continue with SSO**. Do not send users to [coop-ai.dev/login](https://coop-ai.dev/login) — it has no SSO and returns `sso_required` for password attempts.
6. **Extension UI** — Developers use **Settings → Account** → **Organization name** + **Sign in with SSO** (browser handoff; VS Code completes automatically). No password invite required for SSO-only orgs.
7. **Offboarding** — Deactivate in **Users**, or automate `POST /v1/auth/saml/offboard` from your IdP provisioning job.

**Known limits:** Enabling **Require SSO** revokes password/Google sessions and refresh tokens for that org (SAML sessions remain). Org API keys (`coop_…`) still authenticate automation under **Require SSO** — revoke keys when users leave. SAML sessions default to 12 hours with no silent refresh. Full error codes and limits: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

### Repository access (Pro / Enterprise)

Org admins control which Deep-Indexed repos developers see in VS Code.

**Browser — Admin portal** → **Settings → Repository access**

| Mode | Behavior |
| --- | --- |
| **All indexed repos** | Every developer can use any repo the admin has Deep-Indexed |
| **Per-user grants** | Only repos explicitly granted on the **Users** page appear in the extension catalog |

Per-user mode is useful when company repos and personal forks share an org. Developers see a read-only message in **Settings → Tools** when access is admin-controlled.

Operator smoke test: repo `docs/repo-access-smoke-test.md` (`npm run smoke:repo-access`).

### Install the VS Code extension

1. **Browser** — Open the [VS Code Marketplace listing](https://marketplace.visualstudio.com/) for CoopAI (or use the install button on [coop-ai.dev](https://coop-ai.dev)).
2. **Extension UI** — Click **Install**, then reload VS Code if prompted.
3. **Extension UI** — Open the Coop sidebar from the activity bar (Coop icon).

### Sign in

**Extension UI** → **Settings → Account**

<!-- figures -->
![Account sign-in in VS Code — Continue with Google, email, and SSO](/screenshots/docs/extension-account-dark.png)
<!-- /figures -->

Three sign-in paths appear on one screen:

| Path | Steps |
| --- | --- |
| **Continue with Google** | Click the top button (Google icon) |
| **Continue with email** | Enter email → **Continue with email** → enter password → **Sign in** |
| **Sign in with SSO** | Enter **Organization name** → **Sign in with SSO** → complete sign-in in your browser (VS Code finishes automatically) |

**Email is two steps** (same pattern as ChatGPT / Claude):

1. Enter your email address and click **Continue with email**.
2. Enter your password and click **Sign in**.
3. Use **Forgot password?** to reset, or **← Use a different email** to go back.

**Enterprise SSO** requires your **organization name** before you click **Sign in with SSO**. Coop opens your system browser for IdP sign-in; when you finish, VS Code completes the session automatically. Organization name matching is case-insensitive. SSO is **not** available on [coop-ai.dev/login](https://coop-ai.dev/login) — use the [admin portal login](https://admin.coop-ai.dev/login) for browser-based SAML.

**After sign-in:** Account shows your org and plan summary, plus **Sign out**.

Use [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password) if you need to reset your password outside the extension.

**Automation API keys** (`coop_…`) are for CI and scripts only — create them in the [admin portal](https://admin.coop-ai.dev) **API Keys** page, not in the extension.

### Set repository context

1. **Extension UI** — Open **Settings → Workspace**.
2. Pick an indexed repo from your org catalog and set **Primary branch** (e.g. `main`).
3. Repo-wide quick actions like **Understand Repo** and **Find Owner** use these defaults.

<!-- figures -->
![Workspace settings — org repos, AGENTS.md, and primary branch](/screenshots/docs/extension-settings-workspace.png)
<!-- /figures -->

In **production mode** (`coopAI.devMode: false`), org admins connect code hosts in the admin portal — developers do not paste PATs.

### Optional: connect integrations

Integrations (Slack, Jira, Confluence, Notion, Google Docs, Teams) power **Trace Decision** and **Knowledge Gaps** with cross-tool context.

<!-- figures -->
![Admin portal Integrations page — org admin connects tools once for the whole team](/screenshots/docs/admin-integrations-dark.png)
<!-- /figures -->

| Mode | Who connects | Where |
| --- | --- | --- |
| **Production** | Org admin | [Admin portal](https://admin.coop-ai.dev) → Integrations |
| **Developer mode** | Individual | Extension **Settings → Tools** (PATs in VS Code SecretStorage) |

If integrations are not connected, Coop still works for code-only questions. Ask your org admin to connect tools for full cross-tool context.

## Enterprise SSO

Enterprise orgs sign in with SAML 2.0 through your company identity provider (Okta, Azure AD / Entra ID, or generic SAML). SSO is available on the **Enterprise** plan only.

### Where SSO works

| Surface | SSO available? | How |
| --- | --- | --- |
| **Admin portal** | Yes | [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login) → **Organization name** → **Continue with SSO** |
| **VS Code extension** | Yes | **Settings → Account** → **Organization name** → **Sign in with SSO** (browser handoff) |
| **Marketing site** ([coop-ai.dev/login](https://coop-ai.dev/login)) | **No** | Email/password and Google only — if your org requires SSO, use the admin portal or extension |

Organization name matching is case-insensitive on both surfaces. IdP setup detail (Okta, Entra, generic): [Single Sign On (SSO)](/docs/sso). Error codes and known limits: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

### Admin portal login (SSO)

1. **Browser** — Open [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login).
2. Scroll past email/password and **Continue with Google** to the **or SSO** section.
3. Enter your **Organization name** (exact name from billing or **Settings → Account & organization**).
4. Click **Continue with SSO** — your browser opens your IdP sign-in.
5. After authentication, you land in the admin portal dashboard.

Password and Google remain on the same page for orgs that have not enabled **Require SSO**.

### Admin: configure SSO (3-step panel)

Org admins configure SAML at **Settings → Single sign-on** (`/settings/single-sign-on`). The panel follows three steps — match your IdP work to each:

| Step | Panel section | What you do |
| --- | --- | --- |
| **1. Coop service provider** | Top of page | Copy **Entity ID**, **ACS URL**, and **Metadata URL** into your IdP SAML app — or **Download metadata**. Share these with IT if they own the IdP. |
| **2. Identity provider** | Middle form | Choose provider (**Okta**, **Azure AD / Entra ID**, or **Generic SAML 2.0**). Paste IdP **Entity ID**, **SSO URL**, and **X.509 signing certificate**. Check **Enable SSO for this organization** → **Save SSO**. |
| **3. Sign-in policy** | Bottom section | Click **Test connection** (available when SSO is enabled). After a successful test, enable **Require SSO** to block password and Google (and revoke those sessions). Optionally keep **Allow email and password** / **Allow Google** while testing. |

If step 1 shows **Service provider URLs unavailable**, your Coop **operator** (not end users) must set `COOP_PUBLIC_BASE_URL` on the API server to the public backend URL (e.g. `https://api.coop-ai.dev`), then restart the API. This env var controls SAML callback URLs — it is operator infrastructure config, not something developers set in VS Code.

Full IdP walkthroughs: [Single Sign On (SSO)](/docs/sso).

### Admin portal settings hub

**Settings** is a hub with nested pages (not one long form). Open **Settings** in the sidebar, then choose a card:

| Page | Route | Who sees it | Purpose |
| --- | --- | --- | --- |
| **Account & organization** | `/settings/account` | All signed-in users | Profile, org info, sign-out |
| **Repository access** | `/settings/repository-access` | Pro / Enterprise admin | Per-user vs all-indexed repo grants |
| **Single sign-on** | `/settings/single-sign-on` | Enterprise admin only | SAML IdP config (3-step panel) and sign-in policy |

### Extension: sign in with SSO

1. **Extension UI** — **Settings → Account**.
2. Enter your **Organization name** below the email fields (case-insensitive).
3. Click **Sign in with SSO** — Coop opens your system browser for IdP login.
4. Complete sign-in in the browser; return to VS Code. **Account** shows your org and plan when the session is ready.

Admin portal login uses the same org name with **Continue with SSO** on `/login` instead of **Sign in with SSO**.

### Known limits (Enterprise SSO)

| Limit | Detail |
| --- | --- |
| **Shared service provider** | One Entity ID and ACS URL for all Enterprise tenants; org is resolved via RelayState at callback |
| **API keys under Require SSO** | Org API keys (`coop_…`) still work for automation — revoke on offboarding |
| **Existing sessions** | Enabling **Require SSO** revokes password/Google sessions immediately; SAML sessions stay until expiry |
| **JIT default role** | First SAML login creates a **member** — promote admins in **Users** |
| **No session refresh** | SAML sessions expire (default 12h); users re-authenticate through the IdP |

See [SAML SSO troubleshooting — Known limits](/docs/saml-sso-troubleshooting#known-limits) for the full list.

## Using the Extension

### Open the Coop sidebar

The Coop sidebar lives in the VS Code activity bar. When chat is empty, you'll see the **Quick Action** grid and a hint to type `/understand`, `/trace`, `/owner`, `/blast`, or `/gaps`.

### Start a new chat

Use the chat header at the top of the sidebar:

| Control | Action |
| --- | --- |
| **+** (New chat) | Start a fresh thread — empty composer and quick-action grid |
| **Thread title** dropdown | Switch between saved threads from this workspace |

<!-- figures -->
![New chat — click + in the Coop sidebar header to start a fresh thread](/screenshots/docs/extension-new-chat-button.png)
<!-- /figures -->

Previous threads stay in the dropdown until you delete them. Quick actions and slash commands always run in the **active** thread.

### Chat composer

Type free-form questions in the composer. Coop streams answers grounded in your code graph and connected integrations. Free-form chat uses **OpenAI GPT-4o mini** — assigned by Coop, not user-selected.

- Press **Enter** to send (Shift+Enter for a new line).
- Responses stream in real time with markdown formatting.
- Chat history persists in the session.

### File context chips

Before you send, look at the **file chip** inside the composer. That chip is the universal indicator for whether Coop is attaching a **remote** (codehost) file or a **local** workspace file.

<!-- figures md -->
![Remote file chip in the Coop chat composer — Dockerfile labeled raneyja/Coop-AI](/screenshots/docs/extension-remote-file-chip.png)
<!-- /figures -->

| Chip | Meaning |
| --- | --- |
| **`filename` · `owner/repo`** | **Remote** — indexed / codehost context (example: `Dockerfile` · `raneyja/Coop-AI`) |
| **`filename` · Local Workspace** | **Local** — open editor / on-disk folder |
| **No file chip** | No active file attached |

**How a remote chip appears**

- Open a file that maps to your primary / indexed repo — Coop auto-seeds the chip as remote-first when owner/repo are known
- Click the **folder** icon → Remote workspace → pick a file
- Type `@` and choose an indexed-repo hit

The folder icon opens the remote picker; the **chip with `owner/repo`** is what proves remote context is attached. Full detail: [File context — remote vs local](/docs/file-context).

### @-mentions and attachments

- Type `@` to search indexed repos and local workspace files (up to 3 @-mentions per message). Indexed hits show `owner/repo`; local hits show **Local Workspace**.
- Use the paperclip to attach images, PDFs, or text (up to 4 per message) — separate from the file-context chip.
- Selected lines in the editor are included automatically when selection context is enabled.

### Slash commands

Type `/` in the composer to see available commands. Quick actions:

| Slash | Action |
| --- | --- |
| `/understand` | Understand Repo |
| `/trace` | Trace Decision |
| `/owner` | Find Owner |
| `/blast` | Blast Radius |
| `/gaps` | Knowledge Gaps |
| `/edit` | Edit code — GPT-5.1 (aliases: `/patch`, `/fix`) |

Integration commands: `/slack`, `/jira`, `/teams`, `/confluence`, `/notion`, `/docs`.

### Settings overview

Open **CoopAI Settings** from the gear icon in the sidebar title bar (opens a dedicated settings tab). You can also run **CoopAI: Open Settings** from the Command Palette.

<!-- figures -->
![Settings gear — opens CoopAI Settings in an editor tab](/screenshots/docs/extension-settings-button.png)
<!-- /figures -->

<!-- figures -->
![CoopAI Settings hub — Account, Tools, Workspace, Indexing, and Preferences](/screenshots/docs/extension-settings-hub.png)
<!-- /figures -->

| Screen | Purpose |
| --- | --- |
| **Account** | Sign in (Google, email, SSO); signed-in org/plan + Sign out |
| **Plan & Usage** | Current plan, usage summary, upgrade path |
| **Tools** | Code hosts and integrations (production: read-only status; dev mode: PAT entry) |
| **Workspace** | Owner, repo, branch defaults |
| **Indexing** | Lightning Mode status and indexed repos (all plans; free capped at 3) |
| **Preferences** | Assigned models, prompt library, identity links, timezone |

Right-click any selection in the editor for **Trace Decision**, **Find Owner**, **Blast Radius**, **Understand Repo**, or **Knowledge Gaps**.

### Model assignments

Coop assigns a model per feature — you do **not** pick provider or model on Pro. Open **Settings → Preferences → Model & chat** to see four read-only assignment rows with **On** / **Off** badges.

| Feature | Assigned model |
| --- | --- |
| **Chat** | OpenAI GPT-4o mini |
| **Quick actions** + integration chat (`/slack`, `/jira`, …) | Anthropic Claude Sonnet 4.6 |
| **`/edit`, `/patch`, `/fix`** | OpenAI GPT-5.1 |
| **Autocomplete** | Mistral Codestral |

Enterprise custom model selection is coming soon. With `coopAI.devMode: true`, provider and model **dev overrides** apply to local testing only — not production routing.

Two toggles remain editable:

| Toggle | Effect |
| --- | --- |
| **Enable live LLM chat** | Chat, quick actions, and edit patches (badges show **Off** when disabled) |
| **Enable inline autocomplete** | Inline ghost text (syncs with the header **Autocomplete** toggle) |

Click **Save model settings** after changing toggles.

### Inline complete and edit selection

**Inline complete** — Ghost-text autocomplete as you type. **On by default** for new installs. Coop routes completions to **Mistral Codestral** (FIM).

Toggle **Autocomplete** in the chat header — **On** / **Off** — for a quick switch while you code. For a persistent preference, use **Settings → Preferences → Model & chat** → **Enable inline autocomplete**. The header toggle and this checkbox stay in sync. Preferences persist at **global scope** — workspace `.vscode/settings.json` cannot silently override your choice.

**Settings path:** Open **CoopAI Settings** → **Preferences** → **Model & chat** → check or uncheck **Enable inline autocomplete** → **Save model settings**. The header toggle and this checkbox stay in sync.

<!-- figures -->
![Model & chat — Enable inline autocomplete checkbox](/screenshots/docs/extension-autocomplete-settings-on-and-off.png)
<!-- /figures -->

<!-- figures -->
![Inline autocomplete — ghost-text suggestion in the editor](/screenshots/docs/inline-autocomplete.png)
<!-- /figures -->

| Step | Surface | Action |
| --- | --- | --- |
| Quick toggle | **Extension UI** — chat header | Click **Autocomplete** → **On** or **Off** |
| Settings | **Extension UI** — Settings → Preferences → Model & chat | **Enable inline autocomplete** → **Save model settings** |
| Enable | **File** — VS Code settings | Set `"coopAI.autocomplete.enabled": true` |
| Or toggle | **Extension UI** — Command Palette | **CoopAI: Toggle Autocomplete** |
| Accept | Editor | **Tab** |
| Reject | Editor | **Escape** |
| Manual trigger | Editor | **Ctrl+Shift+\\** (Windows/Linux) or **Cmd+Shift+\\** (macOS) |

**How it works:**

- VS Code `InlineCompletionItemProvider` shows streaming ghost text
- **FIM** (fill-in-the-middle) sends `prefix` + `suffix` segments when `coopAI.autocomplete.useFim` is `true` (default) — routed to assigned **Mistral Codestral**
- **Hot Streak** keeps completions snappy after Tab-accept; **Smart Throttle** adapts debounce to typing speed and latency
- **Multi-line** completions activate after `{`, `=>`, `(`, or inside blocks (up to 200 tokens)
- **Indexed repos:** when the workspace repo is **Deep-Indexed** and index status is **ready**, graph context (dependents and ownership) is attached automatically — no extra setting required. A one-time toast may confirm autocomplete is available with graph context. Set `coopAI.autocomplete.useGraphContext` to `true` to force graph on; leave at `false` (default) for auto when indexed (all plans)

**Copilot:** when Coop autocomplete is **on**, Coop automatically disables Copilot **inline** ghost text (`github.copilot.enable`) and restores your prior setting when you turn Coop autocomplete off. Copilot chat and other features stay available.

Full guide: [Inline autocomplete](/docs/autocomplete).

**Edit selection** — Shipped. Highlight code, describe the change in chat with `/edit`, `/patch`, or `/fix`, then **Apply** the generated patch from the VS Code notification. Coop routes edit patches through **OpenAI GPT-5.1**, attaches the **full active file** (selection is a focus hint, not a context window cut), and includes your editor selection text when present (`coopAI.includeSelection`, default `true`).

| Step | Surface | Action |
| --- | --- | --- |
| Generate | **Extension UI** — chat composer | `/edit <instruction>` (or `/patch`, `/fix`) with a selection or open file |
| Apply | **Extension UI** — notification | Click **Apply** on "Patch ready — …" |
| Or apply | **Extension UI** — Command Palette | **CoopAI: Apply Patch** (`coopAI.applyPatch`) |
| Undo | **Extension UI** — notification or Command Palette | **Undo** after apply, or **CoopAI: Undo Last Patch** (`coopAI.undoLastPatch`) |

Full guide: [Edit mode](/docs/edit-mode).

**Completion-only routing** — Inline requests use a separate zero-retention path (`x-use-case: code-completion-only`), distinct from chat.

## Quick Actions

Run quick actions from the **sidebar grid**, **slash commands** in chat (`/trace`, `/owner`, …), or the **editor context menu** — right-click a selection to see all five actions. Structured quick actions and integration slash commands (`/slack`, `/jira`, …) use **Anthropic Claude Sonnet 4.6** — assigned by Coop for reliable, evidence-backed outputs.

<!-- figures -->
![VS Code editor context menu — CoopAI quick actions for the current selection](/screenshots/docs/context-menu-quick-actions-dark.png)
<!-- /figures -->

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

<!-- figures -->
![Trace Decision result — summary with evidence card and source commit](/screenshots/docs/chat-results-with-evidence-trace-decision.png)
<!-- /figures -->

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

Integration commands query connected tools with the same **Anthropic Claude Sonnet 4.6** routing as quick actions.

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

<!-- figures sm -->
![Prompt library — search, pin, and create team prompts](/screenshots/docs/prompt-library.png)
<!-- /figures -->

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

### Keep it tool-agnostic

Write `AGENTS.md` so any AI assistant can follow it — plain Markdown, explicit surfaces (**File / Terminal / Browser / Extension UI**), and links to deeper docs in your repo. Avoid editor-specific config syntax so the same file helps every teammate regardless of the tools they use.

For large monorepos, add a nested `AGENTS.md` inside individual service or package folders. Coop loads the nearest file for the code you're working in, so root-level conventions stay general while service-specific notes live next to the code.

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
| AI usage | 80k tokens / 5-hour window | Higher limits (seat-based billing) |
| Model selection | Coop-assigned per feature | Coop-assigned per feature (Enterprise custom: coming soon) |
| Code hosts & integrations | Yes (admin portal) | Yes |
| Deep-Index / Lightning Mode | Yes (3 repos org-wide) | Yes (unlimited) |
| Team seats | Individual only (1 seat) | Multi-seat |
| Collections | No | Yes |
| Cross-repo search | Deep-Indexed repos (up to 3) | Unlimited indexed repos |

See [Pricing](/pricing) for current limits and upgrade paths.

## When to ask your admin

In **production mode**, org admins connect code hosts and collaboration tools once in the [admin portal](https://admin.coop-ai.dev). Individual developers sign in to Coop — they do not paste OAuth tokens in VS Code.

Ask your admin if:

- Quick actions return "integration not connected"
- You need a teammate invited or more than 3 Deep-Indexed repos (upgrade to Pro)
- Teammates need invites or seat assignments

Full admin setup is covered in the [Documentation hub](/docs).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **Not signed in** | **Settings → Account** — use Google, **Continue with email**, or **Sign in with SSO** (Enterprise) |
| **/trace or /blast disabled** | Open a file in the editor first |
| **Repo-wide /owner fails** | Set owner + repo in Settings → Workspace |
| **No Slack/Jira context** | Ask admin to connect integrations in admin portal |
| **Forgot password** | [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password) or **Forgot password?** on the password step |
| **Can't sign in** | Verify email is verified; try Google; Enterprise: enter org name → **Sign in with SSO** (browser handoff) |
| **`sso_required`** | Org enforces SSO — use **Continue with SSO** on [admin portal login](https://admin.coop-ai.dev/login) or **Sign in with SSO** in the extension; website login has no SSO |
| **`sso_not_configured`** | Admin: **Settings → Single sign-on** → save IdP config with **Enable SSO** checked |
| **`missing_org`** | Enter **Organization name** before starting SSO |
| **`saml_validation_failed`** | Check IdP cert expiry, clock skew, Entity ID / ACS URL match — see [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting) |
| **SP URLs empty in admin** | Operator: set `COOP_PUBLIC_BASE_URL` on API server and restart — not a user/extension setting |
| **Missing email in SAML assertion** | IdP admin: map `email` attribute or use email-format NameID — [Single Sign On (SSO)](/docs/sso#idp-requirements) |
| **Autocomplete turned off unexpectedly** | Preference persists globally — re-enable via header **Autocomplete** toggle or **Settings → Preferences → Model & chat → Enable inline autocomplete**. Remove stale `coopAI.autocomplete.enabled: false` from workspace `.vscode/settings.json` if present |

## Support

- **Email:** [hello@coop-ai.dev](mailto:hello@coop-ai.dev)
- **Demo / enterprise:** [Book a demo](/demo)
- **Documentation:** [Docs hub](/docs) for admin portal, integrations, API reference, and enterprise deployment
- **Enterprise SSO:** [Single Sign On (SSO)](/docs/sso) setup · [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting) error codes
- **Security questions:** [Security page](/security)
