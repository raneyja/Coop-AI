# Agent guide — Coop AI repo

## Canonical URLs

Use these domains in extension and docs — do **not** use `coopai.dev` (unrelated third-party domain).

| Purpose | URL | Config |
|---------|-----|--------|
| Marketing site | https://coop-ai.dev | `website/src/lib/site.config.ts`, `src/config/siteConfig.ts` |
| Pricing | https://coop-ai.dev/pricing | `PRICING_PAGE_URL` in `src/config/siteConfig.ts` |
| API (backend) | https://api.coopai.dev | `DEFAULT_API_BASE` in `src/chat/types.ts` |

`www.coop-ai.dev` redirects to the apex domain (see `website/vercel.json`).

## VS Code extension webview UI

When adding or changing UI under `src/webview/`, follow the design policy in:

- **Rule:** `.cursor/rules/webview-ui.mdc` (applies when editing webview files)
- **Tokens & components:** `src/webview/globals.css` (`coop-*` classes)

Use existing patterns (`coop-prompt-modal`, `coop-settings-card`, `coop-quick-action-pill`, etc.). Avoid legacy patterns: full-screen black overlays, nested VS Code `inputValidation-*` boxes, inline `vscode-button-*` styles, and duplicate marketing copy in headers + body.

**Reference:** `PromptLibraryModal.tsx`, `SettingsPanel.tsx`, `LightningModePanel.tsx`.

## Other areas

- Marketing site: `website/` (separate Tailwind stack; not shared with the extension webview)
- Backend/docs: `docs/`

## Agent → user instructions

When giving setup, env, or test steps (not code review), follow **`.cursor/rules/user-instructions.mdc`**: always say **which surface** (file path, terminal, extension UI, browser), whether config must be **added vs changed**, and distinguish similar env vars (e.g. `GITHUB_APP_*` vs `GITHUB_OAUTH_*`).

