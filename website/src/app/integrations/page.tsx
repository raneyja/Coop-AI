import type { Metadata } from "next";
import Link from "next/link";
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
    description: "Index repositories, PR history, CODEOWNERS, and commit context for graph-grounded answers.",
    href: "/docs/github"
  },
  {
    name: "GitLab",
    description: "Connect GitLab repos for the same webhook-driven indexing and ownership graph as GitHub.",
    href: "/docs/connect-integrations"
  },
  {
    name: "Bitbucket",
    description: "Index Bitbucket repositories for cross-repo context without local monorepo clones.",
    href: "/docs/connect-integrations"
  },
  {
    name: "Slack",
    description: "Pull thread context into Trace Decision and Knowledge Gaps — institutional knowledge alongside code.",
    href: "/docs/slack"
  },
  {
    name: "Microsoft Teams",
    description: "Channel message context for decision archaeology and knowledge gap detection.",
    href: "/docs/teams"
  },
  {
    name: "Jira",
    description: "Link tickets to code paths for decision history and escalation workflows.",
    href: "/docs/jira"
  },
  {
    name: "Notion",
    description: "Cross-reference internal documentation in CoopAI answers.",
    href: "/docs/notion"
  },
  {
    name: "Google Docs",
    description: "Include runbooks and architecture docs in graph-grounded responses.",
    href: "/docs/google-docs"
  }
] as const;

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Integrations"
        title="Connect your entire stack"
        description="CoopAI indexes code and collaboration tools once at the org level — so every developer gets Slack, Jira, and repo context inside VS Code."
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
            description="Org admins connect integrations once in the admin portal. Developers sign in and query organizational context without pasting OAuth tokens."
          />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {integrationCards.map((integration) => (
              <Link
                key={integration.name}
                href={integration.href}
                className="coop-card block transition hover:border-gray-300 hover:shadow-sm"
              >
                <h3 className="text-lg font-semibold text-gray-900">{integration.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-coop-muted">{integration.description}</p>
                <p className="mt-4 text-sm font-medium text-gray-900">Setup guide →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-gray-50 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <SectionHeading
            label="admin"
            title="One connection, whole org"
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
        title="See integrations in action"
        description="Book a demo and we'll walk through connecting your stack and querying cross-tool context in VS Code."
      />
    </>
  );
}
