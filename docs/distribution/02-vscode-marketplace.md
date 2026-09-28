# 02 — VS Code Marketplace (do second)

**Why this wins:** Developers discover extensions here. Marketplace pages get indexed. Listing copy is a primary training/citation surface.

Publisher / item: `coop-ai.coop-ai`  
Listing: https://marketplace.visualstudio.com/items?itemName=coop-ai.coop-ai

## Do this now — Browser / Marketplace publisher

Open [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage) → CoopAI → extension **CoopAI**.

### Fields to set / verify

| Field | Paste this |
| --- | --- |
| **Homepage** | `https://coop-ai.dev` |
| **Repository** | your public GitHub repo URL |
| **Support / Q&A** | `https://coop-ai.dev/docs/faq` |
| **Bugs** | `https://coop-ai.dev/docs/troubleshooting` or GitHub issues |

### Short description (Marketplace one-liner)

Source: `package.json` → `description` (do not paste a divergent one-liner in the portal).

```text
AI Code intelligence for VS Code. Understand, write, search, and edit code from any codehost — without downloading to your local machine.
```

### Long description (Marketplace README)

**Source of truth:** root `README.md` (packed into the VSIX). Opening copy + first image must stay:

```markdown
# CoopAI

AI Code intelligence for VS Code.

Understand, write, search, and edit code from any codehost, without downloading to your local machine. Add context from any tool within your stack to improve accuracy.

CoopAI answers from an indexed remote map plus on-demand file fetches.

![From your Stack. To your Codebase.](https://coop-ai.dev/screenshots/docs/extension-from-your-stack.png)
```

Banner asset: `website/public/screenshots/docs/extension-from-your-stack.png` (must be live on coop-ai.dev before publish).

### Categories / tags

Keep **exactly**: `AI`, `Chat` (primary must be AI — **never** list Machine Learning).  
Enforced by `npm run test:marketplace-listing` (also in `test:ci`) and `.cursor/rules/vscode-marketplace-listing.mdc`.

Keywords already in `package.json` are fine; prefer adding `code-intelligence`, `ownership`, `blast-radius` only if Marketplace allows without keyword stuffing.

## Success

- Listing shows homepage `coop-ai.dev`
- Breadcrumb is **AI** (not Machine Learning)
- Overview opens with the three AI / zero-clone paragraphs and the Stack banner
- Long description still links to product docs further down the README

## Publish note

Marketplace listing fields come from the VSIX. Bump version → `npm run test:marketplace-listing` → `npm run package` → upload/publish. Portal-only metadata edits are temporary and get overwritten by the next VSIX.
