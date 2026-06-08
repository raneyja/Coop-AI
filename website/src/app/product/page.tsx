import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { HeroExampleCarousel } from "@/components/HeroExampleCarousel";
import { ModelProviderLogos } from "@/components/ModelProviderLogos";
import { ProductShowcaseCarousel } from "@/components/ProductShowcaseCarousel";
import { QuickActionList } from "@/components/QuickActionList";
import { SectionHeading } from "@/components/SectionHeading";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Graph-grounded code intelligence, inline completions, and in-file edits inside VS Code — zero-clone indexing included."
};

const capabilities = [
  {
    title: "Remote knowledge graph",
    body: "CoopAI indexes repositories via webhooks and background jobs. The extension queries ownership, dependents, and decision signals without requiring a full local clone."
  },
  {
    title: "Inline complete & edit",
    body: "Ghost-text completions and selection-based edits in the open file. Graph-informed suggestions match team patterns — craftsmanship in the editor, not autonomous agents."
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
    title: "Completion-only routing",
    body: "Inline requests use a dedicated zero-retention path (`x-use-case: code-completion-only`) — separate from chat, with keys on your server."
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
        title="Understand deeply. Write in place."
        description="CoopAI connects your code graph, Slack, and tickets for deep questions — and graph-grounded inline completions and in-file edits while you stay in the open file."
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
            description="One-click intelligence workflows plus inline complete and in-file edit — each grounded in file, branch, selection, and graph context."
            className="mt-2"
          />
          <QuickActionList className="mt-10" />

          <div className="mx-auto mt-14 max-w-4xl md:mt-16">
            <HeroExampleCarousel compact />
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-coop-surface/20 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading label="setup" title="How it works" />
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
                title: "Ask & write",
                body: "Quick actions, chat, inline complete, and in-file edit — grounded in your graph, Slack, and tickets."
              }
            ].map((item) => (
              <li key={item.step} className="coop-card">
                <span className="font-mono text-sm text-coop-index">{item.step}</span>
                <h3 className="mt-2 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-coop-border bg-coop-surface/20 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="write"
            title={siteConfig.codeCreation.title}
            description={siteConfig.codeCreation.tagline}
          />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {siteConfig.codeCreation.features.map((item) => (
              <div key={item.id} className="coop-card">
                <h3 className="font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading label="features" title="Capabilities" />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {capabilities.map((cap) => (
              <div key={cap.title} className="coop-card">
                <h3 className="font-semibold text-white">{cap.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-coop-muted">{cap.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-coop-muted">
            Graph-backed completion context and file @-mentions in chat are rolling out next.{" "}
            <span className="text-white/70">Inline complete and edit selection are in active development.</span>
          </p>
        </div>
      </section>

      <CTASection />
    </>
  );
}
