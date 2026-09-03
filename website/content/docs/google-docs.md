---
title: Google Docs
description: Connect Google Docs for documentation context in Coop answers.
section: integrations
order: 7
lastUpdated: "2026-09-03"
---

## Org admin — connect Google Docs

1. **Admin portal** → Integrations → **Connect Google Docs**
2. **Browser** → Approve Google OAuth (work account)
3. **Test Google Docs**

**Enterprise:** **Manage access** → select shared drives or folders.

## Using Google Docs in chat

`/docs` (aliases `/googledocs`, `/google-docs`) **only searches Google Docs**. It does not hunt or explain repository code.

```
/docs find the design doc for the billing idempotency change
```

**Pass looks like:** titles of matching Docs, or a clear “the attached Docs do not cover this” / “not connected” / “no matching documents” reply. **Fail looks like:** a code explain, an invented `.ts` / `.js` / `.py` path, or a file from another repo.

If Docs isn’t connected, Coop says so and does not fall back to the Use-repo.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Insufficient scopes | Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), re-Connect |
| Empty results | Ensure docs are shared with the connected Google account. Empty is expected when no Doc matches — Coop will not invent code instead. |
| Personal vs work account | Use a work Google Workspace account matching your org |

See [Connect integrations](/docs/connect-integrations).
