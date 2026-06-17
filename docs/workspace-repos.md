# Workspace repos (Pro / Enterprise)

Each developer picks up to **3 repos** from the org's indexed catalog. This is separate from org-wide Deep-Code Graph indexing.

## Two layers

| Layer | Who | Storage | Purpose |
|-------|-----|---------|---------|
| **Org catalog** | Admin at onboarding | `org_repos` | Index repos from **every connected code host** (GitHub, GitLab, Bitbucket) |
| **User workspace** | Each developer | `user_workspace_repos` | Repos this person works in for chat, @-search, folder picker |

## Code host catalog sync (Layer 1)

When an org admin connects a code host in the admin portal, Coop queues Deep-Code Graph indexing for all repositories that host exposes:

| Code host | Trigger | Discovery |
|-----------|---------|-----------|
| **GitHub** | OAuth callback or GitHub App install | User repos + installation catalog |
| **GitLab** | OAuth callback | Projects with membership |
| **Bitbucket** | OAuth callback | Repositories where user is a member |

Indexing is **org-wide and uncapped** — the per-user **3-repo limit** applies only to workspace selection (Layer 2).

## API

- `GET /v1/me/workspace-repos` — current user's selections + `selectedCount`, `limit` (3 on Pro/Enterprise)
- `PUT /v1/me/workspace-repos` — body `{ "repoIds": ["github:owner/repo", ...] }` (max 3 per user)
- `GET /v1/orgs/catalog/repos` — indexed org catalog across all connected code hosts (workspace picker source)
- `GET /v1/orgs/github/repos` — live GitHub discovery + index status (admin tooling)

## Extension UX

1. **Settings → Workspace → Choose workspace repos** — multi-select modal with **N / 3 selected** at the top
2. **Chat folder icon** — lists only the user's workspace repos, then files inside each repo
3. **Search scope → Workspace repos** — Coop-Search limited to the user's 3 repos

## Onboarding flow

1. Admin connects **GitHub, GitLab, and/or Bitbucket** in the admin portal (Integrations)
2. Each connect triggers **catalog sync** — all accessible repos on that host are queued for indexing
3. Developer signs in with API key → opens workspace picker → selects up to 3 indexed repos (any host)
4. First selected repo becomes the primary workspace (Trace Decision default)

## Migration

Apply `migrations/016_user_workspace_repos.sql` before deploying API changes.
