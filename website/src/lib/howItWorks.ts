import type { FaqPair } from "@/lib/faqSchema";

/** Canonical product loop for /how-it-works — keep in sync with Security (indexed vs live). */
export const HOW_IT_WORKS_LOOP = [
  {
    id: "index",
    step: "01",
    label: "index",
    title: "Index the code",
    summary: "Deep-Index selected repos so you can understand a codebase without cloning.",
    body: "An org admin picks the repositories to Deep-Index. Coop clones each repo briefly, builds a searchable map (symbols, callers, ownership, full-text search), then deletes the clone. That is how you get VS Code code intelligence without a permanent local monorepo. File bodies are fetched from GitHub, GitLab, or Bitbucket only when someone actually needs them."
  },
  {
    id: "query-live",
    step: "02",
    label: "query_live",
    title: "Query the stack live",
    summary: "Company Slack, Jira, and docs in VS Code — shared org context, fetched when you ask.",
    body: "An org admin connects Slack, Jira, Confluence, Notion, and Google Docs once for the company. When a question needs team context, Coop queries those shared sources live and brings the relevant discussion, ticket, or document into the editor alongside repository context."
  },
  {
    id: "in-vscode",
    step: "03",
    label: "in_vscode",
    title: "Ask, complete, and edit",
    summary: "Stay in VS Code. Review the diff. Choose what to apply.",
    body: "Pick Use repo on an indexed remote repository, or work from the file you have open. Chat and quick actions answer from the graph plus live tools — including Find Owner (CODEOWNERS), Blast Radius, and Trace Decision. Ghost-text complete as you type. Highlight a block, describe the change, and apply or reject a patch."
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
    note: "A searchable map on the server brings repository context to your editor. The temporary clone is deleted when the index job finishes."
  },
  live: {
    label: "Fetched when you ask",
    title: "Your company tools",
    items: [
      "Company Slack threads",
      "Company Jira tickets",
      "Company Confluence, Notion, and Google Docs",
      "The current file body from the code host"
    ],
    note: "Connected once by your org admin. Relevant tickets, threads, and documents are fetched live from the shared workspace when you ask."
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
    body: "Highlight a block, describe the change, and review an inline diff. Apply, retry, or undo while staying in the file."
  }
] as const;

export const WHO_DOES_WHAT = {
  admin: {
    title: "Org admin (once)",
    items: [
      "Connect GitHub, GitLab, or Bitbucket in the admin portal",
      "Connect company Slack, Jira, Confluence, Notion, and Google Docs",
      "Deep-Index the company repos the team should see",
      "Invite teammates (Pro and Enterprise)"
    ]
  },
  developer: {
    title: "Each developer",
    items: [
      "Install the VS Code extension and sign in",
      "Pick Use repo on an indexed repository",
      "Ask, complete, and edit with shared company stack context",
      "No tokens to paste — integrations are org-wide, not personal"
    ]
  }
} as const;

export const HOW_IT_WORKS_FAQS: FaqPair[] = [
  {
    question: "Do I need a local clone of the repo?",
    answer:
      "No. Deep-Index builds a remote map so you can understand a codebase without cloning, then deletes the temporary clone. In VS Code, pick Use repo on the indexed repository. Coop fetches file bodies from the code host when a question or edit needs them."
  },
  {
    question: "Does CoopAI index Slack, Jira, and docs?",
    answer:
      "No. Only code repositories are Deep-Indexed. Company Slack, Jira, Confluence, Notion, and Google Docs are queried live at chat time from the admin-connected workspace — shared across the org, not each developer’s personal accounts — so Coop does not keep a standing copy of those tools."
  },
  {
    question: "Who connects GitHub and Slack?",
    answer:
      "Org admins connect the company integrations once in the admin portal. Developers sign in to the extension and query that shared org context. They do not paste personal OAuth tokens in production."
  },
  {
    question: "How can I verify an answer?",
    answer:
      "Review the code and team sources supporting the answer. Coop makes the available context and what still needs verification clear, so you can follow up before making a change. Repository totals, such as file counts, come from indexed inventory."
  },
  {
    question: "Can I choose the model?",
    answer:
      "Auto selects a model for each feature by default. Pro, Pro+, Max, and Enterprise users can choose a catalog model from the chat composer; Free uses Auto. Autocomplete and other dedicated features use their assigned models. Provider keys stay on the server."
  }
];
