import { Hero } from "@/components/Hero";
import { HomePartnerLogos } from "@/components/HomePartnerLogos";
import { Testimonial } from "@/components/Testimonial";
import { CTASection } from "@/components/CTASection";
import { FeatureCardGrid } from "@/components/FeatureCardGrid";
import { siteConfig } from "@/lib/site.config";
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Answers where you already work
            </h2>
            <p className="mt-4 text-lg text-coop-muted">
              CoopAI lives in your VS Code sidebar. Ask about architecture, ownership, incidents,
              or change risk — grounded in your repo graph, not generic LLM guesses.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {siteConfig.features.map((feature) => (
              <article
                key={feature.id}
                className="group rounded-xl border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/20 hover:bg-white/[0.04]"
              >
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{feature.description}</p>
              </article>
            ))}
            <article className="rounded-xl border border-dashed border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white">Chat</h3>
              <p className="mt-2 text-sm leading-relaxed text-coop-muted">
                Free-form questions with repo context, saved prompts, and streaming responses from
                your choice of model.
              </p>
            </article>
          </div>

          <p className="mt-10 text-center">
            <Link href="/product" className="text-sm font-medium text-coop-accent hover:text-white">
              Explore all features →
            </Link>
          </p>

          <HomePartnerLogos />
        </div>
      </section>

      <section className="border-y border-white/5 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              {siteConfig.contextIntelligence.title}
            </h2>
            <p className="mt-4 text-lg font-medium text-white/90">
              {siteConfig.contextIntelligence.tagline}
            </p>
            <p className="mt-4 text-lg leading-relaxed text-coop-muted">
              {siteConfig.contextIntelligence.description}
            </p>
          </div>
          <div className="mt-12">
            <FeatureCardGrid items={siteConfig.contextIntelligence.features} />
          </div>
          <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-coop-muted">
            {siteConfig.contextIntelligence.footnote}
          </p>
        </div>
      </section>

      <Testimonial />
      <CTASection />
    </>
  );
}
