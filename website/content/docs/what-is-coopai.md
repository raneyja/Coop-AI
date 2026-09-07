---
title: What is CoopAI?
description: "CoopAI is VS Code code intelligence: zero-clone Deep-Index, company Slack and Jira context, and reviewable edits — not an autonomous coding agent."
section: start
order: 0
lastUpdated: "2026-09-07"
---

CoopAI is **VS Code code intelligence** for production engineering teams.

It Deep-Indexes your repositories into a remote graph (then deletes the temporary clone), queries **company** Slack, Jira, and docs live from an admin-connected workspace, and helps you ask, complete, and edit in the open file — with reviewable diffs.

It is **not** an autonomous coding agent that rewrites the tree on its own.

## The short version

| Question | Answer |
| --- | --- |
| What is it? | A VS Code extension for understanding and changing production code with org context |
| Clone the monorepo? | No — Deep-Index / zero-clone remote graph |
| Slack & Jira? | Company workspace, admin-connected once, shared across developers |
| Who connects tools? | Org admin once; developers just sign in |
| Autopilot rewrites? | No — you review every patch |

## What you can do

- **Understand Repo** — architecture and key paths on an indexed remote
- **Trace Decision** — why something shipped (PRs, tickets, Slack)
- **Find Owner** — CODEOWNERS and ownership signals
- **Blast Radius** — what else breaks if this changes
- **Knowledge Gaps** — missing docs and blind spots
- **Complete & edit** — ghost text and reviewable patches in the open file

## How it works

See [How CoopAI works](/how-it-works) for the loop: index → query company tools live → ask / complete / edit.

## How CoopAI compares

Side-by-side matrices vs Copilot, Cursor, Claude Code, Cody, ChatGPT, and more: [Compare CoopAI](/docs/compare).

## FAQ

### What is CoopAI?

CoopAI is VS Code code intelligence: Deep-Index your repos (zero-clone), query company Slack, Jira, and docs live, then ask, complete, and edit with reviewable diffs.

### Does CoopAI clone my monorepo onto every laptop?

No. Deep-Index builds a remote searchable graph, then deletes the temporary clone. In VS Code you pick **Use repo** on an indexed repository; file bodies fetch from the code host when needed.

### Is Slack and Jira context personal or company-wide?

Company-wide. An org admin connects Slack, Jira, and docs once for the shared workspace. Developers sign in and query that org context — not each person’s personal accounts.

### Is CoopAI an autonomous coding agent?

No. CoopAI helps you ask, complete, and edit in VS Code with reviewable diffs. It does not rewrite the repository tree on its own.

### How is CoopAI different from GitHub Copilot or Cursor?

Copilot and Cursor excel at generating and editing code. CoopAI focuses on understanding existing systems: zero-clone Deep-Index, Find Owner, Blast Radius, Trace Decision, and live company Slack/Jira/docs in VS Code. See [Compare CoopAI](/docs/compare).
