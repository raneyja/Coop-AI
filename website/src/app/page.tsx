import { Hero } from "@/components/Hero";
import { HomePartnerLogos } from "@/components/HomePartnerLogos";
import { SectionHeading } from "@/components/SectionHeading";
import { Testimonial } from "@/components/Testimonial";
import { CTASection } from "@/components/CTASection";
import { FileContextGraph } from "@/components/FileContextGraph";
import { QuickActionList } from "@/components/QuickActionList";
import { siteConfig } from "@/lib/site.config";
import Link from "next/link";

const COMMANDS: Record<string, string> = {
  "inline-complete": "coop complete",
  "edit-selection": "coop edit",
  "completion-routing": "coop complete --graph"
};

const HOMEPAGE_QUICK_ACTIONS = [
  {
    id: "understand-repo",
    title: "Understand any codebase",
    description: "Architecture, ownership, key files — instantly."
  },
  {
    id: "trace-decision",
    title: "Trace decisions",
    description: "Why code exists, based on commits, PRs, team context."
  },
  {
    id: "find-owner",
    title: "Find owners",
    description: "Who maintains this. Escalation paths. One graph."
  }
] as const;

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="border-t border-coop-border py-12 md:py-14">
        <div className="mx-auto max-w-6xl px-6">
          <HomePartnerLogos />
        </div>
      </section>

      <section className="border-t border-coop-border py-20">
        <div className="mx-auto max-w-7xl px-6 lg:grid lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-center lg:gap-10 xl:grid-cols-[minmax(0,30rem)_1fr] xl:gap-12">
          <div>
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
          <div className="mt-10 w-full lg:mt-0">
            <div className="aspect-[920/580] w-full min-h-[22rem] sm:min-h-[26rem] lg:aspect-auto lg:h-[34rem] xl:h-[38rem]">
              <FileContextGraph compact className="h-full" />
            </div>
          </div>
        </div>
      </section>

      <Testimonial />

      <section className="border-t border-coop-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading label="quick_actions" title="What you'll ask CoopAI" />

          <QuickActionList
            className="mt-10"
            features={HOMEPAGE_QUICK_ACTIONS}
            includeCodeCreation={false}
            showChat={false}
          />

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
