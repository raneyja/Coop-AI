---
title: Google Docs
description: Connect Google Docs for documentation context in Coop answers.
section: integrations
order: 7
lastUpdated: "2026-06-29"
---

## Org admin — connect Google Docs

1. **Admin portal** → Integrations → **Connect Google Docs**
2. **Browser** → Approve Google OAuth (work account)
3. **Test Google Docs**

**Enterprise:** **Manage access** → select shared drives or folders.

## Using Google Docs in chat

Type `/docs`, `/googledocs`, or `/google-docs`:

```
/docs find the design doc for the billing idempotency change
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Insufficient scopes | Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), re-Connect |
| Empty results | Ensure docs are shared with the connected Google account |
| Personal vs work account | Use a work Google Workspace account matching your org |

See [Connect integrations](/docs/connect-integrations).
