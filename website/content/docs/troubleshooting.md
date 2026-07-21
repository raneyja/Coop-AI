---
title: Troubleshooting
description: Common issues and fixes for CoopAI extension, admin portal, and integrations.
section: help
order: 1
lastUpdated: "2026-07-21"
---

## Extension

| Problem | Fix |
| --- | --- |
| **Not signed in** | **Settings → Account** — **Continue with Google**, **Continue with email**, or **Sign in with SSO** |
| **401 unauthorized** | Sign out and sign in again; reset password at [forgot-password](https://coop-ai.dev/forgot-password) |
| **SSO required** | Your org requires SAML — extension: **Sign in with SSO** (enter org name); admin portal: **Organization name** + **Continue with SSO** on `/login` |
| **Chat returns empty** | Set Workspace owner/repo/branch; open a file for context; confirm **Enable live LLM chat** under Model & chat |
| **Answers feel like the wrong repo** | Check the composer **file chip**: `owner/repo` = remote; **Local Workspace** = local — see [File context](/docs/file-context) |
| **Expected remote context but chip says Local Workspace** | Confirm Settings → Workspace primary repo; open a file from that clone or pick via the folder (Remote workspace) icon |
| **No model picker in settings** | Expected in production — models are Coop-assigned; see [Model assignments](/docs/model-assignments) |
| **/trace or /blast disabled** | Open a file in the editor first |
| **Repo-wide /owner fails** | Set owner + repo in Settings → Workspace |
| **No integration context** | Ask admin to connect tools in admin portal |

## Verify production

| Check | Success looks like |
| --- | --- |
| **API** | [api.coop-ai.dev/health](https://api.coop-ai.dev/health) returns OK |
| **Model & chat** | Four assigned models, no provider picker |
| **Autocomplete** | Ghost text on type → **Tab** accepts |
| **/edit** | Patch notification with **Apply** / **Undo** |
| **Quick action** | Structured answer with repo/integration context |
| **Plain chat** | Grounded reply in composer |

## Autocomplete

| Problem | Fix |
| --- | --- |
| **No ghost text** | Confirm sidebar **Autocomplete On** or **Enable inline autocomplete** in Model & chat; sign in under **Settings → Account** |
| **Manual trigger does nothing** | Enable autocomplete first; use Ctrl+Shift+\\ (Cmd+Shift+\\ on macOS) |
| **Competing suggestions with Copilot** | Turn Coop autocomplete off, or leave it on — Coop automatically disables Copilot inline when enabled |
| **Slow or dropped completions** | Increase `requestTimeoutMs` (default 1500); check API latency; self-hosted API needs `MISTRAL_API_KEY` for Codestral FIM |
| **401 on completions** | Sign in again under **Settings → Account**; automation API keys do not replace user sign-in |
| **Graph context not applied** | Deep-Index the repo in admin portal; set `coopAI.autocomplete.useGraphContext` to `true`; set Workspace owner/repo/branch |
| **FIM not used** | Ensure `coopAI.autocomplete.useFim` is `true`; operator sets `MISTRAL_API_KEY` on API server for Codestral |
| **Workspace kept autocomplete off** | Coop clears workspace `false` overrides on activate; set `coopAI.autocomplete.enabled` in **User** settings |

Full guide: [Inline autocomplete](/docs/autocomplete).

## Admin portal

| Problem | Fix |
| --- | --- |
| **Cannot sign in** | Use email/password or Google from signup or invite — not an automation API key |
| **`email_not_verified`** | Google sign-in requires a verified Google email — verify in your Google account, then retry |
| **`rate_limited`** | Too many sign-in or password-reset attempts — wait ~15 minutes, then retry |
| **SSO required** | Your org enforces SAML — admin portal: **Organization name** + **Continue with SSO** on `/login` |
| **SAML sign-in failed** | See [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting) |
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
| **SAML SP URLs empty** | Coop **operator**: fix server configuration — [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise) |

## Enterprise SSO

| Problem | Fix |
| --- | --- |
| **SSO required** | Extension: **Sign in with SSO** (enter org name); admin portal: **Organization name** + **Continue with SSO** on `/login` |
| **`sso_not_configured`** | Admin: **Settings → Single sign-on** → save IdP config with **Enable SSO** checked |
| **`saml_validation_failed`** | Check IdP cert expiry, Entity ID / ACS URL match, server clock skew |
| **`sso_required_active`** | Turn off **Require SSO** before disabling SAML |
| **SP URLs empty in admin** | Coop **operator**: fix server configuration — [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise) |
| **IdP-initiated login fails** | Coop is SP-initiated only — start from admin **Test connection** or extension **Sign in with SSO** |
| **Browser handoff fails (extension)** | Complete IdP login in browser; see callback errors in [Extension settings — Enterprise SSO](/docs/extension-settings#enterprise-sso) |

Full error code table and known limits: [SSO troubleshooting](/docs/saml-sso-troubleshooting).

Coop **operators** (self-hosted or support): post-deploy validation steps in [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise).

## Still stuck?

- Email [hello@coop-ai.dev](mailto:hello@coop-ai.dev)
- [Book a demo](/demo) for enterprise support
- See [FAQ](/docs/faq)
