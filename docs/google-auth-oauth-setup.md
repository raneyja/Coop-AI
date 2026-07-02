# Google OAuth — user sign-in

Coop uses Google OAuth for **human sign-in** (admin portal, website, VS Code extension). This is separate from **Google Docs integration** OAuth (`GOOGLE_DOCS_APP_*`), though you may reuse the same OAuth client if you register all redirect URIs below.

## Google Cloud Console setup

1. **Browser** → [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **Credentials**
2. **Create credentials** → **OAuth client ID** → Application type: **Web application**
3. Name: `Coop AI User Sign-in` (or reuse an existing web client)

### Authorized redirect URIs (required)

Add **exactly** these redirect URIs in Google Cloud Console. Google must match the URI byte-for-byte.

| Environment | Redirect URI | Used by |
|-------------|--------------|---------|
| **Production admin** | `https://admin.coop-ai.dev/api/auth/google/callback` | Admin portal sign-in |
| **Production API** | `https://api.coop-ai.dev/v1/auth/google/callback` | VS Code extension |
| **Local admin** | `http://localhost:3001/api/auth/google/callback` | Admin portal dev |
| **Local API** | `http://localhost:8787/v1/auth/google/callback` | Extension dev |

The admin portal uses its own callback (`/api/auth/google/callback`) so you do not need the API port when testing sign-in in the browser at `:3001`.

Do **not** put `/auth/callback` here — that is where Coop sends you **after** the OAuth code exchange, with session tokens in the URL hash.

### Authorized JavaScript origins (optional)

Only needed if you call Google APIs directly from the browser (Coop does not). Leave empty unless Google requires it.

### OAuth consent screen

- User type: **External** (or Internal for Workspace-only testing)
- Scopes: Coop requests `openid`, `email`, `profile` only
- Add test users while app is in **Testing** mode

4. Copy **Client ID** and **Client secret** into Railway / `.env.backend`:

```bash
GOOGLE_AUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_AUTH_CLIENT_SECRET=GOCSPX-...
COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev
```

If `GOOGLE_AUTH_*` is unset, the API falls back to `GOOGLE_DOCS_APP_CLIENT_ID` / `GOOGLE_DOCS_APP_CLIENT_SECRET`.

## Production (Railway)

**File:** Railway → Coop API service → **Variables**

| Variable | Value |
|----------|--------|
| `GOOGLE_AUTH_CLIENT_ID` | From Google Console |
| `GOOGLE_AUTH_CLIENT_SECRET` | From Google Console |
| `COOP_PUBLIC_BASE_URL` | `https://api.coop-ai.dev` |
| `COOP_CORS_ORIGINS` | `https://admin.coop-ai.dev,https://coop-ai.dev` |
| `COOP_ADMIN_PORTAL_URL` | `https://admin.coop-ai.dev` |

Redeploy the API after saving variables.

## Local dev

**File:** `.env.backend` (repo root)

```bash
GOOGLE_AUTH_CLIENT_ID=...
GOOGLE_AUTH_CLIENT_SECRET=...
COOP_PUBLIC_BASE_URL=http://localhost:8787
WEBHOOK_DOMAIN=http://localhost:8787
COOP_ADMIN_PORTAL_URL=http://localhost:3001
COOP_CORS_ORIGINS=http://localhost:3001
```

**Terminal** — restart API after editing:

```bash
npm run migrate
npm run build:backend && npm run start
```

## Test sign-in

1. **Browser** → `http://localhost:3001/login` (admin) or `http://localhost:3001/login` (website on :3001)
2. Click **Continue with Google**
3. Approve in Google → redirected to `/auth/callback` → signed in

**Extension:** Settings → Account → **Continue with Google** → browser → return to VS Code.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Add `http://localhost:3001/api/auth/google/callback` (admin dev) or production admin/API URIs from the table above |
| `google_auth_unavailable` | Set `GOOGLE_AUTH_*` or `GOOGLE_DOCS_APP_*` on the API; restart |
| `google_exchange_failed` | Client secret wrong, or callback URI in token exchange doesn't match registered URI |
| Consent screen blocked | Add your Google account as a **Test user** while app is in Testing |
| 503 on `/v1/auth/google/start` | API not running or DB migration `020_auth_identities` not applied |
