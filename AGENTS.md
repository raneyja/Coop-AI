# Agent guide — Coop AI repo

## Canonical URLs

All production URLs use the **`coop-ai.dev`** domain (with hyphen).

| Purpose | URL | Config |
|---------|-----|--------|
| Marketing site | https://coop-ai.dev | `website/src/lib/site.config.ts`, `src/config/siteConfig.ts` |
| Pricing | https://coop-ai.dev/pricing | `PRICING_PAGE_URL` in `src/config/siteConfig.ts` |
| API (backend) | https://api.coop-ai.dev | `DEFAULT_API_BASE` in `src/chat/types.ts` |
| Admin portal | https://admin.coop-ai.dev | `admin/src/lib/coopApi.ts`, `COOP_ADMIN_PORTAL_URL` |

`www.coop-ai.dev` redirects to the apex domain (see `website/vercel.json`).

## VS Code extension webview UI

When adding or changing UI under `src/webview/`, follow the design policy in:

- **Rule:** `.cursor/rules/webview-ui.mdc` (applies when editing webview files)
- **Tokens & components:** `src/webview/globals.css` (`coop-*` classes)

Use existing patterns (`coop-prompt-modal`, `coop-settings-card`, `coop-quick-action-pill`, etc.). Avoid legacy patterns: full-screen black overlays, nested VS Code `inputValidation-*` boxes, inline `vscode-button-*` styles, and duplicate marketing copy in headers + body.

**Reference:** `PromptLibraryModal.tsx`, `SettingsPanel.tsx`, `LightningModePanel.tsx`.

## Other areas

- Marketing site: `website/` (separate Tailwind stack; not shared with the extension webview)
- **Marketing site canonical:** production is [https://coop-ai.dev](https://coop-ai.dev) (`main`). Homepage hero = `HeroDemoArtifact.tsx` (light theme, `// question` → `// response`). Legacy dark mock = `FileContextStoryDemo.tsx` — not the live homepage. Local dev: `cd website && npm run dev` → **http://localhost:3001**. See `.cursor/rules/website-canonical.mdc`.
- Backend/docs: `docs/`
- Enterprise integration onboarding: `docs/enterprise-integration-onboarding.md` (operator vs org admin vs developer)
- Production Connect checklist: `docs/connect-integrations-production.md`
- API deploy (Railway): `docs/deploy-railway.md`

## Agent → user instructions

When giving setup, env, or test steps (not code review), follow:

- **`.cursor/rules/user-instructions.mdc`** — which surface (file, terminal, extension UI, browser); add vs change config; similar env vars
- **`.cursor/rules/clear-user-requests.mdc`** — lead with required vs optional; one happy path; where secrets come from; don't bury the ask

