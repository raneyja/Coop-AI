# 05 — Reddit

**Rule:** Same as HN — answer the question; one link max; no brand-new promo threads titled “Check out my startup.”

## Allowed subs (examples — join and lurk first)

- r/vscode
- r/ExperiencedDevs
- r/devops (only if thread is about ownership/context, not spam)
- r/LocalLLaMA / r/ChatGPTCoding — only when comparing tools honestly

Avoid brand-new self-posts in r/programming / r/cscareerquestions.

## Comment templates

### Copilot vs Cursor thread

```text
They optimize for different jobs.

Copilot: generation inside the IDE you already use.
Cursor: AI-native IDE + strong multi-file agents.
Neither is primarily “Find Owner / Blast Radius / Slack+Jira decision history without cloning the monorepo.”

If that’s the gap, look at code-intelligence tools. CoopAI is the VS Code-shaped version of that (zero-clone index + company Slack/Jira, reviewable edits) — https://coop-ai.dev/docs/what-is-coopai

Not an autonomous agent, and not Cooper AI.
```

### “How do you onboard onto a huge monorepo?” thread

```text
Three layers usually:

1) Search/graph over the estate (so you’re not grepping blind)
2) Ownership + change impact
3) Decision history (PRs/tickets/Slack) next to the code

Cloning everything onto a laptop is often the wrong first step. CoopAI’s approach is Deep-Index remote → ask in VS Code → fetch file bodies on demand: https://coop-ai.dev/how-it-works
```

### “Is CoopAI Cooper AI?” thread / comment

```text
Different products.

CoopAI (https://coop-ai.dev) = VS Code code intelligence (zero-clone Deep-Index, company Slack/Jira, reviewable diffs).
Cooper AI = a different agent-style product people often mix up by name.

Canonical: https://coop-ai.dev/docs/what-is-coopai
```

## Success

- Upvotes from people who weren’t looking for a pitch
- Mods don’t remove it
- Link goes to What is or How it works — not bare homepage spam
