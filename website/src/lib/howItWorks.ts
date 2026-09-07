import type { FaqPair } from "@/lib/faqSchema";

/** Canonical product loop for /how-it-works — keep in sync with Security (indexed vs live). */
export const HOW_IT_WORKS_LOOP = [
  {
    id: "index",
    step: "01",
    label: "index",
    title: "Index the code",
    summary: "Deep-Index selected repos. Keep a graph, not a clone.",
    body: "An org admin picks the repositories to Deep-Index. Coop clones each repo briefly, builds a searchable map (symbols, callers, ownership, full-text search), then deletes the clone. File bodies are fetched from GitHub, GitLab, or Bitbucket only when someone actually needs them."
  },
  {
    id: "query-live",
    step: "02",
    label: "query_live",
    title: "Query the stack live",
    summary: "Slack, tickets, and docs are fetched when you ask — not copied into a second wiki.",
    body: "Slack threads, Jira tickets, Confluence, Notion, Google Docs, and Teams are not background-indexed. When a question needs them, Coop fetches them at that moment and places them next to the code graph. Your conversations are not stored as a standing search index."
  },
  {
    id: "in-vscode",
    step: "03",
    label: "in_vscode",
    title: "Ask, complete, and edit",
    summary: "Stay in VS Code. Review the diff. Nothing rewrites the tree on its own.",
    body: "Pick Use repo on an indexed remote repository, or work from the file you have open. Chat and quick actions answer from the graph plus live tools. Ghost-text complete as you type. Highlight a block, describe the change, and apply or reject a patch."
  }
] as const;

export const INDEXED_VS_LIVE = {
  indexed: {
    label: "Indexed on the server",
    title: "Your repositories",
    items: [
      "Symbol graph — files, symbols, callers, ownership",
      "Full-text search across Deep-Indexed repos",
      "Commit, PR, and CODEOWNERS signals",
      "Inventory facts — file counts, languages, size"
    ],
    note: "The temporary clone is deleted when the index job finishes. Coop does not keep a git mirror on every laptop."
  },
  live: {
    label: "Fetched when you ask",
    title: "Your tools",
    items: [
      "Slack threads and Microsoft Teams messages",
      "Jira tickets",
      "Confluence, Notion, and Google Docs",
      "The current file body from the code host"
    ],
    note: "Live fetch keeps tickets and threads current without copying them into a second index."
  }
} as const;

export const EDITOR_SURFACES = [
  {
    id: "ask",
    title: "Ask",
    body: "Chat, or five workflows: Understand Repo, Trace Decision, Find Owner, Blast Radius, and Knowledge Gaps. Slash commands include /understand, /trace, /owner, /blast, /gaps, /slack, /jira, and /confluence."
  },
  {
    id: "complete",
    title: "Complete",
    body: "Ghost text as you type. Tab to accept. Completions start from the open file; on Pro, indexed dependents and ownership can ride along."
  },
  {
    id: "edit",
    title: "Edit",
    body: "Highlight a block, describe the change, review an inline diff. Apply, retry, or undo. You stay in the file — Coop does not rewrite the tree on its own."
  }
] as const;

export const WHO_DOES_WHAT = {
  admin: {
    title: "Org admin (once)",
    items: [
      "Connect GitHub, GitLab, or Bitbucket in the admin portal",
      "Connect Slack, Jira, Confluence, Notion, Google Docs, and Teams",
      "Deep-Index the company repos the team should see",
      "Invite teammates (Pro and Enterprise)"
    ]
  },
  developer: {
    title: "Each developer",
    items: [
      "Install the VS Code extension and sign in",
      "Pick Use repo on an indexed repository",
      "Ask, complete, and edit in the sidebar and editor",
      "No tokens to paste — integrations are org-wide"
    ]
  }
} as const;

export const HOW_IT_WORKS_FAQS: FaqPair[] = [
  {
    question: "Do I need a local clone of the repo?",
    answer:
      "No. Deep-Index builds a remote map, then deletes the temporary clone. In VS Code, pick Use repo on the indexed repository. Coop fetches file bodies from the code host when a question or edit needs them."
  },
  {
    question: "Does CoopAI index Slack, Jira, and docs?",
    answer:
      "No. Only code repositories are Deep-Indexed. Slack, Jira, Confluence, Notion, Google Docs, and Teams are queried live at chat time so Coop does not keep a standing copy of those tools."
  },
  {
    question: "Who connects GitHub and Slack?",
    answer:
      "Org admins connect integrations once in the admin portal. Developers sign in to the extension and query that org context. They do not paste OAuth tokens in production."
  },
  {
    question: "What if graph or ticket context is missing?",
    answer:
      "Coop says what is missing instead of guessing. Code-only questions still work if Slack or Jira are not connected. Repo facts such as file counts come from the index — Coop does not estimate them."
  },
  {
    question: "Can I choose the model?",
    answer:
      "Not on Developer or Pro. Coop assigns a model per feature (chat, quick actions, edit, autocomplete). Provider keys stay on the Coop server, not in the IDE."
  }
];
