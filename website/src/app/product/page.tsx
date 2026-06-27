import type { Metadata } from "next";
import Link from "next/link";
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
        title="CoopAI: Instance-wide code intelligence for teams"
        description="CoopAI indexes your entire instance and connects that with team context—Slack, Jira, decisions. Teams get instant answers across all repositories."
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

      <section className="border-y border-coop-border bg-coop-surface/20 py-16" id="lightning-mode">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="lightning_mode"
            title="Lightning Mode: Instance-wide indexed search"
            description="For teams with many interconnected repositories, Lightning Mode provides instant cross-repo context through instance-wide indexing."
          />
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-semibold text-white">What it includes:</h3>
              <ul className="mt-4 space-y-2 text-sm text-coop-muted">
                <li>Search across your entire codebase instantly</li>
                <li>Instance-wide symbol and content indexing</li>
                <li>Instant context without repository cloning</li>
                <li>Smart caching and incremental updates</li>
                <li>Works offline (falls back to local index)</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-white">Who needs it:</h3>
              <p className="mt-4 text-sm leading-relaxed text-coop-muted">
                Teams with 5+ connected services, microservice architectures, or teams where cloning
                monorepos isn&apos;t practical.
              </p>
              <p className="mt-6 text-sm text-coop-muted">
                <span className="font-medium text-white">Available in:</span> Pro and Enterprise plans
              </p>
            </div>
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
