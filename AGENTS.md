# Agent guide — Coop AI repo

## Canonical URLs

All production URLs use the **`coop-ai.dev`** domain (with hyphen).

| Purpose | URL | Config |
|---------|-----|--------|
| Marketing site | https://coop-ai.dev | `website/src/lib/site.config.ts`, `src/config/siteConfig.ts` |
| Pricing | https://coop-ai.dev/pricing | `PRICING_PAGE_URL` in `src/config/siteConfig.ts` |
| API (backend) | https://api.coop-ai.dev | `DEFAULT_API_BASE` in `src/chat/types.ts` |
| Admin portal | https://admin.coop-ai.dev | `admin/src/lib/coopApi.ts`, `COOP_ADMIN_PORTAL_URL` |
| Ops portal | https://ops.coop-ai.dev | `ops/` Next app; deploy via [docs/deploy-ops-portal.md](docs/deploy-ops-portal.md) |

`www.coop-ai.dev` redirects to the apex domain (see `website/vercel.json`).

## VS Code extension webview UI

When adding or changing UI under `src/webview/`, follow the design policy in:

- **Rule:** `.cursor/rules/webview-ui.mdc` (applies when editing webview files)
- **Tokens & components:** `src/webview/globals.css` (`coop-*` classes)

Use existing patterns (`coop-prompt-modal`, `coop-settings-card`, `coop-quick-action-pill`, etc.). Avoid legacy patterns: full-screen black overlays, nested VS Code `inputValidation-*` boxes, inline `vscode-button-*` styles, and duplicate marketing copy in headers + body.

**Reference:** `PromptLibraryModal.tsx`, `SettingsPanel.tsx`, `LightningModePanel.tsx`.

## Model assignments (operator-controlled)

Production users do **not** pick provider or model. Assignments live in `src/config/featureModelAssignments.ts` and must be wired through settings UI, extension runtime, config writes, and server APIs. See `.cursor/rules/model-assignments.mdc` and `website/content/docs/model-assignments.md`. **Do not** add provider/model pickers without `canUserSelectModels({ devMode: true })` gating.

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

## Boris bar

**Boris bar** is Coop’s quality bar: **Claude Code / Anthropic-grade craft**, not vibe-coded output. When the user says *“make sure this meets the Boris bar”*, treat it as a **ship gate** — would this pass review on a serious agentic coding product, or does it feel like a demo that only works in the happy path?

### Claude Code quality vs vibe code

| Claude Code quality (target) | Vibe code (reject) |
|------------------------------|---------------------|
| Correct, minimal diffs; matches repo conventions | Broad refactors, duplicate abstractions, “AI-shaped” boilerplate |
| Features wired end-to-end on the hot path | Scaffolds, stubs, or code paths that exist but aren’t called |
| Tested behavior; failures are handled plainly | “It compiles”; silent fallbacks; untested edge cases |
| UX that respects latency, clarity, and user trust | Marketing copy in product UI; magic that breaks under real repos |
| Honest scope — ship what works, flag what doesn’t | Oversell parity with competitors; hide quality tradeoffs |

We are building for **daily use by strong engineers**, not for a screenshot or a one-off prompt win.

### Coop-specific bar (on top of craft)

1. **Infrastructure is wired, not orphaned** — Index, retrieval, and graph slices must feed **user-facing paths** (autocomplete, chat, edit, quick actions). “Implemented but never called” fails the bar.
2. **Codegen is graph-grounded where we claim repo intelligence** — New text should use Lightning/SCIP/Zoekt when the repo is indexed, not buffer-only by default.
3. **Close the loop** — Output should be **applicable in the IDE** (ghost text, apply patch, runnable command). Chat-only demos fail the bar for codegen.
4. **Defaults match the story** — Turn on core value when prerequisites are met; off-by-default needs justification.
5. **Differentiate deliberately** — Moat = cross-tool context + decision workflows; don’t claim Cody-level inline codegen until it’s wired.

### Quick self-check (agent)

Before marking work done:

- Would this feel at home in **Claude Code** (rigorous, shippable), or like **vibe code** (fragile, overscoped, untested)?
- Would a senior engineer **trust and use** this daily?
- Did we **test the hot path** (extension build + targeted tests)?

If any answer is no, fix or flag it — don’t oversell.

