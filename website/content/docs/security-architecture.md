---
title: Security architecture
description: Zero-clone indexing, credential storage, and data handling.
section: enterprise
order: 1
lastUpdated: "2026-07-15"
---

CoopAI is built for teams that cannot send full repo clones to third-party AI services.

## Zero-clone architecture

Repository **metadata**, ownership graphs, and dependency signals are built from webhooks and background index jobs — not full monorepo copies on every developer laptop.

Your source code stays on your infrastructure (GitHub, GitLab, self-hosted git).

## What Coop stores

| Data | Stored where | Purpose |
| --- | --- | --- |
| Repo metadata & graph | Coop server (or your self-hosted instance) | Quick actions, search, completions |
| Integration tokens | Encrypted on Coop server | OAuth for Slack, Jira, etc. |
| API keys | Hashed in database | Automation API access (optional) |
| User sessions | Server-side / token | Extension and admin portal sign-in |
| Chat prompts/responses | Session/stream only | Not used for model training |

See the full [Security page](/security) for evaluators.

## Credential encryption

Integration OAuth tokens are encrypted at rest with `CREDENTIALS_ENCRYPTION_KEY` on the API server. LLM provider keys stay **server-side** — never in the VS Code extension in production mode.

## Authentication

- **Email + password** — default sign-in for extension, admin portal, and website; verification link sent on signup (soft verify — login is not blocked until verified)
- **Google OAuth** — same account as signup; requires Google's `email_verified` flag (`email_not_verified` if unverified)
- **SSO (SAML)** — Enterprise orgs; configured in admin portal ([Single Sign On (SSO)](/docs/sso))
- **Automation API keys** — optional Bearer tokens for CI/scripts and direct API calls; not the primary sign-in method
- **Integration OAuth** — per-integration browser consent flows (Slack, GitHub, etc.)

**Require SSO:** when enabled, password and Google sign-in are blocked at login and on `/v1/auth/refresh`. Coop immediately revokes existing password and Google sessions and refresh tokens for the org; SAML sessions remain valid. Org API keys still bypass `requireSso`.

**Auth rate limiting:** login, register, forgot-password, and reset-password — ~20 attempts per 15 minutes per IP+email.

**Post-login redirects:** session tokens in redirect URLs only go to Coop surfaces (admin portal, marketing site, `vscode:` / `vscode-insiders:`) — not arbitrary `https://` hosts.

### SAML SSO sessions

Enterprise SAML sign-in issues a Coop session token with these properties:

| Property | Behavior |
| --- | --- |
| **TTL** | Default **12 hours** (`COOP_SSO_SESSION_TTL_MS`; falls back to user session default) |
| **Refresh** | **None** — when the session expires, users re-authenticate through their IdP |
| **Storage** | Session token hashed server-side; raw token only returned once at sign-in |
| **Provider tag** | Sessions created via SAML are tagged `authProvider: saml` for audit |

### Shared service provider

Coop runs a **single SAML service provider** for all Enterprise tenants:

- One **Entity ID** and **ACS URL** per Coop deployment (hosted or self-hosted)
- Tenant org is resolved from **RelayState** on callback (base64url JSON with `orgId`)
- Each customer IdP application points at the same SP values — org isolation is enforced after assertion validation, not via per-tenant SP URLs

Self-hosted operators set `COOP_PUBLIC_BASE_URL` (and optionally `COOP_SSO_SP_ENTITY_ID`) on the API server.

### SAML audit events

| Action | When |
| --- | --- |
| `auth.saml.login` | Successful SAML assertion → session issued (includes `idpProvider`, `email`) |
| `auth.user.deactivate` | `POST /v1/auth/saml/offboard` by `userId` or `idpSubject` |
| `auth.user.reconcile_offboarding` | Offboard with `activeSubjects` (SCIM-style sync) |

View audit history in the admin portal **Audit log** (org admins).

### SAML known limits

| Limit | Impact |
| --- | --- |
| **No assertion replay cache** | `InResponseTo` replay protection is disabled on multi-instance backends without a shared cache. Signature, audience, and timestamp checks still apply. |
| **API key bypass under `requireSso`** | `requireSso` blocks password and Google interactive sign-in and refresh only. Valid org API keys still authenticate `/v1/chat` and other automation endpoints — revoke keys for offboarded users. |
| **Require SSO session revocation** | Enabling **Require SSO** (or disabling password/Google) immediately revokes non-SAML sessions and refresh tokens; existing SAML sessions stay valid. |
| **JIT provisioning** | First SAML login creates a **member** user; admins must promote roles manually or pre-provision accounts. |
| **No SCIM** | No IdP-driven user provisioning sync — offboard via admin **Users** or `POST /v1/auth/saml/offboard` |
| **SP-initiated only** | Login must start from Coop (`/v1/auth/saml/start` or admin **Test connection**) so RelayState carries the org id. |
| **IdP cert storage** | X.509 signing certificates are stored in plaintext in `org_sso_config` (unlike encrypted OAuth integration tokens) |

Troubleshooting: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

## Network boundaries

- Extension → Coop API (`https://api.coop-ai.dev` or self-hosted)
- Coop API → LLM providers (with zero-retention headers where configured)
- Coop API → GitHub/Slack/Jira/etc. (OAuth-scoped)

## Compliance

Enterprise plans include:

- Data Processing Agreement (DPA)
- Zero-retention attestation for confidential code paths
- Audit logs for admin actions
- BYOK option to route inference through your provider accounts

## No model training

Your code and prompts are **never** used to train foundation models. Coop routes requests to provider APIs with appropriate retention flags.

## Next steps

- [Single Sign On (SSO)](/docs/sso) — IdP setup and sign-in policy
- [Zero-retention LLM routing](/docs/zero-retention)
- [Enterprise deployment](/docs/enterprise-deployment)
- [Security page](/security) — full architecture for security reviewers
