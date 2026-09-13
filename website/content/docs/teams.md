---
title: Microsoft Teams
description: Connect Microsoft Teams for Trace Decision and Knowledge Gaps with channel message context.
section: integrations
order: 8
lastUpdated: "2026-09-13"
---

Microsoft Teams connects through browser OAuth (Microsoft Graph). Coop searches **Teams channel messages** for Trace Decision and Knowledge Gaps.

Requires **work or school Microsoft 365** with Teams channels. Personal Microsoft accounts and Teams Community are not supported for channel search.

## Org admin — connect Teams

1. **Admin portal** → Integrations → **Connect** on **Microsoft Teams**
2. **Browser** → Sign in with work/school account → approve permissions (admin consent if your IT requires it)
3. Return → **Refresh** → **Manage access** → pick channels → **Save access**
4. **Test Teams**

**Success:** Card shows a channel count (for example “2 channels selected”).

Admins can also connect from **Extension UI → Settings → Tools → Microsoft Teams** (same OAuth flow). Scope still lives in the admin portal.

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
| `Channel.ReadBasic.All` | List channels for Manage access |
| `ChannelMessage.Read.All` | Read channel messages for search |
| `Chat.Read` | Message search. Reconnect after this permission is added. |
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
| Connected but search empty | Pick channels in **Manage access**; user must belong to those channels |
| No Manage access button | Reconnect Teams after `Channel.ReadBasic.All` and `Chat.Read` are approved |
| Redirect URI mismatch | Operator must register `https://api.coop-ai.dev/v1/teams/app/callback` in Azure |

See [Connect integrations](/docs/connect-integrations) for the full checklist.
