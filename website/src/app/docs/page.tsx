import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { DocsSearch } from "@/components/DocsSearch";
import { DocsSidebar } from "@/components/DocsSidebar";
import { docsInlineLinkClassName } from "@/lib/docsStyles";
import { getDocNav, getDocsSections } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Coop AI documentation — getting started, admin portal, integrations, API reference, and enterprise deployment."
};

const hubCards = [
  {
    title: "Getting started",
    description: "Install the extension, connect your API key, and run your first chat in five minutes.",
    href: "/docs/getting-started"
  },
  {
    title: "Admin portal",
    description: "Connect integrations org-wide, invite teammates, and manage API keys.",
    href: "/docs/admin-portal"
  },
  {
    title: "Integrations",
    description: "GitHub, Slack, Jira, Notion, Google Docs, and more — setup and scope.",
    href: "/docs/connect-integrations"
  },
  {
    title: "API reference",
    description: "Chat, inline completion, health checks, and authentication.",
    href: "/docs/api-reference"
  },
  {
    title: "Enterprise",
    description: "Zero-retention routing, BYOK, self-hosted deployment, and compliance.",
    href: "/docs/enterprise-deployment"
  },
  {
    title: "Owner's Manual",
    description: "Linear guide for daily extension use — quick actions, prompts, and AGENTS.md.",
    href: "/manual"
  }
];

export default function DocsHubPage() {
  const sections = getDocsSections();
  const navPages = getDocNav();

  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="CoopAI Docs"
        description="Everything you need to install, configure, and run Coop AI — from your first chat to enterprise deployment."
        tight
      />

      <section className="border-t border-coop-border pb-24 pt-8">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-10 max-w-md">
            <DocsSearch pages={navPages} />
          </div>

          <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
            <aside className="mb-8 lg:sticky lg:top-24 lg:self-start">
              <DocsSidebar sections={sections} />
            </aside>

            <div>
              <div className="grid gap-4 sm:grid-cols-2">
                {hubCards.map((card) => (
                  <Link
                    key={card.href}
                    href={card.href}
                    className="coop-panel block p-6 transition hover:border-coop-index/50 hover:shadow-sm"
                  >
                    <h2 className="text-base font-semibold text-gray-900">{card.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-coop-muted">{card.description}</p>
                  </Link>
                ))}
              </div>

              <div className="coop-panel mt-8 p-6">
                <h2 className="text-base font-semibold text-gray-900">Quick links</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  <li>
                    <Link href="/manual#get-started" className={docsInlineLinkClassName}>
                      Install guide (Owner&apos;s Manual)
                    </Link>
                  </li>
                  <li>
                    <Link href="/pricing" className={docsInlineLinkClassName}>
                      Plans & pricing
                    </Link>
                  </li>
                  <li>
                    <Link href="/security" className={docsInlineLinkClassName}>
                      Security architecture
                    </Link>
                  </li>
                  <li>
                    <Link href="/signup/free" className={docsInlineLinkClassName}>
                      Free developer signup
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
