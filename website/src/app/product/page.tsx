import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { HeroExampleCarousel } from "@/components/HeroExampleCarousel";
import { ModelProviderLogos } from "@/components/ModelProviderLogos";
import { ProductShowcaseCarousel } from "@/components/ProductShowcaseCarousel";
import { QuickActionList } from "@/components/QuickActionList";
import { CapabilitiesMatrix } from "@/components/CapabilitiesMatrix";
import { SectionHeading } from "@/components/SectionHeading";
import { siteConfig } from "@/lib/site.config";
import { productCapabilityGroups } from "@/lib/productCapabilities";

export const metadata: Metadata = {
  title: "Product",
  description:
    "CoopAI features: understand-repo, trace-decision, find-owner, blast-radius, knowledge-gaps. Deep codebase context.",
  openGraph: {
    description:
      "Explore CoopAI's capabilities: graph-grounded code understanding without monorepo clones."
  },
  twitter: {
    description:
      "Explore CoopAI's capabilities: graph-grounded code understanding without monorepo clones."
  }
};

export default function ProductPage() {
  return (
    <>
      <PageHeader
        eyebrow="Product"
        title="CoopAI: Instance-wide code intelligence for teams"
        description="CoopAI indexes your entire codebase and the tools that your team uses. Providing context from tools like GitHub, GitLab, Slack, Jira, Notion, and more."
      />

      <section className="border-b border-coop-border pb-16 pt-4 md:pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <ProductShowcaseCarousel />
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <ModelProviderLogos />
          <SectionHeading
            label="quick_actions"
            title="Quick actions & code creation"
            description="Code with your team's full context — one-click intelligence workflows plus inline complete and in-file edit."
            className="mt-2"
          />
          <QuickActionList className="mt-10" />

          <div className="mx-auto mt-14 max-w-4xl md:mt-16">
            <HeroExampleCarousel compact />
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-gray-50 py-16" id="lightning-mode">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="lightning_mode"
            title="Lightning Mode: Instance-wide indexed search"
            description="For teams with many interconnected repositories, Lightning Mode provides instant cross-repo context through instance-wide indexing."
          />
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-semibold text-gray-900">What it includes:</h3>
              <ul className="mt-4 space-y-2 text-sm text-coop-muted">
                <li>Search across your entire codebase instantly</li>
                <li>Instance-wide symbol and content indexing</li>
                <li>Instant context without repository cloning</li>
                <li>Smart caching and incremental updates</li>
                <li>Works offline (falls back to local index)</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Who needs it:</h3>
              <p className="mt-4 text-sm leading-relaxed text-coop-muted">
                Teams with 5+ connected services, microservice architectures, or teams where cloning
                monorepos isn&apos;t practical.
              </p>
              <p className="mt-6 text-sm text-coop-muted">
                <span className="font-medium text-gray-900">Available in:</span> Pro and Enterprise plans
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="write"
            title={siteConfig.codeCreation.title}
            description={siteConfig.codeCreation.tagline}
          />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {siteConfig.codeCreation.features.map((item) => (
              <div key={item.id} className="coop-card">
                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading label="features" title="Capabilities" />
          <CapabilitiesMatrix groups={productCapabilityGroups} />
          <p className="mt-8 text-sm text-coop-muted">
            Graph-backed completion context and file @-mentions in chat are rolling out next.{" "}
            <span className="text-gray-600">Inline complete and edit selection are in active development.</span>
          </p>
        </div>
      </section>

      <CTASection />
    </>
  );
}
