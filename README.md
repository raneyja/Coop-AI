# CoopAI

Code intelligence for VS Code. Understand production code with your repo graph, Slack, and tickets — then complete and edit the way your team already writes.

You do not need a local clone of every repo. CoopAI answers from an indexed remote map plus on-demand file fetches.

![CoopAI sidebar in VS Code](https://coop-ai.dev/screenshots/docs/extension-sidebar-light.png)

## What you can do

- **Understand Repo** — architecture, ownership, and key files without cloning the whole codebase
- **Trace Decision** — why this code exists, from commits, PRs, and team context
- **Find Owner** — who owns this area and who to ask next
- **Blast Radius** — what else changes if you touch this
- **Knowledge Gaps** — missing context before you ship
- **Inline complete** — ghost text as you type; Tab to accept
- **Edit** — describe a change, review the diff, apply in the file

![Trace Decision with evidence in chat](https://coop-ai.dev/screenshots/docs/chat-results-with-evidence-trace-decision.png)

## Requirements

- VS Code 1.92 or later
- A CoopAI account ([free signup](https://coop-ai.dev/signup/free) or an org invite)
- At least one workspace folder open in VS Code

The extension is free to install. Chat, indexing, and completions use your CoopAI plan. See [pricing](https://coop-ai.dev/pricing).

## Get started

1. Install CoopAI from this Marketplace page (or from [coop-ai.dev](https://coop-ai.dev)).
2. Open the CoopAI icon in the activity bar.
3. Sign in (Google, email, or SSO) from the gear icon, or run **CoopAI: Open Settings**.
4. Open a file and ask: `Explain this file. What are the main entry points nearby?`

Full walkthrough: [Getting started](https://coop-ai.dev/docs/getting-started).

## Manual VSIX install

If your org gave you a `.vsix` file:

1. Command Palette → **Extensions: Install from VSIX…**
2. Choose the file
3. Reload VS Code and open the CoopAI activity-bar icon

## Docs and support

- [Documentation](https://coop-ai.dev/docs)
- [Owner’s manual](https://coop-ai.dev/manual)
- [Security](https://coop-ai.dev/security)
- [Privacy](https://coop-ai.dev/privacy)
- [Terms](https://coop-ai.dev/terms)
- Support: [support@coop-ai.dev](mailto:support@coop-ai.dev)

## License

MIT.
