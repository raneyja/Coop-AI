---
title: Troubleshooting
description: Common issues and fixes for Coop AI extension, admin portal, and integrations.
section: help
order: 1
lastUpdated: "2026-07-06"
---

## Extension

| Problem | Fix |
| --- | --- |
| **Not signed in** | **Settings → Account** — sign in with email/password, Google, or SSO (Enterprise) |
| **Test connection fails** | Confirm you are signed in; check API base URL (`https://api.coop-ai.dev`) and network |
| **401 unauthorized** | Sign out and sign in again; reset password at [forgot-password](https://coop-ai.dev/forgot-password) |
| **SSO required** | Your org requires SAML — use **Sign in with SSO** and enter your organization name |
| **Chat returns empty** | Set Workspace owner/repo/branch; open a file for context |
| **/trace or /blast disabled** | Open a file in the editor first |
| **Repo-wide /owner fails** | Set owner + repo in Settings → Workspace |
| **No integration context** | Ask admin to connect tools in admin portal |

## Autocomplete

| Problem | Fix |
| --- | --- |
| **No ghost text** | Set `coopAI.autocomplete.enabled` to `true` in VS Code settings |
| **Manual trigger does nothing** | Enable autocomplete first; use Ctrl+Shift+\\ (Cmd+Shift+\\ on macOS) |
| **Competing suggestions with Copilot** | Turn Coop autocomplete off, or leave it on — Coop automatically disables Copilot inline when enabled |
| **Slow or dropped completions** | Increase `requestTimeoutMs` (default 400); check API latency; self-hosted API needs `MISTRAL_API_KEY` or `DEEPSEEK_API_KEY` for FIM, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` for chat fallback |
| **401 on completions** | Sign in again under **Settings → Account**; automation API keys do not replace user sign-in |
| **Graph context not applied** | Pro plan required; connect and index repo in admin portal; set Workspace owner/repo/branch |
| **FIM not used** | Ensure `coopAI.autocomplete.useFim` is `true`; operator sets `MISTRAL_API_KEY` or `DEEPSEEK_API_KEY` on API server |

Full guide: [Inline autocomplete](/docs/autocomplete).

## Admin portal

| Problem | Fix |
| --- | --- |
| **Cannot sign in** | Use email/password or Google from signup or invite — not an automation API key |
| **Invite link expired** | Ask admin to resend invite from **Users** |
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
| **No welcome email** | Check spam; sign in at [admin portal login](https://admin.coop-ai.dev/login) with checkout email |

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
