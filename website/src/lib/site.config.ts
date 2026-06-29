export const siteConfig = {
  name: "CoopAI",
  domain: "coop-ai.dev",
  url: "https://coop-ai.dev",
  description:
    "Understand and refine code in place. CoopAI connects your code graph, Slack, and tickets to answer deep questions and write graph-grounded completions inside VS Code.",
  tagline: "Your codebase, finally explained.",
  subheadline:
    "Instantly understand any codebase with team-wide context from the entire stack.",
  contactEmail: "hello@coop-ai.dev",
  privacyEmail: "privacy@coop-ai.dev",
  links: {
    github: "https://github.com/coop-ai",
    vscodeMarketplace: process.env.NEXT_PUBLIC_VSCODE_MARKETPLACE_URL || "",
    docs: "/docs"
  },
  nav: [
    { label: "Product", href: "/product" },
    { label: "Enterprise", href: "/enterprise" },
    { label: "Pricing", href: "/pricing" },
    { label: "Security", href: "/security" },
    { label: "Blog", href: "/blog" }
  ] as const,
  quotes: [
    {
      text: "By just using the beta version of CoopAI I have seen at least a 50% reduction in time I spend asking / answering questions... I spend at least 6 hours each week answering questions and cut that in half this past week.",
      author: "Senior Engineer",
      company: "Row Labs"
    },
    {
      text: "New engineers used to spend weeks asking senior people basic questions about the codebase. Now they can find that context themselves in minutes. It's completely changed how fast we onboard.",
      author: "Engineering Manager",
      company: "Kitebase"
    },
    {
      text: "Our team was losing 15+ hours a week answering 'why did we build it this way?' questions across Slack, emails, and in-person. CoopAI gives us one place to find that context instantly.",
      author: "Tech Lead",
      company: "Loopframe"
    },
    {
      text: "Before CoopAI, making changes felt risky because you never knew the full context. Now I can trace decisions back to commits, PRs, and team discussions. I make better calls faster.",
      author: "Senior Engineer",
      company: "Halcyon Dev"
    }
  ] as const,
  features: [
    {
      id: "understand-repo",
      title: "Understand Repo",
      description: "Architecture, ownership, and key files — without cloning the whole codebase."
    },
    {
      id: "trace-decision",
      title: "Trace Decision",
      description: "Why this code exists. Pull rationale from commits, PRs, and team context."
    },
    {
      id: "find-owner",
      title: "Find Owner",
      description: "Who owns this area and the escalation path when you need a human."
    },
    {
      id: "blast-radius",
      title: "Blast Radius",
      description: "Impact of changing this code — integrations, APIs, and operational risk."
    },
    {
      id: "knowledge-gaps",
      title: "Knowledge Gaps",
      description: "Missing context and blind spots before you ship."
    }
  ],
  codeCreation: {
    title: "Graph-grounded code creation",
    tagline: "Stay in the file. Write like you've been in the repo for years.",
    description:
      "CoopAI is built for engineers perfecting production code — not vibe-coding greenfield apps. Inline completions and in-file edits draw from your indexed graph, team patterns, and open buffer so suggestions match how your org actually writes code.",
    features: [
      {
        id: "inline-complete",
        title: "Inline complete",
        description:
          "Ghost-text completions as you type — single- and multi-line, Tab to accept. Optional graph context for callers, types, and conventions from your indexed repo."
      },
      {
        id: "edit-selection",
        title: "Edit selection",
        description:
          "Highlight a block, describe the change, review an inline diff. Accept, retry, or undo — craftsmanship in the editor, not an autonomous agent rewriting your tree."
      },
      {
        id: "completion-routing",
        title: "Completion-only routing",
        description:
          "Inline requests use a separate zero-retention code-completion path (`x-use-case: code-completion-only`) — distinct from chat, with keys on your server."
      }
    ]
  },
  contextIntelligence: {
    title: "Lightning Intelligence",
    tagline: "Understand any codebase instantly — without cloning monorepos.",
    description:
      "Your code stays on your infrastructure. CoopAI builds a secure, real-time cross-repository knowledge graph so developers get rich AI context across your entire organization — whether it's a single repo or a massive monorepo.",
    footnote:
      "Developer (free) uses local workspace files with AI credits and unlimited tool integrations — individual accounts only. Pro adds GitHub connections, team seats, and Lightning Mode for the fastest cross-repo search.",
    features: [
      {
        label: "Cross-repo context",
        description:
          "Ask questions that span services, libraries, and teams. Reason across repos from one VS Code sidebar instead of hunting through dozens of clones."
      },
      {
        label: "Cross-tool context",
        description:
          "Slack threads, Jira issues, and tickets sit alongside your code graph — so ownership, incidents, and decisions aren’t trapped in tribal knowledge."
      },
      {
        label: "Secure by design",
        description:
          "Your source stays on your infrastructure. Context is built from webhooks and index jobs — not full monorepo copies on every laptop."
      },
      {
        label: "Lightning-fast when you need it",
        description:
          "Lightning Mode indexes your repos on Coop cloud with symbol-graph precision — faster retrieval for the code paths you touch every day."
      }
    ]
  },
  trustBadges: [
    { label: "No model training", description: "Your code is never used to train models." },
    { label: "Zero-retention routing", description: "Enterprise-confidential context with retention flags disabled." },
    { label: "Keys on your server", description: "LLM provider keys stay server-side, not in the IDE." },
    { label: "BYOK ready", description: "Route inference through your own provider accounts." }
  ]
} as const;

export function marketplaceHref(): string | null {
  const url = siteConfig.links.vscodeMarketplace.trim();
  return url.length > 0 ? url : null;
}
