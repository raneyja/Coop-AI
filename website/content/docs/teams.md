---
title: Microsoft Teams
description: Connect Microsoft Teams for Trace Decision and Knowledge Gaps with channel message context.
section: integrations
order: 8
lastUpdated: "2026-07-05"
---

Microsoft Teams connects through browser OAuth (Microsoft Graph). Coop searches **Teams channel messages** for Trace Decision and Knowledge Gaps.

Requires **work or school Microsoft 365** with Teams channels. Personal Microsoft accounts and Teams Community are not supported for channel search.

## Org admin — connect Teams

1. **Admin portal** → Integrations → **Connect** on **Microsoft Teams**
2. **Browser** → Sign in with work/school account → approve permissions (admin consent if your IT requires it)
3. Return → **Refresh** → **Test Teams**

**Success:** Connected — status shows your Microsoft account name.

Admins can also connect from **Extension UI → Settings → Tools → Microsoft Teams** (same OAuth flow).

## What Teams enables

| Feature | How Coop uses Teams |
| --- | --- |
| **Trace Decision** | Channel threads linked to PRs, tickets, or repo terms |
| **Knowledge Gaps** | Cross-tool context from Teams discussions |
| **Chat** | `/teams` or natural questions about Teams threads |

## Required Graph permissions

Your Coop operator registers an Entra (Azure AD) app with these **delegated** permissions:

| Permission | Purpose |
| --- | --- |
| `User.Read` | Sign-in profile |
| `Team.ReadBasic.All` | List teams the user can access |
| `ChannelMessage.Read.All` | Read channel messages for search |
| `offline_access` | Refresh tokens |

`ChannelMessage.Read.All` often requires **admin consent** in enterprise tenants. If Connect fails with a consent error, ask your Microsoft 365 admin to approve the Coop app.

## Using Teams in chat

Type `/teams` in the composer:

```
/teams any threads about session TTL in platform-auth?
```

Or ask naturally — Coop pulls Teams context when connected and your question references discussions.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 503 / not configured on server | Contact Coop operator — `TEAMS_APP_CLIENT_ID` / `TEAMS_APP_CLIENT_SECRET` missing |
| Admin consent required | Microsoft 365 admin must grant Graph permissions for the Coop app |
| Connected but search empty | User must have access to Teams channels; personal Teams has no channel search |
| Redirect URI mismatch | Operator must register `https://api.coop-ai.dev/v1/teams/app/callback` in Azure |

See [Connect integrations](/docs/connect-integrations) for the full checklist.
