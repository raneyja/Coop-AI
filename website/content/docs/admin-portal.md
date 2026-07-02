---
title: Admin portal
description: Sign in, connect integrations, invite users, and manage automation API keys.
section: admin
order: 1
lastUpdated: "2026-06-29"
---

The admin portal at [admin.coop-ai.dev](https://admin.coop-ai.dev) is where org admins configure Coop AI for the whole organization.

## Sign in

1. **Browser** → [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login)
2. Sign in with your **email and password**, or click **Continue with Google**.
3. **Enterprise:** expand **More sign-in options** → **Sign in with SSO** (SAML).
4. Success: dashboard loads with org name and integration status.

Accounts are created during [free signup](/signup/free) or Pro/Enterprise checkout. Use the same email you registered with.

**Forgot your password?** → [admin.coop-ai.dev/forgot-password](https://admin.coop-ai.dev/forgot-password)

## Dashboard

The dashboard shows:

- Integration connection status (GitHub, Slack, Jira, etc.)
- Onboarding wizard for first-time setup
- Usage and plan summary

## Connect integrations

Go to **Integrations** to connect tools org-wide. See [Connect integrations](/docs/connect-integrations) for the full checklist.

In production mode, developers **cannot** paste OAuth tokens in VS Code — admins connect once here.

## Integration scope

Enterprise orgs configure which Slack channels, Jira projects, Notion workspaces, etc. Coop can access. See [Integration scope](/docs/integration-scope).

## Users

**Users** page:

- Invite teammates by email
- Assign roles (admin vs developer)
- Revoke access

Developers sign into the VS Code extension with their work email and password, Google, or org SSO — not an automation API key.

## API keys (automation only)

**API Keys** page — for scripts, CI, and headless automation:

- Create labeled keys for automation pipelines
- Revoke compromised keys
- View last-used timestamps

API keys are **not** the primary sign-in method. Developers and admins sign in with email/password, Google, or SSO. Issue API keys only when a teammate needs programmatic access.

## Billing

**Billing** page (Pro/Enterprise):

- View current plan and seat count
- Open Stripe customer portal for invoices and payment method
- Upgrade or add seats

## Audit log

**Audit** page records admin actions: integration connect/disconnect, scope changes, user invites, API key creation.

## First-time onboarding wizard

New orgs see a setup wizard:

1. Connect integrations
2. Configure scope (Enterprise Slack, etc.)
3. Invite teammates
4. Verify health

Complete all required steps before marking onboarding done.

## Who can access the admin portal?

Users with `canInstallIntegrations: true` (org owner or admin role). Developers use the VS Code extension only.

## Next steps

- [Connect integrations](/docs/connect-integrations)
- [Integration scope](/docs/integration-scope)
- [Owner's Manual — Get Started](/manual#get-started)
