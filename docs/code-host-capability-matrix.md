# Code host capability matrix

**Purpose:** Honest production parity across GitHub, GitLab, and Bitbucket.  
**Rule:** Product paths call the **connected** code host via `CodeHostClient` / org token resolver — not GitHub-by-default.

| Capability | GitHub | GitLab | Bitbucket | Notes |
|---|---|---|---|---|
| Admin Connect (OAuth/App) | Yes | Yes (env required) | Yes (env required) | Needs `GITLAB_APP_*` / `BITBUCKET_APP_*` on API |
| Disconnect clears refresh secret | Yes | Yes | Yes | |
| Catalog / org repo list | Yes | Yes | Yes | `GET /v1/orgs/{provider}/repos` |
| Default branch live lookup | Yes | Yes | Yes | |
| Deep-Index clone + SCIP/Zoekt | Yes | Yes | Yes | SaaS hosts; self-hosted GitLab via `GITLAB_BASE_URL` |
| On-demand file / tree / blame | Yes | Yes | Yes | |
| Host code search | Yes | Yes | Yes | Bitbucket Cloud search API |
| Trace Decision / PR-for-commit | Yes | Yes | Yes | Bitbucket scans recent PRs (no native commit→PR API) |
| PR/MR detail + files + reviews | Yes | Yes | Yes | |
| CODEOWNERS ownership | Yes | Yes | Yes | |
| Host teams API | Yes (GitHub Teams) | No | No | Intentional — CODEOWNERS only on GL/BB |
| Inbound webhooks | Yes | Yes | Yes | `POST /webhooks/{provider}` |
| Remote open without clone (VFS) | Yes | **No** | **No** | GitHub RemoteHub only — clone/index for GL/BB |
| GitHub App estate sync | Yes | N/A | N/A | App-install model is GitHub-specific |
| Create branch + PR from file contents | Yes | **Not yet** | **Not yet** | Wave 2 C; confirm required; Zero-Clone API writes |

## Operator env (Connect unlock)

| Host | Required env |
|---|---|
| GitLab | `GITLAB_APP_ID`, `GITLAB_APP_SECRET` (+ optional `GITLAB_BASE_URL`) |
| Bitbucket | `BITBUCKET_APP_ID`, `BITBUCKET_APP_SECRET` |
| Bitbucket webhooks (optional) | `BITBUCKET_WEBHOOK_SECRET` |

Callbacks: `{WEBHOOK_DOMAIN}/v1/{provider}/app/callback`

## Exit criteria reference

Phases 0–4 exit criteria live in the multi-host parity project plan. Do not claim full GitHub parity for RemoteHub or App estate sync.
