# 04 — Hacker News

**Rule:** Never dump a link post for its own sake. HN rewards substance and punishes marketing tone.

## Option A — Show HN (best when you have a free tier + demo)

### Title
```text
Show HN: CoopAI – VS Code code intelligence without cloning the monorepo
```

### Text (first comment or submission text)

```text
CoopAI is a VS Code extension for understanding production codebases.

Unlike Copilot/Cursor (strong at generation) or Claude Code (strong as an agent on a local checkout), CoopAI focuses on organizational context in stock VS Code:

- Deep-Index: transient clone → symbol/ownership graph → clone deleted (zero-clone). File bodies fetch from the code host on demand.
- Company Slack/Jira/docs: admin-connected once for the org, queried live at ask time (not each developer’s personal tokens; not a second wiki).
- Workflows: Understand Repo, Trace Decision, Find Owner, Blast Radius, Knowledge Gaps.
- Edits: reviewable diffs; humans apply.

Explicitly not an autonomous coding agent. Also not “Cooper AI” (different product) — we’re coop-ai.dev.

What is: https://coop-ai.dev/docs/what-is-coopai
How it works: https://coop-ai.dev/how-it-works
Compare: https://coop-ai.dev/docs/compare

Curious what HN thinks breaks first on large multi-repo orgs.
```

## Option B — Reply in an existing thread (often better ROI)

Use when someone asks Copilot vs Cursor, “AI that understands our monorepo”, “CODEOWNERS + Slack context”, etc.

### Reply template (short)

```text
If the bottleneck is generation, Copilot/Cursor/Claude Code are the right category.

If the bottleneck is “who owns this / what else breaks / why did we ship it” inside stock VS Code — especially without cloning every service — that’s a different job (code intelligence + org tools).

We built CoopAI for that: zero-clone Deep-Index + admin-connected company Slack/Jira, with reviewable patches.

Canonical writeup: https://coop-ai.dev/docs/what-is-coopai
```

### Reply template (when Cooper mix-up appears)

```text
Quick disambiguation: CoopAI (coop-ai.dev) is a VS Code code-intelligence extension — not Cooper AI / autonomous “missions” agents, and not an autopilot that rewrites the tree.

https://coop-ai.dev/docs/what-is-coopai
```

## Account hygiene

- HN username not tied to your real name / employer
- Don’t argue; correct facts once and link canonical page

## Success

- Thread reply or Show HN gets upvotes from engineers (not marketers)
- At least one comment includes the What is URL
