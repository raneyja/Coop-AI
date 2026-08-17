import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/BreadcrumbSchema";
import { CTASection } from "@/components/CTASection";
import { FaqPageSchema } from "@/components/FaqPageSchema";
import { HowItWorksLoop } from "@/components/HowItWorksLoop";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import {
  EDITOR_SURFACES,
  HOW_IT_WORKS_FAQS,
  HOW_IT_WORKS_LOOP,
  INDEXED_VS_LIVE,
  WHO_DOES_WHAT
} from "@/lib/howItWorks";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/how-it-works",
  siteConfig.seo.pages.howItWorks.title,
  siteConfig.seo.pages.howItWorks.description
);

const howToSchema = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How CoopAI works",
  description: siteConfig.seo.pages.howItWorks.description,
  url: `${siteConfig.url}/how-it-works`,
  step: HOW_IT_WORKS_LOOP.map((step, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    name: step.title,
    url: `${siteConfig.url}/how-it-works#${step.id}`,
    text: step.body
  }))
};

export default function HowItWorksPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", href: "/" },
          { name: "How CoopAI works", href: "/how-it-works" }
        ]}
      />
      <FaqPageSchema pairs={HOW_IT_WORKS_FAQS} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }}
      />

      <PageHeader
        eyebrow="how_it_works"
        title="Index the code. Query the stack. Stay in the file."
        description="CoopAI maps your repositories once, pulls Slack and tickets when you ask, then lets you complete and edit in VS Code — without cloning the monorepo."
      />

      <section className="border-b border-coop-border pb-16 md:pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <HowItWorksLoop />
        </div>
      </section>

      <section className="border-b border-coop-border py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="the_split"
            title="What we keep vs what we fetch"
            description="Only repositories are Deep-Indexed. Slack, tickets, and docs are queried live so Coop does not store a second copy of those tools."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <CompareColumn
              label={INDEXED_VS_LIVE.indexed.label}
              title={INDEXED_VS_LIVE.indexed.title}
              items={INDEXED_VS_LIVE.indexed.items}
              note={INDEXED_VS_LIVE.indexed.note}
              emphasized
            />
            <CompareColumn
              label={INDEXED_VS_LIVE.live.label}
              title={INDEXED_VS_LIVE.live.title}
              items={INDEXED_VS_LIVE.live.items}
              note={INDEXED_VS_LIVE.live.note}
            />
          </div>
        </div>
      </section>

      {HOW_IT_WORKS_LOOP.map((step) => (
        <section
          key={step.id}
          id={step.id}
          className="scroll-mt-24 border-b border-coop-border py-16 md:py-20"
        >
          <div className="mx-auto max-w-3xl px-6">
            <SectionHeading label={step.label} title={step.title} description={step.body} />
            {step.id === "index" ? (
              <p className="mt-6 font-mono text-xs text-gray-700">
                Free: up to 3 Deep-Indexed repos · Pro: unlimited
              </p>
            ) : null}
            {step.id === "query-live" ? <LiveToolsDetail /> : null}
            {step.id === "in-vscode" ? <EditorSurfaces /> : null}
          </div>
        </section>
      ))}

      <section className="border-b border-coop-border py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            label="roles"
            title="Connect once. The whole org asks from VS Code."
            description="Admins wire the stack in the admin portal. Developers never paste tokens."
          />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <RoleCard title={WHO_DOES_WHAT.admin.title} items={WHO_DOES_WHAT.admin.items} />
            <RoleCard title={WHO_DOES_WHAT.developer.title} items={WHO_DOES_WHAT.developer.items} />
          </div>
          <p className="mt-8 text-sm text-coop-muted">
            Install steps live in the{" "}
            <Link href="/docs/getting-started" className="font-medium text-gray-900 hover:underline">
              getting started guide
            </Link>{" "}
            and the{" "}
            <Link href="/manual" className="font-medium text-gray-900 hover:underline">
              Owner&apos;s Manual
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="border-b border-coop-border py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <SectionHeading
            label="faq"
            title="Straight answers"
            description="The loop above is the product. These are the questions it usually raises."
          />
          <dl className="mt-10 space-y-8">
            {HOW_IT_WORKS_FAQS.map((pair) => (
              <div key={pair.question}>
                <dt className="text-base font-semibold text-gray-900">{pair.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-coop-muted">{pair.answer}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 text-sm text-coop-muted">
            Architecture and retention detail:{" "}
            <Link href="/security" className="font-medium text-gray-900 hover:underline">
              Security
            </Link>
            . Feature tour:{" "}
            <Link href="/product" className="font-medium text-gray-900 hover:underline">
              Product
            </Link>
            .
          </p>
        </div>
      </section>

      <CTASection
        title="See the loop on your codebase"
        description="Book a walkthrough, or install the free VS Code extension and Deep-Index a repo."
      />
    </>
  );
}

function LiveToolsDetail() {
  return (
    <ul className="mt-8 space-y-3 text-sm leading-relaxed text-coop-muted">
      <li className="flex gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-xs text-coop-index">01</span>
        <span>
          <span className="font-medium text-gray-900">Code hosts</span> (GitHub, GitLab, Bitbucket)
          power Deep-Index, PRs, blame, and CODEOWNERS.
        </span>
      </li>
      <li className="flex gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-xs text-coop-index">02</span>
        <span>
          <span className="font-medium text-gray-900">Collaboration tools</span> (Slack, Jira,
          Confluence, Notion, Google Docs, Teams) are fetched for Trace Decision, Knowledge Gaps,
          and slash commands.
        </span>
      </li>
      <li className="flex gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-xs text-coop-index">03</span>
        <span>
          Setup checklist:{" "}
          <Link href="/integrations" className="font-medium text-gray-900 hover:underline">
            Integrations
          </Link>{" "}
          and{" "}
          <Link href="/docs/connect-integrations" className="font-medium text-gray-900 hover:underline">
            connect integrations
          </Link>
          .
        </span>
      </li>
    </ul>
  );
}

function EditorSurfaces() {
  return (
    <ul className="mt-10 space-y-6">
      {EDITOR_SURFACES.map((item) => (
        <li key={item.id}>
          <p className="font-mono text-sm font-medium text-gray-900">{item.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-coop-muted">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

function RoleCard({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="coop-card">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-snug text-coop-muted">
            <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompareColumn({
  label,
  title,
  items,
  note,
  emphasized = false
}: {
  label: string;
  title: string;
  items: readonly string[];
  note: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-sm border p-5 ${
        emphasized ? "border-gray-900 bg-gray-900 text-white" : "border-coop-border bg-white"
      }`}
    >
      <p
        className={`font-mono text-xs uppercase tracking-wide ${
          emphasized ? "text-coop-index" : "text-gray-500"
        }`}
      >
        {label}
      </p>
      <p className={`mt-2 text-base font-semibold ${emphasized ? "text-white" : "text-gray-900"}`}>
        {title}
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className={`text-sm leading-relaxed ${emphasized ? "text-gray-300" : "text-coop-muted"}`}
          >
            {item}
          </li>
        ))}
      </ul>
      <p
        className={`mt-4 border-t pt-3 text-xs leading-relaxed ${
          emphasized ? "border-white/10 text-gray-400" : "border-coop-border text-coop-muted"
        }`}
      >
        {note}
      </p>
    </div>
  );
}
