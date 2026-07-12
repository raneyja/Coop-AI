import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { HeroExampleCarousel } from "@/components/HeroExampleCarousel";
import { ModelProviderLogos } from "@/components/ModelProviderLogos";
import { ProductShowcaseCarousel } from "@/components/ProductShowcaseCarousel";
import { QuickActionList } from "@/components/QuickActionList";
import { CapabilitiesMatrix } from "@/components/CapabilitiesMatrix";
import { SectionHeading } from "@/components/SectionHeading";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";
import { productCapabilityGroups } from "@/lib/productCapabilities";

export const metadata: Metadata = buildPageMetadata(
  "/product",
  siteConfig.seo.pages.product.title,
  siteConfig.seo.pages.product.description
);

export default function ProductPage() {
  return (
    <>
      <PageHeader
        eyebrow="Product"
        title="Context from your entire stack (not just your codebase)"
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
                <span className="font-medium text-gray-900">Available in:</span> All plans (free: up to 3 Deep-Indexed repos org-wide; Pro: unlimited)
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
            Inline autocomplete is opt-in — enable{" "}
            <code className="text-gray-600">coopAI.autocomplete.enabled</code> in settings.{" "}
            <a href="/docs/autocomplete" className="text-coop-index hover:underline">
              Autocomplete docs
            </a>
            . Edit selection ships with apply and undo — see{" "}
            <a href="/docs/edit-mode" className="text-coop-index hover:underline">
              Edit mode docs
            </a>
            .
          </p>
        </div>
      </section>

      <CTASection />
    </>
  );
}
