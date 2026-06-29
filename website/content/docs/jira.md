---
title: Jira
description: Connect Jira for ticket-linked decision archaeology and knowledge gaps.
section: integrations
order: 5
lastUpdated: "2026-06-29"
---

Jira connects via Atlassian OAuth (shared with Confluence).

## Org admin — connect Jira

1. **Admin portal** → Integrations → **Connect Jira**
2. **Browser** → Approve Atlassian OAuth
3. Set **Jira site URL** (e.g. `https://yourorg.atlassian.net`)
4. **Test Jira**

**Enterprise:** **Manage access** → select projects → Save scope.

## Using Jira in chat

Type `/jira` in the composer:

```
/jira what tickets are open for the auth middleware refactor?
```

**Trace Decision** and **Knowledge Gaps** automatically cross-reference Jira when connected.

## Confluence

Confluence uses the same Atlassian OAuth app. Connect separately and set **Confluence site URL**. Use `/confluence` or `/wiki` in chat.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Empty ticket search | Verify Jira site URL; check scope includes relevant projects |
| OAuth redirect fails | Callback must be `https://api.coop-ai.dev/v1/atlassian/app/callback` |
| 403 on search | Re-connect; ensure Atlassian app has required scopes |

See [Connect integrations](/docs/connect-integrations) for the full checklist.
