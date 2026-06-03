import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { HeroExampleCarousel } from "@/components/HeroExampleCarousel";
import { ModelProviderLogos } from "@/components/ModelProviderLogos";
import { ProductShowcaseCarousel } from "@/components/ProductShowcaseCarousel";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = {
  title: "Product",
  description: "Quick actions, chat, and zero-clone code intelligence inside VS Code."
};

const capabilities = [
  {
    title: "Remote knowledge graph",
    body: "CoopAI indexes repositories via webhooks and background jobs. The extension queries ownership, dependents, and decision signals without requiring a full local clone."
  },
  {
    title: "Multi-model chat",
    body: "Stream responses from Anthropic, OpenAI, Gemini, and more. Provider keys live on your CoopAI server — never in the IDE or on developer laptops."
  },
  {
    title: "Workspace prompt library",
    body: "Save and share team prompts in `.coop/prompts.json`. Run common workflows from the sidebar or context menu with one click."
  },
  {
    title: "Editor context menu",
    body: "Right-click any selection to Trace Decision, Find Owner, Blast Radius, Understand Repo, or surface Knowledge Gaps."
  },
  {
    title: "Slack & ticket context",
    body: "CoopAI connects organizational context — Slack threads, tickets, and PR history — so answers reflect how decisions were actually made."
  },
  {
    title: "Graceful degradation",
    body: "When graph data is unavailable, CoopAI falls back transparently and tells you what context is missing instead of hallucinating."
  }
];

export default function ProductPage() {
  return (
    <>
      <PageHeader
        eyebrow="Product"
        title="Code intelligence, inside the editor"
        description="CoopAI connects code history, Slack, tickets, and your code graph to answer questions directly inside VS Code."
      />

      <section className="border-b border-white/5 pb-16 pt-4 md:pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <ProductShowcaseCarousel />
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <ModelProviderLogos />
          <h2 className="text-2xl font-semibold text-white">Quick actions</h2>
          <p className="mt-3 max-w-2xl text-coop-muted">
            One-click workflows grounded in your repo. Each action builds a structured prompt with
            file, branch, and selection context.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {siteConfig.features.map((f) => (
              <div key={f.id} className="rounded-xl border border-white/10 p-5">
                <h3 className="font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-coop-muted">{f.description}</p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-14 max-w-3xl md:mt-16">
            <HeroExampleCarousel compact />
          </div>
        </div>
      </section>

      <section className="border-y border-white/5 bg-coop-surface/20 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl font-semibold text-white">How it works</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Connect repos",
                body: "GitHub or GitLab webhooks on your Coop server; Pro adds Lightning per repo. No laptop clones."
              },
              {
                step: "02",
                title: "Install in VS Code",
                body: "API key, pick a repo, ask questions—no local clone."
              },
              {
                step: "03",
                title: "Get answers",
                body: "Quick actions and chat from your graph, Slack, and tickets."
              }
            ].map((item) => (
              <li key={item.step} className="relative">
                <span className="font-mono text-sm text-coop-accent">{item.step}</span>
                <h3 className="mt-2 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl font-semibold text-white">Capabilities</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {capabilities.map((cap) => (
              <div key={cap.title} className="rounded-xl border border-white/10 p-6">
                <h3 className="font-semibold text-white">{cap.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{cap.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-coop-muted">
            Inline autocomplete and file @-mentions are on the roadmap.{" "}
            <span className="text-white/70">Currently in active development.</span>
          </p>
        </div>
      </section>

      <CTASection />
    </>
  );
}
