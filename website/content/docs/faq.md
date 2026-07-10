---
title: FAQ
description: Frequently asked questions about CoopAI plans, privacy, security, and features.
section: help
order: 2
lastUpdated: "2026-07-09"
---

## General

### What is CoopAI?

CoopAI is a VS Code extension that connects your code graph, Slack, Jira, and docs to answer deep engineering questions and write graph-grounded completions — without cloning entire monorepos.

### How is CoopAI different from GitHub Copilot or Cursor?

CoopAI focuses on **understanding existing codebases** — ownership, decision history, blast radius, knowledge gaps — with cross-tool context from Slack and tickets. Inline complete and edit selection are craftsmanship tools, not autonomous agents rewriting your tree.

### Is my code used to train models?

No. Your code and prompts are never used to train foundation models. See [Security architecture](/docs/security-architecture).

## Plans

### What's included in the free Developer plan?

Full tool connectivity (GitHub, GitLab, Bitbucket, Slack, Jira, Notion, Google Docs, Teams) via the admin portal, Deep-Index / Lightning Mode on up to 3 repos org-wide, workspace repos, chat, quick actions, and AI credits (80,000 tokens per 5-hour window). Solo account only — no team invites.

### How do I upgrade to Pro?

[Pricing](/pricing) → Stripe checkout → admin portal setup. See [Plans & billing](/docs/plans-billing).

### Do you offer Enterprise self-hosting?

Yes. Contact [hello@coop-ai.dev](mailto:hello@coop-ai.dev). See [Enterprise deployment](/docs/enterprise-deployment).

## Setup

### How do I sign in?

Create an account at [free signup](/signup/free) (email + password or Google), or accept an invite from your org admin. Then sign in in the **extension** or **admin portal**:

| Surface | Sign-in paths |
| --- | --- |
| **Extension** → Settings → Account | **Continue with Google** · email (two-step) · **Sign in with SSO** |
| **Admin portal** | Email/password · Google · **Organization name** + **Continue with SSO** (Enterprise) |

Email in the extension is two steps: enter email → **Continue with email** → password → **Sign in**.

### Do I need an API key?

No for normal use. **Automation API keys** (`coop_…`) are optional — for CI and scripts only. Create them in the admin portal **API Keys** page if needed.

### Who connects Slack and GitHub?

In production mode, **org admins** connect integrations once in the [admin portal](/docs/admin-portal). Developers do not paste OAuth tokens.

### What is dev mode?

`coopAI.devMode: true` lets individual developers paste PATs locally for testing. Disable for production orgs.

## Features

### What are quick actions?

Five built-in actions: Understand Repo, Trace Decision, Find Owner, Blast Radius, Knowledge Gaps. See the [Owner's Manual](/manual#quick-actions).

### What is Lightning Mode?

Deep-Index builds a searchable code graph on Coop infrastructure for faster cross-repo symbol-graph search. Available on **all plans**; free orgs are capped at **3 Deep-Indexed repos** org-wide. Pro adds unlimited indexing.

### Can I share prompts with my team?

Yes. Commit `.coop/prompts.json` to your repo. See [Owner's Manual — Prompt Library](/manual#prompt-library).

## Enterprise SSO

### Does Coop support SAML single sign-on?

Yes, on the **Enterprise** plan. Org admins configure SAML in the admin portal under **Settings → Single sign-on**. Supported IdPs include Okta, Azure AD / Entra ID, and any SAML 2.0 provider with signed assertions. See [Single Sign On (SSO)](/docs/sso).

### Where can I sign in with SSO?

| Surface | SSO available? |
| --- | --- |
| **Admin portal** ([admin.coop-ai.dev/login](https://admin.coop-ai.dev/login)) | Yes — **Organization name** + **Continue with SSO** |
| **VS Code extension** → Settings → Account | Yes — **Sign in with SSO** (browser handoff) |
| **Marketing site** ([coop-ai.dev/login](https://coop-ai.dev/login)) | No — email/password or Google only |

### What happens when my org requires SSO?

When an admin enables **Require SSO**, password and Google sign-in return `sso_required`. Existing sessions stay valid until expiry. Org API keys for automation still work — admins should revoke keys for offboarded users.

### Can I disable SSO after enabling Require SSO?

Turn off **Require SSO** in **Settings → Single sign-on → Sign-in policy** first. Disabling SAML while **Require SSO** is active returns `sso_required_active`.

## Support

### How do I contact support?

Email [hello@coop-ai.dev](mailto:hello@coop-ai.dev) or [book a demo](/demo).

### Where is the install guide?

[Owner's Manual — Get Started](/manual#get-started) or [Getting started docs](/docs/getting-started).
