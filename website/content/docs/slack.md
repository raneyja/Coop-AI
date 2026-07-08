---
title: Slack
description: Connect Slack for Trace Decision and Knowledge Gaps with thread context.
section: integrations
order: 4
lastUpdated: "2026-06-29"
---

Slack connects through browser OAuth. Coop uses both **bot** and **user** tokens.

## Org admin — connect Slack

1. **Admin portal** → Integrations → **Connect Slack**
2. **Browser** → Approve OAuth in Slack
3. Return → **Test Slack**

**Enterprise:** **Manage access** → select channels → **Save scope** → **Test**

**Success:** Connected (Enterprise: **Active** after scope saved).

<!-- figures -->
![Slack OAuth — approve CoopAI app permissions for your workspace](/screenshots/docs/admin-slack-oath.png)
<!-- /figures -->

## Why both bot and user tokens?

| Token | Used for |
| --- | --- |
| **Bot** (`xoxb-…`) | Channel picker, channel metadata |
| **User** (`xoxp-…`) | Workspace message search, thread history |

## Required OAuth scopes

Your Coop operator registers these in [api.slack.com/apps](https://api.slack.com/apps):

**Bot Token Scopes:** `channels:read`, `groups:read`, `channels:history`, `users:read`, `users:read.email`

**User Token Scopes:** `search:read`, `channels:history`, `groups:history`, `users:read`, `users:read.email`

## Using Slack in chat

Type `/slack` in the composer:

```
/slack what did #platform-auth decide about session TTL?
```

Or ask naturally — Coop pulls Slack context when connected and scoped.

## Private channels

The Coop bot must be **invited** to private channels before they appear in the scope picker.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Invalid permissions requested" | Add missing scopes in Slack app settings; reinstall to workspace |
| Channel picker empty | Disconnect + reconnect after reinstalling Slack app |
| `missing_scope` in Manage access | Add bot scopes `channels:read`, `groups:read`; reconnect |
| Search returns nothing | Save scope with allowlisted channels; test again |

See [Integration scope](/docs/integration-scope) for Enterprise allowlists.
