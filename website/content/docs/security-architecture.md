---
title: Security architecture
description: Zero-clone indexing, credential storage, and data handling.
section: enterprise
order: 1
lastUpdated: "2026-07-06"
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

- **Email + password** — default sign-in for extension, admin portal, and website
- **Google OAuth** — same account as signup
- **SSO (SAML)** — Enterprise orgs; configured in admin portal
- **Automation API keys** — optional Bearer tokens for CI/scripts and direct API calls; not the primary sign-in method
- **Integration OAuth** — per-integration browser consent flows (Slack, GitHub, etc.)

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

- [Zero-retention LLM routing](/docs/zero-retention)
- [Enterprise deployment](/docs/enterprise-deployment)
- [Security page](/security) — full architecture for security reviewers
