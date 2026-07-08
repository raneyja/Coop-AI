---
title: Notion
description: Connect Notion for documentation cross-reference in Coop answers.
section: integrations
order: 6
lastUpdated: "2026-06-29"
---

## Org admin — connect Notion

1. **Admin portal** → Integrations → **Connect Notion**
2. **Browser** → Approve Notion OAuth
3. **Test Notion**

**Enterprise:** **Manage access** → select workspaces/pages → Save scope.

<!-- figures -->
![Notion OAuth — connect CoopAI and select pages to share](/screenshots/docs/admin-notion-oath.png)
<!-- /figures -->

## Using Notion in chat

Type `/notion` in the composer:

```
/notion find the RFC on webhook deduplication
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Empty search | Ensure pages are shared with the integration; check scope |
| OAuth type wrong | Notion integration must be type **OAuth**, not internal integration |
| Re-connect needed | Revoke at Notion settings and Connect again |

See [Connect integrations](/docs/connect-integrations).
