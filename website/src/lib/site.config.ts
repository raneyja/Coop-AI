export const siteConfig = {
  name: "CoopAI",
  domain: "coop-ai.dev",
  url: "https://coop-ai.dev",
  description:
    "CoopAI is VS Code code intelligence. Understand production code with your repo graph and company Slack, Jira, and docs, then complete and edit the way your team already writes.",
  /** Human-facing footer blurb — keep readable; dense SEO facts live in docs / llms.txt. */
  footerBlurb:
    "CoopAI — shared org context in the editor. From your stack, to your codebase.",
  tagline: "From your stack, to your codebase.",
  subheadline:
    "CoopAI is code intelligence for teams already shipping production software. Ask who owns a path, why a module exists, or what a change breaks — then complete and edit the change in the file — without cloning the monorepo or sending the tree to a black-box agent.",
  heroKicker: "Shared org context in the editor — Slack, Jira, owners, and the code that shipped.",
  contactEmail: "support@coop-ai.dev",
  privacyEmail: "privacy@coop-ai.dev",
  securityEmail: "security@coop-ai.dev",
  seo: {
    defaultDescription:
      "CoopAI puts Slack, Jira, owners, and code history into the editor so teams can ask, complete, and edit with shared org context. Works alongside Copilot, Codex, and Cursor. Zero-clone. Your models, your keys.",
    ogImageAlt: "CoopAI: code intelligence for VS Code",
    pages: {
      product: {
        title: "Product | Code intelligence for VS Code",
        description:
          "VS Code code intelligence: understand a codebase without cloning, find a code owner, check blast radius, and use company Slack and Jira in VS Code to complete or edit."
      },
      howItWorks: {
        title: "How CoopAI works | Index, query, then ask in VS Code",
        description:
          "How CoopAI indexes repos so you can understand a codebase without cloning, queries company Slack and Jira live, then lets you ask, complete, and edit in VS Code."
      },
      enterprise: {
        title: "Enterprise | Secure code intelligence",
        description:
          "CoopAI Enterprise: zero-retention LLM routing, BYOK, audit logging, multi-tenant deployment, and self-hosted options for security-conscious teams."
      },
      pricing: {
        title: "Pricing | Plans for engineering teams",
        description:
          "CoopAI pricing: Free, Pro at $25/user/month, Pro+, Max, and Enterprise with org-wide context and deployment options."
      },
      security: {
        title: "Architecture and data handling | CoopAI",
        description:
          "How CoopAI protects your code and context: zero-clone architecture, zero-retention LLM routing, BYOK, admin-connected integrations, and DPA on request."
      },
      forEngineeringManagers: {
        title: "For engineering managers | CoopAI",
        description:
          "Cut onboarding and interruption tax. CoopAI puts Slack, tickets, owners, and shipped history into VS Code alongside Copilot, Codex, and Cursor."
      },
      blog: {
        title: "Blog | Code intelligence and SDLC context",
        description:
          "Notes on code intelligence, organizational context, SDLC tooling, and how teams actually ship."
      },
      docs: {
        title: "Documentation | Get started",
        description:
          "Install CoopAI, connect integrations, compare CoopAI to Copilot and Cursor, and read API, security, and enterprise guides."
      },
      demo: {
        title: "Book a demo | See CoopAI on your codebase",
        description:
          "Schedule a CoopAI demo. Walk through zero-clone indexing, cross-tool context, and how it fits your stack."
      },
      integrations: {
        title: "Integrations | GitHub, Slack, Jira, and more",
        description:
          "Connect CoopAI to GitHub, GitLab, Slack, Jira, Confluence, Notion, and Google Docs once for the company so every developer gets shared stack context next to the code graph — not personal accounts."
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
    docs: "/docs",
    demo: "/demo"
  },
  nav: [
    { label: "Product", href: "/#product" },
    { label: "Security", href: "/security" },
    { label: "For Eng Managers", href: "/for-engineering-managers" },
    { label: "Pricing", href: "/pricing" },
    { label: "Docs", href: "/docs" }
  ] as const,
  quotes: [
    {
      text: "I was spending at least 6 hours each week answering the same codebase questions. In the first week on CoopAI I cut that in half — about a 50% drop in time spent asking and answering.",
      author: "Tim Draper — Senior engineer @ Rowlabs",
      detail: "40 users · GitHub, Slack, Jira"
    },
    {
      text: "New engineers used to spend weeks asking seniors basic questions about the repo. They now find owners, tickets, and the last shipped pattern in minutes. Onboarding is a different motion.",
      author: "Javier Oladipo — Engineering Manager @ Kitesystems",
      detail: "50 users · GitHub, Slack, Linear/Jira"
    },
    {
      text: "We were losing 15+ hours a week to 'why did we build it this way?' across Slack, email, and hallways. Changes felt risky because the blast radius lived in someone's head. Now the decision trail is in the editor.",
      author: "Terra Gunderson — Staff Engineer @ Docuzone",
      detail: "25 seats · GitLab, Slack, Jira"
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
          "Company Slack, Jira, and tickets sit next to the code graph — shared org context, not personal accounts."
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
