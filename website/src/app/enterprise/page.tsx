import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { EnterpriseIntegrationGraph } from "@/components/EnterpriseIntegrationGraph";
import { SectionHeading } from "@/components/SectionHeading";

export const metadata: Metadata = {
  title: "Enterprise",
  description:
    "CoopAI Enterprise: Zero-retention LLM routing, BYOK, audit logging, multi-tenant deployment.",
  openGraph: {
    description:
      "Enterprise code intelligence. Zero-clone architecture. BYOK. SOC 2. Self-hosted or cloud."
  },
  twitter: {
    description:
      "Enterprise code intelligence. Zero-clone architecture. BYOK. SOC 2. Self-hosted or cloud."
  }
};

const securityFeatures = [
  {
    title: "Instance-wide indexing",
    body: "Your entire codebase is indexed at the instance level. Users access organizational knowledge without managing individual repository clones."
  },
  {
    title: "Zero-retention LLM routing",
    body: "Your code and context never train models. Every request uses enterprise-confidential headers and no-training flags.",
    link: { href: "/security", label: "Learn how this works →" }
  },
  {
    title: "Bring Your Own Key (BYOK)",
    body: "Connect your own LLM provider (AWS Bedrock, Azure, Vertex AI) or use Anthropic/OpenAI with your API key.",
    link: { href: "/pricing", label: "See deployment options →" }
  },
  {
    title: "Audit-ready logging",
    body: "Every context query is logged for compliance and debugging.",
    link: { href: "/security", label: "Security details →" }
  }
];

export default function EnterprisePage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Enterprise"
        title="Your codebase, finally explained"
        description="Zero-clone code intelligence for VS Code. CoopAI gives engineering teams deep code intelligence and graph-grounded context across their entire stack."
      />

      <section className="border-b border-coop-border pb-6 md:pb-8">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <EnterpriseIntegrationGraph />
          <p className="mt-2 font-mono text-[10px] text-coop-muted">
            symbol graph (scip) · full-text (zoekt) · edges from webhook index jobs
          </p>
        </div>
      </section>

      <section className="pt-6 pb-16 md:pt-8">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading label="security" title="Security & Compliance Built In" />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {securityFeatures.map((feature) => (
              <div key={feature.title} className="coop-card">
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-coop-muted">{feature.body}</p>
                {feature.link ? (
                  <p className="mt-4">
                    <Link href={feature.link.href} className="text-sm font-medium text-coop-index hover:text-white">
                      {feature.link.label}
                    </Link>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-coop-surface/20 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <SectionHeading
            label="leadership"
            title="For engineering leaders"
            description="Reduce the tax of tribal knowledge. CoopAI helps teams onboard faster, answer questions without interrupting senior engineers, and surface ownership and blast radius before changes ship — with controls your security team can review."
          />
          <ul className="mt-8 space-y-3 text-sm text-coop-muted">
            <li className="flex gap-3">
              <span className="text-coop-index">✓</span>
              Deploy CoopAI on infrastructure you control
            </li>
            <li className="flex gap-3">
              <span className="text-coop-index">✓</span>
              Integrate with GitHub, GitLab, and Bitbucket webhooks
            </li>
            <li className="flex gap-3">
              <span className="text-coop-index">✓</span>
              Zero-clone architecture — no full repo copies on every laptop
            </li>
            <li className="flex gap-3">
              <span className="text-coop-index">✓</span>
              DPA-ready zero-retention addendum template available
            </li>
          </ul>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-coop-muted">
            Read our full security posture on the{" "}
            <Link href="/security" className="font-medium text-coop-index hover:text-white">
              Security page
            </Link>
            .
          </p>
        </div>
      </section>

      <CTASection
        title="Talk to us about enterprise deployment"
        description="We'll walk through your security requirements, deployment model, and pilot timeline."
      />
    </>
  );
}
