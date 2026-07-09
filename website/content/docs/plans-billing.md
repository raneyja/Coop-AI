---
title: Plans & billing
description: Developer, Pro, and Enterprise plans — features, limits, and upgrade paths.
section: plans
order: 1
lastUpdated: "2026-07-09"
---

## Plan comparison

| Feature | Developer (free) | Pro | Enterprise |
| --- | --- | --- | --- |
| **Price** | Free | $20/seat/month | Custom |
| **VS Code extension** | Yes | Yes | Yes |
| **Local workspace context** | Yes | Yes | Yes |
| **AI credits** | 80k tokens / 5-hour window (model-weighted) | Higher limits | Custom |
| **Code hosts (GitHub, GitLab, Bitbucket)** | Yes (admin portal) | Yes | Yes |
| **Collaboration integrations** | Yes (admin portal) | Yes (scope allowlist) | Yes (scope allowlist) |
| **Deep-Index / Lightning Mode** | Yes (up to 3 repos org-wide) | Yes (unlimited) | Yes |
| **Workspace repos** | Up to 3 | Up to 3 per seat | Unlimited |
| **Team seats** | Individual (1 seat) | Multi-seat | Unlimited |
| **Collections** | No | Yes | Yes |
| **Admin portal** | Personal account | Full org admin | Full + SSO |
| **Self-hosted** | No | No | Yes |
| **BYOK** | No | No | Yes |
| **Zero-retention routing** | Standard | Standard | Enterprise-confidential |
| **DPA / attestation** | No | No | Yes |

See current pricing at [coop-ai.dev/pricing](/pricing).

## Developer (free)

1. **Browser** → [Signup free](/signup/free) — email and password, or Google
2. Personal admin portal access with the same account
3. Connect code hosts and integrations in the [admin portal](/docs/admin-portal)
4. Deep-Index up to **3 repos** org-wide; use workspace repos, chat, and quick actions in production mode

Free includes the same tool connectivity and cloud indexing as Pro. Limits are AI credits, the 3-repo Deep-Index cap, and solo account (no team invites).

## Pro

1. **Browser** → [Pricing](/pricing) → checkout
2. Stripe payment → [Welcome page](/welcome) provisioning
3. Admin connects GitHub + integrations (same flow as free)
4. Invite team from admin portal

Pro adds unlimited Deep-Indexed repos, team seats, higher AI limits, Collections, usage analytics, and integration scope allowlists (same default-deny policy as Enterprise).

## Enterprise

Contact [hello@coop-ai.dev](mailto:hello@coop-ai.dev) or [book a demo](/demo) for:

- Self-hosted deployment on your infrastructure
- BYOK (bring your own LLM provider keys)
- Zero-retention LLM routing for confidential code
- Dedicated onboarding, compliance attestation, and DPA

### SAML single sign-on

Enterprise includes **SAML 2.0 SSO** for the admin portal and VS Code extension:

| Capability | Detail |
| --- | --- |
| **IdP support** | Okta, Azure AD / Entra ID, or any SAML 2.0 IdP with signed assertions |
| **Admin setup** | **Settings → Single sign-on** — copy SP values, paste IdP config, **Test sign-in**, then **Require SSO** |
| **Sign-in surfaces** | Admin portal (**Continue with SSO**) and extension (**Sign in with SSO** with browser handoff) |
| **Policy** | Optional **Require SSO** to block password and Google sign-in; org API keys still work for automation |

Setup guide: [SAML SSO](/docs/saml-sso). Troubleshooting: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

See also [Enterprise deployment](/docs/enterprise-deployment) and [Security architecture](/docs/security-architecture).

## Billing management

**Admin portal → Billing** (Pro):

- View invoices and payment method via Stripe customer portal
- Add or remove seats
- Upgrade plan

## Usage limits

Pro plans include usage analytics in the admin portal. Free plans show a rolling 5-hour AI credit meter. Contact support if you approach credit limits — upgrade paths are available.

## Next steps

- [Getting started](/docs/getting-started)
- [Admin portal](/docs/admin-portal)
- [Enterprise deployment](/docs/enterprise-deployment)
