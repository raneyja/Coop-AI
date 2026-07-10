# SSO smoke test

**Updated:** July 9, 2026

Operator checklist to validate Enterprise SAML SSO on a local or staging deployment before customer onboarding.

**Prerequisites**

| Requirement | Notes |
| --- | --- |
| API + Postgres | `docker compose up -d --build api postgres` |
| `CREDENTIALS_ENCRYPTION_KEY` | Set in `.env.backend` — required for SSO config storage |
| `COOP_PUBLIC_BASE_URL` | **Operator-only** — public HTTPS base of the Coop API (e.g. `http://localhost:8787` local, `https://api.coop-ai.dev` hosted). SAML SP URLs and OAuth callbacks derive from this; org admins do not set it. |
| Admin portal (optional) | `cd admin && npm run dev` → `http://localhost:3001`; `admin/.env.local` with `COOP_API_BASE=http://localhost:8787` |

Full IdP setup: [Single Sign On (SSO)](/docs/sso). Error codes: [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

---

## One-command automated smoke

**Terminal** (repo root):

```bash
npm run smoke:sso
```

Runs `build:admin`, seeds the demo org inside Docker, and verifies password login + SAML start redirect.

**Expected output:**

```
=== health ===
ok
=== seed enterprise SSO demo ===
{
  "orgName": "SSO Smoke Demo",
  "accounts": { "admin": { "email": "sso-smoke-admin@demo.local", ... } },
  "smokeTest": { "ssoStartUrl": "http://localhost:8787/v1/auth/saml/start?org=..." }
}
=== password login (admin) ===
ok token=coop_sess_...
=== GET /v1/sso/config (enterprise) ===
ok configured saml enabled=true
=== SAML start returns mocksaml redirect ===
ok redirect -> mocksaml.com

=== Demo credentials ===
  Org:      SSO Smoke Demo
  Admin:    sso-smoke-admin@demo.local / DemoPassword12!
  Portal:   http://localhost:3001/login
  SSO test: open smokeTest.ssoStartUrl from seed JSON in a browser
  IdP:      https://mocksaml.com (click through test login — no account needed)
```

Seed JSON is also written to `/tmp/coop-sso-smoke-demo.json`.

Equivalent script: `./scripts/smoke-sso.sh`

**Unit tests:** `npm run test:sso` (included in `npm test`) — 24 SAML/SSO tests covering config API, policy, assertion validation, and callback delivery.

---

## Seed only (manual UI testing)

**Terminal** (repo root):

```bash
npm run seed:enterprise-sso-demo
```

Creates org **SSO Smoke Demo** (Enterprise) with [mocksaml.com](https://mocksaml.com) IdP pre-configured.

| Account | Email | Password |
| --- | --- | --- |
| Admin | `sso-smoke-admin@demo.local` | `DemoPassword12!` (or `DEMO_PASSWORD` env) |
| Member | `sso-smoke-member@demo.local` | same |

**Key seed JSON fields:**

| Field | Purpose |
| --- | --- |
| `smokeTest.ssoStartUrl` | Open in browser to start SP-initiated login |
| `smokeTest.adminPortalLogin` | Admin portal login page |
| `sso.idpSsoUrl` | `https://mocksaml.com/api/saml/sso` |

Override defaults:

```bash
COOP_API_BASE=http://localhost:8787 \
COOP_ADMIN_PORTAL_URL=http://localhost:3001 \
DEMO_PASSWORD='YourTestPassword1!' \
npm run smoke:sso
```

---

## mocksaml.com browser flow

### SP-initiated login (API URL)

1. **Terminal** — Run `npm run seed:enterprise-sso-demo` and copy `smokeTest.ssoStartUrl` from the JSON output.
2. **Browser** — Paste the URL. Coop redirects to **mocksaml.com**.
3. **Browser** — On MockSAML, click through the test login (no account required). Use any email (e.g. `test@example.com`).
4. **Browser** — Coop validates the assertion, issues a session, and redirects to the admin portal callback (`/auth/callback`).
5. **Success:** Admin portal loads signed in; audit log shows `auth.saml.login`.

### Admin portal self-serve UI

1. **Browser** — Sign in at `http://localhost:3001/login` as `sso-smoke-admin@demo.local` / `DemoPassword12!`.
2. **Browser** — Open **Settings** (sidebar) → **Single sign-on** (`/settings/single-sign-on`).
3. **Success:** IdP fields pre-filled from seed; SP values (Entity ID, ACS URL) visible; **Test sign-in** redirects to mocksaml.com.
4. **Browser** — Enable **Require SSO** only after **Test sign-in** succeeds. To disable SAML later, turn off **Require SSO** first — otherwise **Save SSO** returns `sso_required_active`.

### Extension handoff

**Extension UI:** **Settings → Account** → enter org name **SSO Smoke Demo** → **Sign in with SSO** (opens system browser; VS Code completes on return).

---

## API checks (curl)

```bash
# Health
curl -s http://localhost:8787/health | jq .ok

# SAML start (JSON) — expect mocksaml.com URL
curl -s "http://localhost:8787/v1/auth/saml/start?org=SSO%20Smoke%20Demo&format=json" | jq -r .redirectUrl

# SSO config (org admin bearer only — members get 403 admin_required)
TOKEN="$(curl -s -X POST http://localhost:8787/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"sso-smoke-admin@demo.local","password":"DemoPassword12!"}' \
  | jq -r .accessToken)"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/sso/config | jq .configured
```

---

## Support-led configure-sso (production IdP)

When the customer IdP is not mocksaml, use the CLI after collecting IdP metadata:

```bash
DATABASE_URL=postgres://coop:coop@postgres:5432/coopai \
  npx ts-node scripts/admin-org.ts configure-sso <orgId> okta <idpEntityId> <idpSsoUrl> <certPath>
```

Replace `okta` with `azuread` or `saml` as needed.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `missing_org` on start | Pass org name `SSO Smoke Demo` or re-run seed |
| `sso_not_configured` | Re-run seed; confirm SSO row in DB |
| `/v1/sso/config` empty or `not_found` | Rebuild API: `docker compose up -d --build api` |
| Redirect URL not mocksaml | Check operator `COOP_PUBLIC_BASE_URL` matches API host |
| SP URLs empty in admin UI | Operator sets `COOP_PUBLIC_BASE_URL` in `.env.backend` and restarts API |
| `sso_required_active` on save | Turn off **Require SSO** in **Settings → Single sign-on** before disabling SAML |
| `admin_required` on `/v1/sso/config` | Use org admin session or API key — members cannot read IdP config |
| `saml_validation_failed` | IdP cert, Entity ID, or ACS URL mismatch — [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting) |
