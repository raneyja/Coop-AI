# Integration scope benchmark

How enterprise SaaS products let admins **narrow third-party data access after OAuth connect**, and what Coop should adopt.

**Audience:** Product, security review, solutions engineering.

**Related:** [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md), [integration-scope-audit.md](./integration-scope-audit.md).

---

## Summary table

| Product | Connect model | Admin scope model (post-connect) | Default posture |
|---------|---------------|--------------------------------|-----------------|
| **Slack** | Workspace OAuth (bot + user scopes) | Enterprise Grid: org-level app install, channel allowlists via IDP groups (`admin.conversations.restrictAccess.*`); workspace apps use OAuth scope bundles | Broad user `search:read` unless Grid admin restricts channels |
| **Microsoft Teams / Graph** | Azure AD app + Teams install | **Resource-specific consent (RSC):** permissions bound to a team, channel, chat, or meeting at install time; tenant admins can pre-approve max RSC via policies | Tenant-wide Graph consent is high blast radius; RSC is default-deny per resource |
| **Notion** | OAuth integration (page/workspace picker at authorize) | User selects pages during OAuth; integration token is limited to granted pages | Default-deny at connect (only selected pages) |
| **Atlassian (Jira / Confluence)** | 3LO OAuth per cloud site | Site + product scopes at authorize; Jira project / Confluence space access follows user's Atlassian permissions (no separate app allowlist UI) | Inherits Atlassian RBAC; app cannot exceed user visibility |
| **Google Workspace (Drive)** | OAuth with `drive.readonly` (or granular scopes) | Admin can constrain via Workspace Marketplace app allowlisting, OU policies, shared-drive membership; folder-level sharing is Google's native ACL | Org policy + Drive ACLs; broad readonly scope is high risk without post-connect filter |
| **GitHub** | GitHub App install (org) or OAuth | **App installation:** admin selects repositories at install; permissions are repo-scoped | Default-deny — only selected repos unless "All repositories" chosen |

---

## Pattern analysis

### 1. Connect-time vs admin-time scoping

| Pattern | Examples | Pros | Cons |
|---------|----------|------|------|
| **Connect-time picker** | Notion pages, GitHub App repos | Simple mental model; token never sees more than picked | Hard to change later without re-auth; doesn't help "search everything then filter" |
| **Admin allowlist after connect** | Coop target, Slack Grid channel policies | OAuth stays stable; admin can tighten/expand without re-consent | Requires enforcement layer in the integrator |
| **Inherited vendor RBAC** | Atlassian, partial Google | No duplicate policy store | Coop cannot offer uniform cross-tool governance |
| **Resource-specific consent** | Teams RSC | Fine-grained, security-friendly | Teams-specific; not portable to Slack/Jira |

### 2. Search-time enforcement

Products with **broad read/search scopes** (Slack `search:read`, Google `drive.readonly`) rely on one of:

- Vendor-side ACLs only (Atlassian, partial Slack)
- **Integrator-side allowlist** applied to every query (recommended for Coop)
- Org-wide admin APIs (Slack Grid `admin.*` — requires Enterprise Grid + org install)

Coop cannot assume customers run Slack Grid org installs. **Post-connect allowlist + search-time filter** matches what security teams expect from a governance layer sitting above OAuth.

---

## Recommended pattern for Coop

**Default-deny allowlist with search-time enforcement**

1. **OAuth connect** — unchanged: org admin connects Slack once; tokens stored encrypted server-side.
2. **Scope configuration (required for Enterprise)** — admin selects allowed Slack channels (Phase B); later Jira projects, Confluence spaces, Notion pages, Drive folders.
3. **Enforcement hook** — single `resolveIntegrationScope(orgId, provider)` called before any vendor search API:
   - Enterprise + connected + **no policy** → return empty context (no global workspace search).
   - Enterprise + policy with allowlist → append channel/project filters to vendor queries; drop hits outside allowlist.
   - Pro / Free (interim) → no scope gate until Phase C parity (documented in audit).
4. **Audit** — `admin.integration.scope.updated` with channel count and actor.
5. **Admin UX** — card states: **Connected** → **Scope required** → **Active**; copy: *"Coop searches only what you select — not your entire workspace."*

This mirrors GitHub App repo selection (default-deny) while fitting Slack's broad search scope.

---

## Security narrative (sales / security review)

- **Principle of least privilege:** OAuth grants minimum vendor scopes; Coop adds a second layer so chat context cannot span the whole Slack workspace by default on Enterprise.
- **Admin-controlled blast radius:** Only org admins configure scope; developers never paste tokens in production.
- **Encrypted credentials:** Tokens remain in Postgres with `CREDENTIALS_ENCRYPTION_KEY`; scope policy is non-secret metadata in `org_integration_policies`.
- **Search-time enforcement:** Even if a token could theoretically search more, Coop queries are constrained to the allowlist before results reach the LLM.
- **Auditability:** Scope changes are logged for SOC2-style access reviews.
- **Revocation path:** Disconnect in admin portal or revoke app in vendor console; scope policy deleted with org.
- **Honest limits:** Slack user `search:read` remains a powerful scope — Coop's value is **governance + enforcement**, not replacing Slack's own Grid policies.

---

## Phased rollout (Coop product)

| Phase | Providers | Deliverable |
|-------|-----------|-------------|
| **A — Foundation** | All integrations | `org_integration_policies` table, GET/PUT scope API, `resolveIntegrationScope`, audit event |
| **B — Slack** | Slack | Channel multi-select, search query `in:channel` enforcement, admin test |
| **C — Atlassian** | Jira + Confluence | Project / space allowlists, JQL/CQL filters |
| **D — Docs** | Notion, Google Docs | Page / folder allowlists |
| **E — Code hosts** | GitHub (already repo-scoped via App install) | Align UX messaging; optional collection tie-in |

**Order rationale:** Slack has the widest search blast radius (`search:read`) and highest customer demand for Trace Decision / Knowledge Gaps. Jira/Confluence inherit Atlassian RBAC but still benefit from explicit project/space allowlists for cross-repo estate search. Notion is partially scoped at OAuth. Google Drive readonly is restricted-scope and needs careful folder governance.

---

## References

- [Slack admin.conversations.restrictAccess.addGroup](https://docs.slack.dev/reference/methods/admin.conversations.restrictAccess.addGroup)
- [Slack admin scopes (org install)](https://docs.slack.dev/reference/scopes/admin.conversations.write)
- [Microsoft Teams resource-specific consent](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/rsc/resource-specific-consent)
- [GitHub App permissions and repository selection](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
- [Notion OAuth authorization](https://developers.notion.com/docs/authorization)
- [Atlassian 3LO scopes](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/)
- [Google Drive API scopes](https://developers.google.com/drive/api/guides/api-specific-auth)
