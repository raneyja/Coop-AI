---
title: SAML SSO
description: Configure SAML 2.0 single sign-on for Enterprise organizations.
section: enterprise
order: 2
lastUpdated: "2026-07-09"
---

Enterprise organizations can sign in with SAML 2.0 through Okta, Azure AD / Entra ID, or any standards-compliant identity provider.

## On this page

- [Who can configure SSO](#who-can-configure-sso)
- [Sign-in surfaces](#sign-in-surfaces)
- [Service provider (Coop) values](#service-provider-coop-values) — share with your IdP admin
- [IdP requirements](#idp-requirements)
- [Configure in admin portal](#configure-in-admin-portal)
- [IdP setup guides](#provider-specific-notes) — [Okta](#okta) · [Azure AD / Entra ID](#azure-ad-entra-id) · [Generic SAML](#generic-saml)
- [Enforce SSO-only sign-in](#enforce-sso-only-sign-in)
- [User lifecycle](#user-lifecycle)
- [Troubleshooting](#troubleshooting)

## Who can configure SSO

| Role | Access |
| --- | --- |
| **Org admin / owner** | Admin portal → **Settings** → **Single sign-on** (`/settings/single-sign-on`) |
| **Coop operator** | `scripts/admin-org.ts configure-sso` (support-led onboarding) |

SSO is available on the **Enterprise** plan only.

## Sign-in surfaces

| Surface | Path |
| --- | --- |
| **Admin portal** | Login → enter **Organization name** → **Continue with SSO** (inline on the login page) |
| **VS Code extension** | **Settings → Account** → enter **Organization name** → **Sign in with SSO** |

After a successful SAML assertion, Coop issues a session token and redirects back to the admin portal or extension. Extension sign-in opens your system browser; VS Code completes automatically when you return.

## Service provider (Coop) values

Your IdP admin needs these values when creating the SAML application. In the admin portal, open **Settings → Single sign-on** — the panel lists them and offers **Download metadata**.

| Field | Example (hosted Coop) |
| --- | --- |
| **Entity ID** | `https://api.coop-ai.dev/v1/auth/saml/metadata` |
| **ACS URL** | `https://api.coop-ai.dev/v1/auth/saml/callback` |
| **Metadata URL** | `https://api.coop-ai.dev/v1/auth/saml/metadata` (requires signed-in Enterprise admin) |

Self-hosted deployments use your API hostname instead of `api.coop-ai.dev`. Set `COOP_PUBLIC_BASE_URL` on the API server — SAML callbacks depend on it.

## IdP requirements

- **SAML 2.0** with **signed assertions** (SHA-256)
- **Email attribute** in the assertion, or an email-format **NameID**
- **SP-initiated** login (Coop redirects users to your IdP)

Coop uses a single service provider for all Enterprise tenants. Your org is resolved from RelayState at callback time.

## Configure in admin portal

1. Sign in to the [admin portal](https://admin.coop-ai.dev) as an org admin on an Enterprise plan.
2. Open **Settings → Single sign-on** (`/settings/single-sign-on`).
3. Choose your provider (**Okta**, **Azure AD / Entra ID**, or **Generic SAML**).
4. Paste your IdP **Entity ID**, **SSO URL**, and **X.509 signing certificate**.
5. Click **Save SSO**, then **Test sign-in**.
6. After a successful test, enable **Require SSO** if you want to block password and Google sign-in.

## Provider-specific notes

### Okta

1. Create a **SAML 2.0** application.
2. Set **Single sign-on URL** to the Coop **ACS URL**.
3. Set **Audience URI (SP Entity ID)** to the Coop **Entity ID**.
4. Under **Attribute Statements**, map `email` → `user.email` (or use email as NameID).
5. Copy the IdP metadata: **Entity ID**, **SSO URL**, and **Signing certificate**.

### Azure AD / Entra ID

1. Create an **Enterprise application** → **Create your own application** → **Integrate any other application (non-gallery)**.
2. Under **Single sign-on**, choose **SAML**.
3. Set **Identifier (Entity ID)** and **Reply URL (ACS)** to Coop SP values.
4. Edit **Attributes & Claims** — ensure `email` or `user.mail` is sent.
5. Download the **Certificate (Base64)** and copy **Login URL** and **Azure AD Identifier**.

### Generic SAML

Use the same SP values. Any IdP that signs assertions and sends a usable email claim works.

## Enforce SSO-only sign-in

In **Settings → Single sign-on → Sign-in policy**, enable **Require SSO**.

When enabled:

- Email/password and Google sign-in return `sso_required` for your org
- Existing password sessions remain valid until they expire or the user signs out

Test SSO with at least one admin account before enforcing.

## User lifecycle

| Event | Behavior |
| --- | --- |
| **First SAML login** | Coop creates a user (JIT provisioning) with role **member** |
| **Returning SAML login** | Matched by IdP subject or email within the org |
| **Offboarding** | Deactivate via admin **Users** page, or automation API `POST /v1/auth/saml/offboard` |

Invite links still work for orgs that allow password sign-in. SSO-only orgs should provision users through the IdP.

## API reference

Admin and automation endpoints are documented in [API reference — SSO](/docs/api-reference#sso-configuration-enterprise).

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/sso/config` | GET | Read IdP config and SP details |
| `/v1/sso/config` | PUT | Save IdP config (org admin) |
| `/v1/sso/policy` | GET | Read sign-in policy |
| `/v1/sso/policy` | PUT | Update `requireSso`, `allowPassword`, `allowGoogle` |
| `/v1/auth/saml/start?org={name}` | GET | Public SSO entry (extension + admin) |
| `/v1/auth/saml/callback` | POST | IdP assertion callback (browser POST) |
| `/v1/auth/saml/metadata` | GET | SP metadata XML (Enterprise bearer) |
| `/v1/auth/saml/offboard` | POST | Deactivate users by IdP subject |

## Troubleshooting

See [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting) for the full error code table, SP URL fixes, and known limits.

Quick reference:

| Error | Fix |
| --- | --- |
| `sso_not_configured` | Save SSO in admin **Settings** and ensure **SSO enabled** is checked |
| `sso_required` | Use SSO sign-in — extension: **Sign in with SSO**; admin portal: **Continue with SSO** |
| `saml_validation_failed` | Check IdP cert expiry, clock skew, Entity ID / ACS URL mismatch |
| `missing_org` | Enter your organization name before starting SSO |
| Missing email in assertion | Map `email` attribute in IdP; NameID must be email if no attribute |
| SSO URLs unavailable | Set `COOP_PUBLIC_BASE_URL` on the API server and restart |

Operator smoke test: repo `docs/sso-smoke-test.md` (`npm run smoke:sso`).

## Security notes

- Session tokens are hashed server-side; SAML assertions are validated with your IdP signing certificate
- SSO sessions default to **12 hours** (`COOP_SSO_SESSION_TTL_MS`); re-authenticate through your IdP when expired — no refresh token
- Audit events: `auth.saml.login` recorded for each successful SSO sign-in

Details: [Security architecture — SAML](/docs/security-architecture#saml-sso-sessions).

## Next steps

- [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting) — error codes and known limits
- [Security architecture](/docs/security-architecture) — data handling and compliance
- [Admin portal](/docs/admin-portal) — user management and audit log
- [Enterprise deployment](/docs/enterprise-deployment) — self-hosted env vars
