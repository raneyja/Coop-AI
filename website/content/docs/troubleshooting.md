---
title: Troubleshooting
description: Common issues and fixes for Coop AI extension, admin portal, and integrations.
section: help
order: 1
lastUpdated: "2026-06-30"
---

## Extension

| Problem | Fix |
| --- | --- |
| **Test connection fails** | Verify API key, base URL (`https://api.coop-ai.dev`), network access |
| **401 unauthorized** | Create new API key in admin portal; revoke old key |
| **Chat returns empty** | Set Workspace owner/repo/branch; open a file for context |
| **/trace or /blast disabled** | Open a file in the editor first |
| **Repo-wide /owner fails** | Set owner + repo in Settings → Workspace |
| **No integration context** | Ask admin to connect tools in admin portal |

## Autocomplete

| Problem | Fix |
| --- | --- |
| **No ghost text** | Set `coopAI.autocomplete.enabled` to `true` in VS Code settings |
| **Manual trigger does nothing** | Enable autocomplete first; use Ctrl+Shift+\\ (Cmd+Shift+\\ on macOS) |
| **Competing suggestions with Copilot** | Set `coopAI.autocomplete.copilotPolicy` to `disable-when-copilot`, or disable Copilot inline |
| **Slow or dropped completions** | Increase `requestTimeoutMs` (default 400); check API latency; self-hosted needs provider keys |
| **401 on completions** | Verify API key; create new key in admin portal if revoked |
| **Graph context not applied** | Pro plan required; connect and index repo in admin portal; set Workspace owner/repo/branch |
| **FIM not used** | Ensure `coopAI.autocomplete.useFim` is `true`; operator sets `MISTRAL_API_KEY` or `DEEPSEEK_API_KEY` on API server |

Full guide: [Inline autocomplete](/docs/autocomplete).

## Admin portal

| Problem | Fix |
| --- | --- |
| **Cannot sign in** | Use admin API key from signup email, not developer key |
| **503 on Connect** | Coop operator must configure OAuth apps on API server |
| **403 admin required** | User needs org owner/admin role |
| **Integration shows Connected but search empty** | Configure scope → Save → Test |

## Integrations

| Problem | Fix |
| --- | --- |
| **Redirect URI mismatch** | Operator: callback URL must match vendor console exactly |
| **Slack channel picker empty** | Reinstall Slack app with bot scopes; Disconnect + Connect |
| **Google insufficient scopes** | Revoke at Google account permissions; re-Connect |
| **GitHub callback fails** | Verify GitHub App setup URL matches API host |
| **Jira empty results** | Set Jira site URL; check project scope |

## Billing

| Problem | Fix |
| --- | --- |
| **Checkout link invalid** | Start fresh from [Pricing](/pricing) |
| **Welcome page stuck provisioning** | Wait 1–2 minutes; check email; [contact support](/demo) |
| **Missing API key email** | Check spam; create key in admin portal |

## Self-hosted

| Problem | Fix |
| --- | --- |
| **Health check fails** | Verify `DATABASE_URL`, restart API container |
| **LLM 502 errors** | Check provider API keys in `.env.backend` |
| **Webhooks not firing** | Verify webhook URL and secret in GitHub settings |

## Still stuck?

- Email [hello@coop-ai.dev](mailto:hello@coop-ai.dev)
- [Book a demo](/demo) for enterprise support
- See [FAQ](/docs/faq)
