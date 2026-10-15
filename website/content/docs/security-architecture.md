---
title: Security architecture
description: Zero-clone indexing, credential storage, and data handling.
section: enterprise
order: 1
lastUpdated: "2026-10-12"
---

CoopAI uses remote repository intelligence, server-side indexing and configured model-provider APIs. Review the data flow and deployment controls before processing confidential repositories.

## Zero-clone architecture

Repository **metadata**, ownership graphs, and dependency signals are built from webhooks and background index jobs — not full monorepo copies on every developer laptop.

Your code host remains the source of repository files. Index jobs read source in a temporary server clone; on-demand file reads and source excerpts can reach Coop and the selected model provider. Durable indexes can contain source-derived content, including embedding chunk text and searchable shards. Zero-clone does not mean that source never leaves the code host.

## What Coop stores

| Data | Stored where | Purpose |
| --- | --- | --- |
| Repo metadata, graph, symbols, source chunks and indexes | Server PostgreSQL and configured index storage | Quick actions, search, completions |
| Integration tokens | Encrypted on Coop server | OAuth for Slack, Jira, etc. |
| API keys | Hashed in database | Automation API access (optional) |
| User sessions | Server-side / token | Extension and admin portal sign-in |
| Chat prompts/responses and metadata | VS Code workspace conversation history; PostgreSQL Chat Feed when synced; inference requests | Conversation history and answers. This is durable storage, not session-only processing. |

Chat Feed stores message content, previews and metadata. The current API has no automatic chat expiry or server-side thread-delete endpoint. Clearing a local conversation is not a guarantee that synced server history or backups are erased. Support reports and audit/usage records also persist; support diagnostics have a separate seven-day expiry and cleanup path. Deployment operators must qualify retention, erasure and backup handling before making a contractual commitment.

See the full [Security page](/security) for evaluators.

## Credential encryption

Integration OAuth tokens are encrypted at rest with `CREDENTIALS_ENCRYPTION_KEY` on the API server. LLM provider keys stay **server-side** — never in the VS Code extension in production mode.

## Authentication

- **Email + password** — default sign-in for extension, admin portal, and website; verification link sent on signup (soft verify — login is not blocked until verified)
- **Google OAuth** — same account as signup; requires Google's `email_verified` flag (`email_not_verified` if unverified)
- **SSO (SAML)** — Enterprise orgs; configured in admin portal ([Single Sign On (SSO)](/docs/sso))
- **Automation API keys** — optional Bearer tokens for CI/scripts and direct API calls; not the primary sign-in method
- **Integration OAuth** — per-integration browser consent flows (Slack, GitHub, etc.)

**Require SSO:** when enabled, password and Google sign-in are blocked at login and on `/v1/auth/refresh`. The policy-update path revokes existing password and Google sessions and refresh tokens for the org. SAML sessions require a matching current SSO configuration. Org API keys still bypass `requireSso`.

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
- **RelayState** is an opaque random token referring to a pending PostgreSQL login record bound to the org, request, configuration, browser, redirect and login/test mode.
- Each customer IdP application points at the same SP values. The signed assertion and pending request are validated before single-use durable admission and user/session effects.

Self-hosted operators set `COOP_PUBLIC_BASE_URL` (and optionally `COOP_SSO_SP_ENTITY_ID`) on the API server.

### SAML audit events

| Action | When |
| --- | --- |
| `auth.saml.login` | Successful SAML assertion → session issued (includes `idpProvider`, `email`) |
| `auth.user.deactivate` | `POST /v1/auth/saml/offboard` by `userId` or `idpSubject` |
| `auth.user.reconcile_offboarding` | Explicit offboarding reconciliation with `activeSubjects` (not a SCIM protocol endpoint) |

View audit history in the admin portal **Audit log** (org admins).

### SAML known limits

| Limit | Impact |
| --- | --- |
| **Shared request state required** | This version uses PostgreSQL pending requests and single-use admission for `InResponseTo`/browser/tenant binding; unsolicited or reused responses are rejected. Signature, issuer, audience and time validation remain required. Qualify the deployed version and actual IdP/browser flow. |
| **API key bypass under `requireSso`** | `requireSso` blocks password and Google interactive sign-in and refresh only. Valid org API keys still authenticate `/v1/chat` and other automation endpoints — revoke keys for offboarded users. |
| **SSO configuration changes** | The **Require SSO** update path revokes non-SAML sessions and refresh tokens. SAML sessions are bound to the current SSO configuration; changes or disabling SSO require fresh sign-in. |
| **JIT provisioning** | First SAML login creates a **member** user; admins must promote roles manually or pre-provision accounts. |
| **No SCIM** | No IdP-driven user provisioning sync — offboard via admin **Users** or `POST /v1/auth/saml/offboard` |
| **SP-initiated only** | Login must start from Coop (`/v1/auth/saml/start` or admin **Test connection**) with a pending browser-bound request. |
| **IdP cert storage** | X.509 signing certificates are stored in plaintext in `org_sso_config` (unlike encrypted OAuth integration tokens) |

Troubleshooting: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

## Network boundaries

- Extension → Coop API (`https://api.coop-ai.dev` or self-hosted)
- Coop API/worker → selected model providers, including source chunks sent for embedding indexing; request controls do not establish provider-account retention terms
- Coop API → GitHub/Slack/Jira/etc. (OAuth-scoped)

## Compliance

Discuss deployment-specific evidence and a Data Processing Agreement (DPA) with the Coop team. Admin audit logging and provider request controls must be qualified for the actual deployment. Automated retention attestations and customer-key routing per organization are not available. A server operator can configure supported provider keys for their own deployment.

## Provider processing and training terms

Chat formatting applies confidentiality instructions and provider-compatible controls. Inline controls vary by endpoint and require separate verification. Verify retention and training settings against the actual provider account and agreement; request flags do not establish a provider-side guarantee.

## Next steps

- [Single Sign On (SSO)](/docs/sso) — IdP setup and sign-in policy
- [LLM request controls and retention](/docs/zero-retention)
- [Enterprise deployment](/docs/enterprise-deployment)
- [Security page](/security) — full architecture for security reviewers
