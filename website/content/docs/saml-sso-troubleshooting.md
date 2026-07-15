---
title: SAML SSO troubleshooting
description: Error codes, fixes, and known limits for Enterprise SAML single sign-on.
section: enterprise
order: 4
lastUpdated: "2026-07-15"
---

Use this page when SAML sign-in fails in the admin portal or VS Code extension. For initial setup, see [Single Sign On (SSO)](/docs/sso).

## Error code reference

| Code | HTTP | When it appears | Fix |
| --- | --- | --- | --- |
| `missing_org` | 400 | `GET /v1/auth/saml/start` without `org` or `orgId` | Pass your organization name or org UUID. Name lookup is case-insensitive. |
| `sso_not_configured` | 409 / 403 | SSO start, callback, or enabling **Require SSO** before IdP is saved | Admin portal → **Settings → Single sign-on** → save IdP Entity ID, SSO URL, and signing certificate with **SSO enabled** checked. |
| `plan_required` | 403 | Non-Enterprise org attempts SSO | Upgrade org to **Enterprise**. SSO is not available on Free or Pro. |
| `saml_validation_failed` | 401 | IdP callback after assertion validation fails | Check IdP cert expiry, server clock skew, Entity ID / ACS URL match, and signed assertions (SHA-256). Re-download cert from IdP. |
| `sso_required` | 403 | Password or Google login or refresh when org enforces SSO | Use **Sign in with SSO** (extension) or **Continue with SSO** (admin portal). Existing SAML sessions stay valid; password/Google sessions were revoked when **Require SSO** was enabled. |
| `sso_required_active` | 400 | Disabling SAML or unchecking **Enable SSO** while **Require SSO** is on | Admin portal → **Settings → Single sign-on** → turn off **Require SSO** first, then disable SSO. |
| `sso_unavailable` | 503 | SSO stores not wired on this API deployment | Coop **operator**: ensure Postgres migrations applied and API rebuilt with SSO routes — [Enterprise deployment](/docs/enterprise-deployment#saml-sso-enterprise) |
| `missing_saml_response` | 400 | IdP POST to callback without `SAMLResponse` | IdP misconfiguration or interrupted redirect — retry from **Test connection**. |
| `missing_relay_state` | 400 | Callback without org in RelayState | Use SP-initiated login from Coop (`/v1/auth/saml/start` or admin **Test connection**), not IdP-initiated flows without RelayState. |
| `sso_login_failed` | 502 | Error building IdP redirect URL | Check `idpSsoUrl` is reachable and valid HTTPS. |
| `invalid_certificate` | 400 | Saving SSO config with bad `idpX509Cert` | Paste PEM (`-----BEGIN CERTIFICATE-----`) or base64 from IdP metadata — not a Coop session token. |
| `admin_required` | 403 | Member calls `GET` or `PUT /v1/sso/config`, or `PUT /v1/sso/policy` | Org **admin** or **owner** must read or save SSO settings. |
| `email_not_verified` | 403 | Google sign-in when Google reports the email is unverified | Verify the address in your Google account, then try again. |
| `rate_limited` | 429 | Too many login, register, forgot-password, or reset-password attempts | Wait ~15 minutes (~20 attempts per IP+email), then retry. |
| `unauthorized` | 401 | Missing or expired bearer on protected SSO API | Sign in again; for automation use a valid org API key on Enterprise. |

Browser sign-in surfaces redirect to your `redirect` URL with `?error=<code>&message=…` when `format=json` is not used.

## SP URLs unavailable

If the admin portal **Settings → Single sign-on** panel shows empty Entity ID, ACS URL, or metadata links, your Coop **operator** must fix server configuration — org admins and end users do not set this themselves.

**Org admin:** Reload **Settings → Single sign-on** after your operator confirms the fix. Success looks like populated SP fields and a working **Test connection**.

**Coop operator:** Set the public API base URL on the API server and restart. Full steps (env vars, Docker restart, post-deploy validation): [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise).

Self-hosted deployments must use HTTPS in production so IdPs accept the ACS URL.

## Common IdP issues

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Missing email in assertion | No email attribute mapped | Map `email` / `user.mail` in IdP, or use email-format NameID |
| Cert expired | Rotated IdP signing cert | Re-download cert from IdP; **Save SSO** in admin portal |
| Audience mismatch | Wrong SP Entity ID in IdP | Use Coop **Entity ID** exactly (default: metadata URL) |
| ACS mismatch | Wrong Reply URL | Use the Coop **ACS URL** from admin **Settings → Single sign-on** (hosted: `https://api.coop-ai.dev/v1/auth/saml/callback`) |
| Clock skew | Server time drift | Sync API host NTP; default tolerance is 5 seconds |

## Known limits

| Limit | Detail |
| --- | --- |
| **SP-initiated only** | No IdP-initiated login — start from Coop (`/v1/auth/saml/start`, admin **Test connection**, or extension **Sign in with SSO**) |
| **No SCIM** | No IdP-driven user sync — JIT provisioning on first SAML login; offboard via admin **Users** or offboard API |
| **No assertion replay cache** | `InResponseTo` replay protection is disabled on multi-instance backends. Signature, audience, and `NotBefore` / `NotOnOrAfter` checks still apply. |
| **API key bypass under `requireSso`** | `requireSso` blocks password and Google sign-in and refresh. Org API keys (`coop_…`) still authenticate automation endpoints — rotate or revoke keys for offboarded users. |
| **Shared SP** | One Entity ID and ACS URL for all Enterprise tenants; org resolved via RelayState — each IdP app must use the same SP values. |
| **No session refresh** | SAML sessions expire after TTL (default 12h); users re-authenticate through the IdP — no silent refresh token. |
| **JIT default role** | First SAML login creates a **member** user; promote admins in **Users** or pre-create accounts. |
| **Marketing site has no SSO** | [coop-ai.dev/login](https://coop-ai.dev/login) does not offer SSO — use admin portal or extension only. |
| **IdP cert storage** | X.509 signing certificates are stored in plaintext in `org_sso_config` (unlike encrypted OAuth integration tokens) |

## Related

- [Single Sign On (SSO)](/docs/sso) — setup and provider notes
- [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise) — operator env vars and post-deploy validation
- [API reference — SSO](/docs/api-reference#sso-configuration-enterprise)
- [Security architecture](/docs/security-architecture) — SAML session model and audit events
- [Troubleshooting](/docs/troubleshooting) — extension, admin portal, and integrations
