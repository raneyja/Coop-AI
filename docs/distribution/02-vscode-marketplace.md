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

```text
Code intelligence for VS Code: understand production repos without cloning, with company Slack & Jira context and reviewable edits.
```

### Long description (Marketplace README — if Marketplace uses package README, the repo README is the source; otherwise paste below)

```markdown
# CoopAI — code intelligence for VS Code

CoopAI helps production engineering teams **understand existing codebases** and write changes with organizational context — inside stock VS Code.

It is **not** an autonomous coding agent that rewrites the repo on its own.

## Why teams use it

- **Deep-Index (zero-clone)** — understand a monorepo without cloning every service onto every laptop
- **Company Slack, Jira, and docs** — admin-connected once for the org; queried live when you ask
- **Workflows that match real work** — Understand Repo, Trace Decision, Find Owner, Blast Radius, Knowledge Gaps
- **Complete & edit with review** — ghost text and patches you approve before apply

## Not Cooper AI

CoopAI at [coop-ai.dev](https://coop-ai.dev) is VS Code code intelligence. It is a different product from Cooper AI and similarly named agents.

## Learn more

- [What is CoopAI?](https://coop-ai.dev/docs/what-is-coopai)
- [How it works](https://coop-ai.dev/how-it-works)
- [Compare CoopAI](https://coop-ai.dev/docs/compare)
- [Install / pricing](https://coop-ai.dev/pricing)
```

### Categories / tags

Keep: AI, Chat, Machine Learning  
Keywords already in `package.json` are fine; prefer adding `code-intelligence`, `ownership`, `blast-radius` only if Marketplace allows without keyword stuffing.

## Success

- Listing shows homepage `coop-ai.dev`
- Long description links to `/docs/what-is-coopai`
- “Not Cooper AI” appears once (disambiguation without drama)

## Publish note

Marketplace updates often require a new extension version publish. If you only change Marketplace portal metadata, save there; if README-driven, bump version when you next ship.

**When the listing is public (not draft):** start directory Wave A in [06-directories.md](./06-directories.md). Do not submit directories while this listing is still draft-only.
