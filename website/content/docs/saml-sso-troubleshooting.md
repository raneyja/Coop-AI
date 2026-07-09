---
title: SAML SSO troubleshooting
description: Error codes, fixes, and known limits for Enterprise SAML single sign-on.
section: enterprise
order: 4
lastUpdated: "2026-07-09"
---

Use this page when SAML sign-in fails in the admin portal, VS Code extension, or API smoke tests. For initial setup, see [SAML SSO](/docs/saml-sso).

## Error code reference

| Code | HTTP | When it appears | Fix |
| --- | --- | --- | --- |
| `missing_org` | 400 | `GET /v1/auth/saml/start` without `org` or `orgId` | Pass your organization name or org UUID. Name lookup is case-insensitive. |
| `sso_not_configured` | 409 / 403 | SSO start, callback, or enabling **Require SSO** before IdP is saved | Admin portal → **Settings → Single sign-on** → save IdP Entity ID, SSO URL, and signing certificate with **SSO enabled** checked. |
| `plan_required` | 403 | Non-Enterprise org attempts SSO | Upgrade org to **Enterprise**. SSO is not available on Free or Pro. |
| `saml_validation_failed` | 401 | IdP callback after assertion validation fails | Check IdP cert expiry, server clock skew, Entity ID / ACS URL match, and signed assertions (SHA-256). Re-download cert from IdP. |
| `sso_required` | 403 | Password or Google login when org enforces SSO | Use **Sign in with SSO** (admin portal or extension). Existing sessions stay valid until expiry. |
| `sso_unavailable` | 503 | SSO stores not wired on this API deployment | Operator: ensure Postgres migrations applied and API rebuilt with SSO routes enabled. |
| `missing_saml_response` | 400 | IdP POST to callback without `SAMLResponse` | IdP misconfiguration or interrupted redirect — retry from **Test SSO sign-in**. |
| `missing_relay_state` | 400 | Callback without org in RelayState | Use SP-initiated login from Coop (`/v1/auth/saml/start` or admin **Test SSO**), not IdP-initiated flows without RelayState. |
| `sso_login_failed` | 502 | Error building IdP redirect URL | Check `idpSsoUrl` is reachable and valid HTTPS. |
| `invalid_certificate` | 400 | Saving SSO config with bad `idpX509Cert` | Paste PEM (`-----BEGIN CERTIFICATE-----`) or base64 from IdP metadata — not a Coop session token. |
| `admin_required` | 403 | Member calls `PUT /v1/sso/config` or `PUT /v1/sso/policy` | Org **admin** or **owner** must save SSO settings. |
| `unauthorized` | 401 | Missing or expired bearer on protected SSO API | Sign in again; for automation use a valid org API key on Enterprise. |

Browser sign-in surfaces redirect to your `redirect` URL with `?error=<code>&message=…` when `format=json` is not used.

## SP URLs unavailable

If the admin portal **Settings → SSO** panel shows empty Entity ID, ACS URL, or metadata links:

1. **File** — `.env.backend` at repo root: set `COOP_PUBLIC_BASE_URL` to your public API base (e.g. `https://api.coop-ai.dev` or `http://localhost:8787` for local dev).
2. **Terminal** — Restart API after saving: `docker compose up -d --build api`.
3. **Success** — `GET /v1/sso/config` includes an `sp` object with `entityId`, `acsUrl`, `metadataUrl`, and `publicStartUrl`.

Self-hosted deployments must use HTTPS in production so IdPs accept the ACS URL.

## Common IdP issues

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Missing email in assertion | No email attribute mapped | Map `email` / `user.mail` in IdP, or use email-format NameID |
| Cert expired | Rotated IdP signing cert | Re-download cert from IdP; **Save SSO** in admin portal |
| Audience mismatch | Wrong SP Entity ID in IdP | Use Coop **Entity ID** exactly (default: metadata URL) |
| ACS mismatch | Wrong Reply URL | Use Coop **ACS URL**: `{COOP_PUBLIC_BASE_URL}/v1/auth/saml/callback` |
| Clock skew | Server time drift | Sync API host NTP; default tolerance is 5 seconds |

## Known limits

| Limit | Detail |
| --- | --- |
| **No assertion replay cache** | `InResponseTo` replay protection is disabled on multi-instance backends. Signature, audience, and `NotBefore` / `NotOnOrAfter` checks still apply. |
| **API key bypass under `requireSso`** | `requireSso` blocks password and Google **interactive** sign-in only. Org API keys (`coop_…`) still authenticate automation endpoints — rotate or revoke keys for offboarded users. |
| **Shared SP** | One Entity ID and ACS URL for all Enterprise tenants; org resolved via RelayState — each IdP app must use the same SP values. |
| **No session refresh** | SAML sessions expire after TTL (default 12h); users re-authenticate through the IdP — no silent refresh token. |
| **JIT default role** | First SAML login creates a **member** user; promote admins in **Users** or pre-create accounts. |

## Operator smoke test

Local validation with MockSAML: repo `docs/sso-smoke-test.md` — `npm run smoke:sso`.

## Related

- [SAML SSO](/docs/saml-sso) — setup and provider notes
- [API reference — SSO](/docs/api-reference#sso-configuration-enterprise)
- [Security architecture](/docs/security-architecture) — SAML session model and audit events
- [Troubleshooting](/docs/troubleshooting) — extension, admin portal, and integrations
