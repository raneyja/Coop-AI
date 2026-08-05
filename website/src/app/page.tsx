import { Hero } from "@/components/Hero";
import { HomePartnerLogos } from "@/components/HomePartnerLogos";
import { SectionHeading } from "@/components/SectionHeading";
import { Testimonial } from "@/components/Testimonial";
import { CTASection } from "@/components/CTASection";
import { ContextConstellation } from "@/components/ContextConstellation";
import { QuickActionPromptCarousel } from "@/components/QuickActionPromptCarousel";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";
import Link from "next/link";
import type { Metadata } from "next";

const homeTitle = `${siteConfig.name} — ${siteConfig.tagline}`;
const homeMetadata = buildPageMetadata("/", siteConfig.name, siteConfig.seo.defaultDescription);

export const metadata: Metadata = {
  ...homeMetadata,
  title: {
    absolute: homeTitle
  },
  openGraph: {
    ...homeMetadata.openGraph,
    title: homeTitle
  },
  twitter: {
    ...homeMetadata.twitter,
    title: homeTitle
  }
};

const COMMANDS: Record<string, string> = {
  "inline-complete": "coop complete",
  "edit-selection": "coop edit",
  "completion-routing": "coop complete --graph"
};

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="border-t border-coop-border py-12 md:py-14">
        <div className="mx-auto max-w-6xl px-6">
          <HomePartnerLogos />
        </div>
      </section>

      <section className="border-t border-coop-border py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6 xl:grid xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:items-center xl:gap-12">
          <div className="min-w-0">
            <SectionHeading label="indexing" title={siteConfig.contextIntelligence.title} />
            <p className="mt-4 text-lg font-medium text-gray-800">
              {siteConfig.contextIntelligence.tagline}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted md:text-base">
              {siteConfig.contextIntelligence.description}
            </p>
            <dl className="mt-8 space-y-4 border-l border-coop-border pl-4">
              {siteConfig.contextIntelligence.features.map((item) => (
                <div key={item.label}>
                  <dt className="font-mono text-sm text-gray-700">{item.label}</dt>
                  <dd className="mt-1 text-sm text-coop-muted">{item.description}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="mt-10 w-full min-w-0 xl:mt-0">
            {/* Mobile: near-square so content-zoom can use height; sm+: design aspect */}
            <div className="relative mx-auto w-full max-w-full overflow-hidden aspect-[6/5] sm:aspect-[920/580] sm:max-w-4xl xl:aspect-auto xl:max-w-none xl:h-[36rem]">
              <ContextConstellation className="absolute inset-0 h-full w-full" />
            </div>
          </div>
        </div>
      </section>

      <Testimonial />

      <section className="border-t border-coop-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="quick_actions"
            title="What you'll ask CoopAI"
            description="Quick actions and slash commands — real questions across your repo graph, Slack, Jira, and the rest of the stack."
          />

          <QuickActionPromptCarousel />

          <p className="mt-10">
            <Link href="/product" className="text-sm font-medium text-gray-900 hover:underline">
              Explore all 8 capabilities on the product page →
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-coop-border bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="write"
            title={siteConfig.codeCreation.title}
            description={siteConfig.codeCreation.description}
          />
          <p className="mt-4 max-w-2xl text-lg font-medium text-gray-800">
            {siteConfig.codeCreation.tagline}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {siteConfig.codeCreation.features
              .filter((item) => item.id !== "completion-routing")
              .map((item) => (
              <div key={item.id} className="coop-card">
                <p className="font-mono text-xs text-gray-500">{COMMANDS[item.id] ?? item.id}</p>
                <h3 className="mt-2 font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
}
