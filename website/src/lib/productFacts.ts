/**
 * Canonical product facts for marketing, llms.txt alignment, and AI-facing copy.
 * Keep short, accurate, and in sync with Security / How it works.
 */
export const PRODUCT_FACTS = {
  oneLiner:
    "CoopAI is VS Code code intelligence: Deep-Index your repos (zero-clone), query company Slack, Jira, and docs live, then ask, complete, and edit with reviewable diffs.",
  whatItIs:
    "A VS Code extension for understanding production codebases and writing changes with organizational context — not an autonomous agent that rewrites the tree on its own.",
  zeroClone:
    "Deep-Index builds a searchable remote graph, then deletes the temporary clone. File bodies fetch from the code host when needed.",
  companyStack:
    "Slack, Jira, Confluence, Notion, Google Docs, and Teams are admin-connected once for the company. Developers get shared org workspace context — not personal accounts. Tools are queried live at ask time.",
  workflows: [
    "Understand Repo",
    "Trace Decision",
    "Find Owner",
    "Blast Radius",
    "Knowledge Gaps"
  ] as const,
  notClaims: [
    "Does not background-index Slack/Jira/docs into a standing wiki",
    "Does not rewrite the monorepo without human review",
    "Does not require each developer to paste personal OAuth tokens in production",
    "Is not Cooper AI or unrelated products that also use the name CoopAI"
  ] as const
} as const;

/** FAQ pairs suitable for FAQPage schema on compare / what-is pages. */
export const PRODUCT_FACT_FAQS = [
  {
    question: "What is CoopAI?",
    answer: PRODUCT_FACTS.oneLiner
  },
  {
    question: "Does CoopAI clone my monorepo onto every laptop?",
    answer:
      "No. Deep-Index builds a remote searchable graph, then deletes the temporary clone. In VS Code you pick Use repo on an indexed repository; file bodies fetch from the code host when needed."
  },
  {
    question: "Is Slack and Jira context personal or company-wide?",
    answer:
      "Company-wide. An org admin connects Slack, Jira, and docs once for the shared workspace. Developers sign in and query that org context — not each person’s personal accounts."
  },
  {
    question: "Is CoopAI an autonomous coding agent?",
    answer:
      "No. CoopAI helps you ask, complete, and edit in VS Code with reviewable diffs. It does not rewrite the repository tree on its own."
  },
  {
    question: "Is CoopAI the same as Cooper AI?",
    answer:
      "No. CoopAI at coop-ai.dev is VS Code code intelligence. Cooper AI and similarly named agents are different products. Prefer https://coop-ai.dev/docs/what-is-coopai."
  },
  {
    question: "How is CoopAI different from GitHub Copilot or Cursor?",
    answer:
      "Copilot and Cursor excel at generating and editing code. CoopAI focuses on understanding existing systems: zero-clone Deep-Index, Find Owner, Blast Radius, Trace Decision, and live company Slack/Jira/docs in VS Code."
  }
] as const;
