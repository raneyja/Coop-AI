---
title: Single Sign On (SSO)
description: Configure single sign-on for Enterprise organizations with SAML 2.0.
section: enterprise
order: 2
lastUpdated: "2026-07-10"
---

Enterprise organizations can sign in with SAML 2.0 through Okta, Azure AD / Entra ID, or any standards-compliant identity provider.

<!-- figures -->
![Admin portal sign-in — enter organization name and Continue with SSO](/screenshots/docs/admin-login-sso.png)
<!-- /figures -->

**Who this page is for:** **Org admins and IT** configure SAML in the [admin portal](https://admin.coop-ai.dev). **End users** sign in through the admin portal or VS Code extension. **Coop operators** (hosted support or self-hosted deployers) manage server-side settings — see [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise).

## On this page

- [Who can configure SSO](#who-can-configure-sso)
- [Sign-in surfaces](#sign-in-surfaces)
- [Service provider (Coop) values](#service-provider-coop-values) — share with your IdP admin
- [IdP requirements](#idp-requirements)
- [Configure in admin portal](#configure-in-admin-portal)
- [IdP setup guides](#provider-specific-notes) — [Okta](#okta) · [Azure AD / Entra ID](#azure-ad-entra-id) · [Generic SAML](#generic-saml)
- [Enforce SSO-only sign-in](#enforce-sso-only-sign-in)
- [Known limits](#known-limits)
- [User lifecycle](#user-lifecycle)
- [Troubleshooting](#troubleshooting)

## Who can configure SSO

| Role | Access |
| --- | --- |
| **Org admin / owner** | [Admin portal](https://admin.coop-ai.dev) → **Settings** → **Single sign-on** (`/settings/single-sign-on`) |
| **Coop operator** | Server env vars and post-deploy validation — [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise) (support-led onboarding available) |

SSO is available on the **Enterprise** plan only.

## Sign-in surfaces

| Surface | Path |
| --- | --- |
| **Admin portal** | [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login) → enter **Organization name** → **Continue with SSO** (inline on the login page) |
| **VS Code extension** | **Settings → Account** → enter **Organization name** → **Sign in with SSO** → browser handoff |

After a successful SAML assertion, Coop issues a session token and redirects back to the admin portal or extension. Extension sign-in opens your system browser; VS Code completes automatically when you return.

**Not supported:** [coop-ai.dev/login](https://coop-ai.dev/login) (marketing site signup) does **not** offer SSO — only the admin portal and extension do.

## Service provider (Coop) values

Your IdP admin needs these values when creating the SAML application. In the admin portal, open **Settings → Single sign-on** — the panel lists them and offers **Download metadata**.

| Field | Example (hosted Coop) |
| --- | --- |
| **Entity ID** | `https://api.coop-ai.dev/v1/auth/saml/metadata` |
| **ACS URL** | `https://api.coop-ai.dev/v1/auth/saml/callback` |
| **Metadata URL** | `https://api.coop-ai.dev/v1/auth/saml/metadata` (requires signed-in Enterprise admin) |

Hosted Coop uses `api.coop-ai.dev` for all SP values above. Self-hosted deployments use your API hostname instead — your Coop **operator** configures the server; org admins copy the resulting SP values from the admin portal.

## IdP requirements

- **SAML 2.0** with **signed assertions** (SHA-256)
- **Email attribute** in the assertion, or an email-format **NameID**
- **SP-initiated** login (Coop redirects users to your IdP)

Coop uses a single service provider for all Enterprise tenants. Your org is resolved from RelayState at callback time.

## Configure in admin portal

Sign in to the [admin portal](https://admin.coop-ai.dev) as an org admin on an Enterprise plan. Open **Settings** → **Single sign-on** (`/settings/single-sign-on`).

The panel follows three steps:

### 1. Coop service provider

Copy **Entity ID**, **ACS URL**, and **Metadata URL** (or **Download metadata**) into your IdP SAML application.

### 2. Identity provider

Choose your provider (**Okta**, **Azure AD / Entra ID**, or **Generic SAML 2.0**). Paste IdP **Entity ID**, **SSO URL**, and **Signing certificate**. Check **Enable SSO for this organization**, then click **Save SSO**.

### 3. Sign-in policy

Click **Test sign-in** and complete IdP login with an admin account. When SSO works, enable **Require SSO** — a confirmation modal warns that password and Google sign-in will be blocked. You can also toggle **Allow email and password** and **Allow Google** when **Require SSO** is off.

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

In **Settings → Single sign-on → Sign-in policy**, enable **Require SSO** and confirm in the modal.

When enabled:

- Email/password and Google sign-in return `sso_required` for your org
- Existing password sessions remain valid until they expire or the user signs out
- Org API keys (`coop_…`) still authenticate automation endpoints — revoke keys for offboarded users

Use **Test sign-in** with at least one admin account before enabling **Require SSO**.

To disable SAML while **Require SSO** is on, turn off **Require SSO** first — otherwise **Save SSO** returns `sso_required_active`.

<!-- figures sm -->
![Admin portal Settings — open Single sign-on to configure SAML and sign-in policy](/screenshots/docs/admin-settings-sso.png)
<!-- /figures -->

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
| `/v1/sso/config` | GET | Read IdP config and SP details (org admin; org API key allowed) |
| `/v1/sso/config` | PUT | Save IdP config (org admin; org API key allowed) |
| `/v1/sso/policy` | GET | Read sign-in policy (any org member) |
| `/v1/sso/policy` | PUT | Update `requireSso`, `allowPassword`, `allowGoogle` (org admin) |
| `/v1/auth/saml/start?org={name}` | GET | Public SSO entry (extension + admin) |
| `/v1/auth/saml/callback` | POST | IdP assertion callback (browser POST) |
| `/v1/auth/saml/metadata` | GET | SP metadata XML (Enterprise bearer) |
| `/v1/auth/saml/offboard` | POST | Deactivate users by IdP subject |

## Troubleshooting

See [SSO troubleshooting](/docs/saml-sso-troubleshooting) for the full error code table, SP URL fixes, and known limits.

Quick reference:

| Error | Fix |
| --- | --- |
| `sso_not_configured` | Save SSO in admin **Settings** and ensure **Enable SSO for this organization** is checked |
| `sso_required` | Use SSO sign-in — extension: **Sign in with SSO**; admin portal: **Continue with SSO** |
| `sso_required_active` | Turn off **Require SSO** before disabling SAML or unchecking **Enable SSO** |
| `saml_validation_failed` | Check IdP cert expiry, clock skew, Entity ID / ACS URL mismatch |
| `admin_required` | Only org **admin** or **owner** can read or save SSO config via API |
| `missing_org` | Enter your organization name before starting SSO |
| Missing email in assertion | Map `email` attribute in IdP; NameID must be email if no attribute |
| SSO URLs unavailable | Coop **operator**: fix server configuration — [Enterprise deployment — SAML SSO](/docs/enterprise-deployment#saml-sso-enterprise) |

## Known limits

| Limit | Detail |
| --- | --- |
| **SP-initiated only** | Login must start from Coop (admin **Test sign-in**, extension **Sign in with SSO**, or `/v1/auth/saml/start`) — IdP-initiated flows without RelayState fail |
| **No SCIM** | No automated user provisioning sync from IdP — first SAML login JIT-provisions a **member**; offboard via admin **Users** or `POST /v1/auth/saml/offboard` |
| **12-hour sessions, no refresh** | SAML sessions expire after TTL (default 12h); users re-authenticate through the IdP |
| **Shared service provider** | One Entity ID and ACS URL per Coop deployment; org resolved via RelayState |
| **API keys bypass `requireSso`** | Org API keys authenticate automation even when SSO is required — rotate or revoke for offboarded users |
| **No assertion replay cache** | `InResponseTo` replay protection is disabled on multi-instance backends; signature and timestamp checks still apply |

## Security notes

- Session tokens are hashed server-side; SAML assertions are validated with your IdP signing certificate
- SSO sessions default to **12 hours**; re-authenticate through your IdP when expired — no refresh token
- Audit events: `auth.saml.login` recorded for each successful SSO sign-in

Details: [Security architecture — SAML](/docs/security-architecture#saml-sso-sessions).

## Next steps

- [SSO troubleshooting](/docs/saml-sso-troubleshooting) — error codes and known limits
- [Security architecture](/docs/security-architecture) — data handling and compliance
- [Admin portal](/docs/admin-portal) — user management and audit log
- [Enterprise deployment](/docs/enterprise-deployment) — self-hosted env vars
