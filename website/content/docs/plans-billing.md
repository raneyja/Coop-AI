---
title: Plans & billing
description: Free, Pro, Pro+, Max, and Enterprise — seats, included usage, and upgrade paths.
section: plans
order: 1
lastUpdated: "2026-09-03"
---

## Plan comparison

| Feature | Free | Pro | Pro+ | Max | Enterprise |
| --- | --- | --- | --- | --- | --- |
| **Price** | Free | $25/seat/month | $60/seat/month | $100/seat/month | Custom |
| **VS Code extension** | Yes | Yes | Yes | Yes | Yes |
| **Usage** | Rolling 5-hour Auto window | Monthly included usage | More included usage | Highest self-serve included usage | Custom / no hard cap in v1 |
| **Model picker** | Auto only | Global picker (default Auto) | Same | Same | Same |
| **Code hosts (GitHub, GitLab, Bitbucket)** | Yes (admin portal) | Yes | Yes | Yes | Yes |
| **Collaboration integrations** | Yes (admin portal) | Yes (scope allowlist) | Yes | Yes | Yes |
| **Deep-Index / Lightning Mode** | Yes (up to 3 repos org-wide) | Yes (unlimited) | Yes | Yes | Yes |
| **Workspace repos** | Up to 3 | Up to 3 per seat | Up to 3 per seat | Up to 3 per seat | Unlimited |
| **Team seats** | Individual (1 seat) | Multi-seat | Multi-seat | Multi-seat | Unlimited |
| **Collections** | No | Yes | Yes | Yes | Yes |
| **Admin portal** | Personal account | Full org admin | Full org admin | Full org admin | Full + SSO |
| **Self-hosted** | No | No | No | No | Yes |
| **BYOK** | No | No | No | No | Yes |
| **Zero-retention routing** | Standard | Standard | Standard | Standard | Enterprise-confidential |
| **DPA / attestation** | No | No | No | No | Yes |

See current pricing at [coop-ai.dev/pricing](/pricing).

Paid seats include a monthly usage bar. **Auto** (green) is Coop-assigned models. **Frontier** (blue) starts after Auto and is models you pick — those fill the bar faster. Together they are utilization. When the bar is full, requests stop until you upgrade — there is no on-demand spend. The bar shows a percent, not a second dollar price.

Capability gates (team invites, Collections, Deep-Index) stay on the `pro` plan. Usage amounts come from the usage tier (Pro / Pro+ / Max).

## Free

1. **Browser** → [Signup free](/signup/free) — email and password, or Google
2. Personal admin portal access with the same account
3. Connect code hosts and integrations in the [admin portal](/docs/admin-portal)
4. Deep-Index up to **3 repos** org-wide; use workspace repos, chat, and quick actions in production mode

Free includes the same tool connectivity and cloud indexing as Pro. Limits are the rolling Auto window, the 3-repo Deep-Index cap, and solo account (no team invites). Free stays Auto-only.

## Pro, Pro+, and Max

1. **Browser** → [Pricing](/pricing) → checkout for Pro, Pro+, or Max
2. Stripe payment → [Welcome page](/welcome) provisioning
3. Admin connects GitHub + integrations (same flow as free)
4. Invite team from admin portal

These plans are **seat-based**. Each paid seat includes the extension, unlimited Deep-Indexed repos, team collaboration, Collections, and monthly included usage. Hit the cap and you must upgrade — Coop does not sell extra usage on demand.

Public names: **Pro** ($25), **Pro+** ($60), **Max** ($100). There is no Ultra / $200 individual plan. Above Max is Enterprise.

## Enterprise

Contact [support@coop-ai.dev](mailto:support@coop-ai.dev) or [book a demo](/demo) for:

- Self-hosted deployment on your infrastructure
- BYOK (bring your own LLM provider keys)
- Zero-retention LLM routing for confidential code
- Dedicated onboarding, compliance attestation, and DPA
- Custom pooled usage (no hard stop in v1)

### SAML single sign-on

Enterprise includes **SAML 2.0 SSO** for the admin portal and VS Code extension:

| Capability | Detail |
| --- | --- |
| **IdP support** | Okta, Azure AD / Entra ID, or any SAML 2.0 IdP with signed assertions |
| **Admin setup** | **Settings → Single sign-on** — copy SP values, paste IdP config, **Test connection**, then **Require SSO** |
| **Sign-in surfaces** | Admin portal (**Continue with SSO**) and extension (**Sign in with SSO** with browser handoff) |
| **Policy** | Optional **Require SSO** to block password and Google sign-in (including refresh); revokes existing password/Google sessions when enabled; org API keys still work for automation |

Setup guide: [Single Sign On (SSO)](/docs/sso). Troubleshooting: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

See also [Enterprise deployment](/docs/enterprise-deployment) and [Security architecture](/docs/security-architecture).

## Billing management

**Admin portal → Billing** (paid):

- View invoices and payment method via Stripe customer portal
- Add seats
- Upgrade plan (Pro → Pro+ → Max)

## Usage limits

| Plan | What you see |
| --- | --- |
| **Free** | Rolling 5-hour Auto window in the extension and admin portal |
| **Pro / Pro+ / Max** | One stacked bar — Auto (green) then Frontier (blue) — resetting on the UTC calendar month |
| **Enterprise** | Custom contract; no hard stop in v1 |

The bar shows a percent, not a second dollar amount. Frontier models fill it faster because they cost more to run.

## Next steps

- [Getting started](/docs/getting-started)
- [Model assignments](/docs/model-assignments)
- [Admin portal](/docs/admin-portal)
- [Enterprise deployment](/docs/enterprise-deployment)
