---
title: Integration scope
description: Configure which Slack channels, Jira projects, and workspaces Coop can access.
section: integrations
order: 2
lastUpdated: "2026-06-29"
---

After connecting an integration, Enterprise orgs configure **scope** — the allowlist of channels, projects, or workspaces Coop can read.

## Why scope matters

Coop follows least-privilege access. Even with OAuth connected, Enterprise plans require explicit scope before Coop searches Slack messages or Jira tickets.

## Admin portal — Manage access

1. **Browser** → [admin.coop-ai.dev/integrations](https://admin.coop-ai.dev/integrations)
2. Find the connected integration → **Manage access**
3. Select allowed channels, projects, or folders
4. **Save scope** → **Test**

**Success:** Scope status shows **Active** (not just Connected).

## Slack scope

Requires both OAuth connect **and** channel allowlist:

1. Connect Slack (user + bot tokens)
2. **Manage access** → select channels → Save
3. **Test** — confirms search works in allowlisted channels

Private Slack channels require the Coop bot to be invited to those channels.

See [Slack setup](/docs/slack) for required OAuth scopes.

## Jira / Confluence scope

After Atlassian OAuth connect:

1. Set **Jira site URL** and **Confluence site URL** in integration settings
2. **Manage access** → select projects/spaces
3. Save and test

## Notion scope

Select workspaces and pages Coop can search. Re-connect if you add new top-level pages.

## Google Docs scope

Scope to shared drives or folders. Revoke and re-connect at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) if you see insufficient scope errors.

## Verify scope health

Admin portal integration cards show:

| Status | Meaning |
| --- | --- |
| **Connected** | OAuth complete, scope not yet configured |
| **Active** | Scope saved and tested |
| **Needs reconnect** | Token expired or scopes changed in vendor console |

Extension **Settings → Tools** shows read-only status for developers.

## Next steps

- [Connect integrations](/docs/connect-integrations)
- [Troubleshooting](/docs/troubleshooting)
