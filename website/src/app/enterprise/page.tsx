import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { EnterpriseIntegrationGraph } from "@/components/EnterpriseIntegrationGraph";
import { SectionHeading } from "@/components/SectionHeading";

export const metadata: Metadata = {
  title: "Enterprise",
  description: "Zero-retention LLM routing, BYOK, and enterprise-grade code intelligence for your organization."
};

const enterpriseFeatures = [
  {
    title: "Zero-retention LLM routing",
    body: "Every inference request passes through a configuration layer that sets retention flags, no-training headers, and enterprise-confidential system instructions before reaching any provider."
  },
  {
    title: "Bring Your Own Key (BYOK)",
    body: "Route inference through your organization's provider accounts. CoopAI stores only encrypted key material and a hash — decrypted keys exist only for the duration of the outbound request."
  },
  {
    title: "Server-side key management",
    body: "LLM provider API keys never leave your CoopAI server. Developers authenticate with a CoopAI API token; provider secrets are not stored in VS Code settings or on laptops."
  },
  {
    title: "Multi-provider router",
    body: "Use Anthropic, OpenAI, Gemini, and approved providers from a single server-side router with per-use-case model selection and cost visibility."
  },
  {
    title: "Audit-ready logging",
    body: "BYOK audit logs capture customer ID, provider, model, timestamp, and status — never prompts, responses, API keys, or raw code context. Retention: 90 days."
  },
  {
    title: "Compliance attestation",
    body: "Generate retention reports and signed attestation payloads documenting zero-retention flag usage, BYOK request counts, and provider policy verification dates."
  }
];

export default function EnterprisePage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Enterprise"
        title="Teams need context, too"
        description="CoopAI gives engineering teams deep code intelligence and graph-grounded code creation across their entire stack"
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
          <div className="grid gap-6 md:grid-cols-2">
            {enterpriseFeatures.map((feature) => (
              <div key={feature.title} className="coop-card">
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-coop-muted">{feature.body}</p>
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
