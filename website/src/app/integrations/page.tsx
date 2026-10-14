import type { Metadata } from "next";
import Link from "next/link";
import { GitHubIcon, GitLabIcon, BitbucketIcon, SlackIcon, JiraIcon, NotionIcon, ConfluenceIcon, TeamsIcon, GoogleDocsIcon } from "@/components/logos/brand-icons";
import cards from "@/components/MarketingCards.module.css";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { HomePartnerLogos } from "@/components/HomePartnerLogos";
import { SectionHeading } from "@/components/SectionHeading";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/integrations",
  siteConfig.seo.pages.integrations.title,
  siteConfig.seo.pages.integrations.description
);

const integrationCards = [
  {
    name: "GitHub",
    Icon: GitHubIcon,
    description: "Deep-Index repositories, PR history, CODEOWNERS, and commit context for graph-grounded answers.",
    href: "/docs/github"
  },
  {
    name: "GitLab",
    Icon: GitLabIcon,
    description: "Connect GitLab repos for the same webhook-driven indexing and ownership graph as GitHub.",
    href: "/docs/connect-integrations"
  },
  {
    name: "Bitbucket",
    Icon: BitbucketIcon,
    description: "Deep-Index Bitbucket repositories for cross-repo context without local monorepo clones.",
    href: "/docs/connect-integrations"
  },
  {
    name: "Slack",
    Icon: SlackIcon,
    description: "Pull live company Slack threads into Trace Decision and Knowledge Gaps — shared org workspace, next to the code graph in VS Code.",
    href: "/docs/slack"
  },
  {
    name: "Microsoft Teams",
    Icon: TeamsIcon,
    description: "Coming soon. Channel search is not available in the product yet.",
    href: "/docs/teams",
    linkLabel: "Status"
  },
  {
    name: "Jira",
    Icon: JiraIcon,
    description: "Link company tickets to code paths for decision history and escalation — queried when you ask.",
    href: "/docs/jira"
  },
  {
    name: "Confluence",
    Icon: ConfluenceIcon,
    description: "Fetch company ADRs, runbooks, and wiki pages live when a question needs them — not copied into a second index.",
    href: "/docs/connect-integrations"
  },
  {
    name: "Notion",
    Icon: NotionIcon,
    description: "Cross-reference company documentation in CoopAI answers at chat time.",
    href: "/docs/notion"
  },
  {
    name: "Google Docs",
    Icon: GoogleDocsIcon,
    description: "Include company runbooks and architecture docs in graph-grounded responses when you ask.",
    href: "/docs/google-docs"
  }
] as const;

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Integrations"
        title="Connect" secondaryTitle="your entire stack"
        description="CoopAI Deep-Indexes your repositories and queries company Slack, Jira, Confluence, and docs live when you ask. An admin connects once; every developer gets that shared stack context inside VS Code — not personal accounts."
      />

      <section className="border-b border-coop-border py-12 md:py-14">
        <div className="mx-auto max-w-6xl px-6">
          <HomePartnerLogos />
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="connect"
            title="Supported integrations"
            description="Org admins connect the company workspace once in the admin portal. Developers sign in and get shared Slack, Jira, and docs context — no personal OAuth tokens."
          />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {integrationCards.map((integration, index) => (
              <Link
                key={integration.name}
                href={integration.href}
                className={`${cards.card} ${index % 2 ? cards.blue : ""}`}
              >
                <integration.Icon className={cards.icon} aria-hidden="true" />
                <h3>{integration.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-coop-muted">{integration.description}</p>
                <p className={cards.cardLink}>
                  {"linkLabel" in integration ? integration.linkLabel : "Setup guide"} →
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-gray-50 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <SectionHeading
            label="admin"
            title="One connection," secondaryTitle="whole org"
            description="Production deployments use the admin portal for GitHub, Slack, Jira, and scope configuration. See the integration checklist for step-by-step setup."
          />
          <p className="mt-8">
            <Link href="/docs/connect-integrations" className="text-sm font-medium text-gray-900 hover:underline">
              Read the integration checklist →
            </Link>
          </p>
        </div>
      </section>

      <CTASection
        title="See integrations" secondaryTitle="in action"
        description="Book a demo and we'll walk through connecting your stack and querying cross-tool context in VS Code."
      />
    </>
  );
}
