export const siteConfig = {
  name: "CoopAI",
  domain: "coop-ai.dev",
  url: "https://coop-ai.dev",
  description:
    "CoopAI is code intelligence for VS Code. Understand production code with your repo graph, Slack, and tickets, then complete and edit the way your team already writes.",
  tagline: "From your stack, to your codebase.",
  subheadline:
    "Slack threads, Jira tickets, and symbol graphs in every answer and every line you write.",
  contactEmail: "hello@coop-ai.dev",
  privacyEmail: "privacy@coop-ai.dev",
  securityEmail: "security@coop-ai.dev",
  seo: {
    defaultDescription:
      "CoopAI is code intelligence for VS Code. Understand code, trace decisions, and find owners using context from your repo, Slack, and Jira in every answer.",
    ogImageAlt: "CoopAI: code intelligence for VS Code",
    pages: {
      product: {
        title: "Product | Code intelligence for VS Code",
        description:
          "See how CoopAI works in VS Code: understand repos, trace decisions, find owners, check blast radius, and complete or edit code using your stack."
      },
      howItWorks: {
        title: "How CoopAI works | Index, query, then ask in VS Code",
        description:
          "CoopAI Deep-Indexes your repos, queries Slack, Jira, and docs live, then lets you ask, complete, and edit in VS Code without cloning the monorepo."
      },
      enterprise: {
        title: "Enterprise | Secure code intelligence",
        description:
          "CoopAI Enterprise: zero-retention LLM routing, BYOK, audit logging, multi-tenant deployment, and self-hosted options for security-conscious teams."
      },
      pricing: {
        title: "Pricing | Plans for engineering teams",
        description:
          "CoopAI pricing: free Developer plan, Pro at $20/user/month, and Enterprise with org-wide context and deployment options."
      },
      security: {
        title: "Security | Zero-clone architecture",
        description:
          "How CoopAI protects your code and context: zero-clone architecture, zero-retention LLM routing, BYOK, audit logging, and compliance docs."
      },
      blog: {
        title: "Blog | Code intelligence and SDLC context",
        description:
          "Notes on code intelligence, organizational context, SDLC tooling, and how teams actually ship."
      },
      docs: {
        title: "Documentation | Get started",
        description:
          "Install CoopAI, connect integrations, use the admin portal, and read the API, security, and enterprise deployment guides."
      },
      demo: {
        title: "Book a demo | See CoopAI on your codebase",
        description:
          "Schedule a CoopAI demo. We'll walk through zero-clone indexing, cross-tool context, and how it fits your stack."
      },
      integrations: {
        title: "Integrations | GitHub, Slack, Jira, and more",
        description:
          "Connect CoopAI to GitHub, GitLab, Slack, Jira, Notion, Google Docs, and Microsoft Teams so VS Code has the same context your team already uses."
      },
      privacy: {
        title: "Privacy Policy",
        description:
          "How CoopAI collects, uses, retains, and protects your data across the website, VS Code extension, and backend services."
      },
      terms: {
        title: "Terms of Service",
        description:
          "Terms governing use of CoopAI services, including the website, VS Code extension, admin portal, and API."
      }
    }
  },
  links: {
    github: "https://github.com/coop-ai",
    vscodeMarketplace:
      process.env.NEXT_PUBLIC_VSCODE_MARKETPLACE_URL ||
      "https://marketplace.visualstudio.com/items?itemName=coop-ai.coop-ai",
    manual: "/manual",
    docs: "/docs"
  },
  nav: [
    { label: "Product", href: "/product" },
    { label: "Enterprise", href: "/enterprise" },
    { label: "Pricing", href: "/pricing" },
    { label: "Manual", href: "/manual" },
    { label: "Docs", href: "/docs" },
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
      description: "Architecture, ownership, and key files, without cloning the whole codebase."
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
      description: "What breaks if you change this: integrations, APIs, and operational risk."
    },
    {
      id: "knowledge-gaps",
      title: "Knowledge Gaps",
      description: "Missing context and blind spots before you ship."
    }
  ],
  codeCreation: {
    title: "Graph-grounded generation",
    tagline: "Stay in the file. Write like you've been in the repo for years.",
    description:
      "Built for people shipping production code, not greenfield demos. Completions start from the open buffer; Pro can add indexed dependents and ownership. Edits follow the patterns your org already uses.",
    features: [
      {
        id: "inline-complete",
        title: "Inline complete",
        description:
          "Ghost text as you type, single- or multi-line. Tab to accept. On Pro, indexed dependents and ownership can ride along."
      },
      {
        id: "edit-selection",
        title: "Edit selection",
        description:
          "Highlight a block, describe the change, review an inline diff. Accept, retry, or undo. You stay in the file."
      },
      {
        id: "completion-routing",
        title: "Completion-only routing",
        description:
          "Inline requests use a separate zero-retention path (`x-use-case: code-completion-only`), distinct from chat, with keys on your server."
      }
    ]
  },
  contextIntelligence: {
    title: "Lightning Intelligence",
    tagline: "Understand any codebase without cloning the monorepo.",
    description:
      "CoopAI builds a cross-repo knowledge graph so developers get real context across the org, not a guess from one file.",
    features: [
      {
        label: "Cross-repo context",
        description:
          "Reason across services, libraries, and teams from one VS Code sidebar."
      },
      {
        label: "Cross-tool context",
        description:
          "Slack, Jira, and tickets sit next to the code graph, instead of living in someone's head."
      },
      {
        label: "Secure by design",
        description:
          "Context comes from webhooks and index jobs, not a full monorepo copy on every laptop."
      },
      {
        label: "Lightning-fast when you need it",
        description:
          "Lightning Mode indexes with symbol-graph precision for the code paths you touch every day."
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

/** Marketplace URL when published; otherwise install docs. */
export function installExtensionHref(): string {
  return marketplaceHref() ?? "/docs/install-extension";
}
