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

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="border-t border-coop-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="quick_actions"
            title="Understand and write where you work"
            description="Deep questions grounded in your graph — plus inline completions and in-file edits that match how your team actually writes code."
          />

          <QuickActionList className="mt-10" />

          <p className="mt-10">
            <Link href="/product" className="text-sm font-medium text-coop-index hover:text-white">
              Explore all features →
            </Link>
          </p>

          <HomePartnerLogos />
        </div>
      </section>

      <section className="border-y border-coop-border py-20">
        <div className="mx-auto max-w-7xl px-6 lg:grid lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-center lg:gap-10 xl:grid-cols-[minmax(0,30rem)_1fr] xl:gap-12">
          <div>
            <SectionHeading label="indexing" title={siteConfig.contextIntelligence.title} />
            <p className="mt-4 text-lg font-medium text-white/90">
              {siteConfig.contextIntelligence.tagline}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted md:text-base">
              {siteConfig.contextIntelligence.description}
            </p>
            <dl className="mt-8 space-y-4 border-l border-coop-border pl-4">
              {siteConfig.contextIntelligence.features.map((item) => (
                <div key={item.label}>
                  <dt className="font-mono text-sm text-coop-index">{item.label}</dt>
                  <dd className="mt-1 text-sm text-coop-muted">{item.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8 text-sm leading-relaxed text-coop-muted">
              {siteConfig.contextIntelligence.footnote}
            </p>
          </div>
          <div className="mt-10 w-full lg:mt-0">
            <div className="aspect-[920/580] w-full min-h-[22rem] sm:min-h-[26rem] lg:aspect-auto lg:h-[34rem] xl:h-[38rem]">
              <FileContextGraph compact className="h-full" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-coop-border bg-coop-surface/20 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="write"
            title={siteConfig.codeCreation.title}
            description={siteConfig.codeCreation.description}
          />
          <p className="mt-4 max-w-2xl text-lg font-medium text-white/90">
            {siteConfig.codeCreation.tagline}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {siteConfig.codeCreation.features.map((item) => (
              <div key={item.id} className="coop-card">
                <p className="font-mono text-xs text-coop-index">{COMMANDS[item.id] ?? item.id}</p>
                <h3 className="mt-2 font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Testimonial />
      <CTASection />
    </>
  );
}
