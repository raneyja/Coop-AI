export const siteConfig = {
  name: "CoopAI",
  domain: "coop-ai.dev",
  url: "https://coop-ai.dev",
  description:
    "Understand any codebase in seconds. CoopAI connects code history, Slack, tickets, and your code graph to answer questions in VS Code.",
  tagline: "Your codebase, finally explained.",
  subheadline:
    "Understand any codebase in seconds. CoopAI connects code history, Slack, tickets, and your code graph to answer questions directly inside VS Code.",
  contactEmail: "hello@coop-ai.dev",
  links: {
    github: "https://github.com/coop-ai",
    vscodeMarketplace: process.env.NEXT_PUBLIC_VSCODE_MARKETPLACE_URL || "",
    docs: "/docs"
  },
  nav: [
    { label: "Product", href: "/product" },
    { label: "Enterprise", href: "/enterprise" },
    { label: "Pricing", href: "/pricing" },
    { label: "Security", href: "/security" }
  ] as const,
  quote: {
    text: "By just using the beta version of CoopAI I have seen at least a 50% reduction in time I spend asking / answering questions... I spend at least 6 hours each week answering questions and cut that in half this past week.",
    author: "Senior Engineer",
    company: "Row Labs"
  },
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
