---
title: Admin portal
description: Sign in, connect integrations, invite users, and manage API keys.
section: admin
order: 1
lastUpdated: "2026-06-29"
---

The admin portal at [admin.coop-ai.dev](https://admin.coop-ai.dev) is where org admins configure Coop AI for the whole organization.

## Sign in

1. **Browser** → [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login)
2. Paste your **admin API key** (`coop_…`) from signup email or checkout.
3. Success: dashboard loads with org name and integration status.

Admin API keys are created during [free signup](/signup/free) or Pro/Enterprise checkout. Developers receive separate keys from the **Users** or **API Keys** pages.

## Dashboard

The dashboard shows:

- Integration connection status (GitHub, Slack, Jira, etc.)
- Onboarding wizard for first-time setup
- Usage and plan summary

## Connect integrations

Go to **Integrations** to connect tools org-wide. See [Connect integrations](/docs/connect-integrations) for the full checklist.

![Admin portal Integrations page with GitHub, Slack, and Jira cards showing Connect, Test, and Manage access actions](/screenshots/docs/admin-integrations-light.svg)

*Integrations at [admin.coop-ai.dev/integrations](https://admin.coop-ai.dev/integrations) — connect tools org-wide, test connections, and manage access scopes (Enterprise).*

In production mode, developers **cannot** paste OAuth tokens in VS Code — admins connect once here.

## Integration scope

Enterprise orgs configure which Slack channels, Jira projects, Notion workspaces, etc. Coop can access. See [Integration scope](/docs/integration-scope).

## Users

**Users** page:

- Invite teammates by email
- Assign roles (admin vs developer)
- Revoke access

Developers sign into the VS Code extension with their org API key — not the admin key.

## API keys

**API Keys** page:

- Create labeled keys for developers and CI
- Revoke compromised keys
- View last-used timestamps

Each key is scoped to your org. Keys gate `/v1/chat`, inline completion, and graph endpoints.

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
