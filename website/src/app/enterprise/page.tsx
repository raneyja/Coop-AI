import type { Metadata } from "next";
import Link from "next/link";
import cards from "@/components/MarketingCards.module.css";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { EnterpriseIntegrationGraph } from "@/components/EnterpriseIntegrationGraph";
import { SectionHeading } from "@/components/SectionHeading";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/enterprise",
  siteConfig.seo.pages.enterprise.title,
  siteConfig.seo.pages.enterprise.description
);

const securityFeatures = [
  {
    title: "Instance-wide indexing",
    body: "Org-selected repositories are indexed on configured server infrastructure. Users access admitted repository context without managing intelligence clones on their laptops."
  },
  {
    title: "LLM request controls",
    body: "Chat formatting includes confidentiality instructions and provider-compatible controls. Other endpoints need separate checks; retention depends on the actual provider account and agreement.",
    link: { href: "/security", label: "Learn how this works →" }
  },
  {
    title: "Provider keys on your server",
    body: "For your own deployment, the server operator configures supported provider API keys. Customer-key routing per organization is not available.",
    link: { href: "/pricing", label: "See deployment options →" }
  },
  {
    title: "Audit records",
    body: "Selected actions produce tenant and actor audit records. Audit writes are best-effort; complete coverage, retention and operator access need qualification.",
    link: { href: "/security", label: "Security details →" }
  },
  {
    title: "SAML single sign-on",
    body: "Enterprise orgs can configure SAML 2.0 sign-in in the admin portal. Qualify the configured IdP and supported browser/editor flow for the deployment.",
    link: { href: "/docs/sso", label: "SSO setup guide →" }
  }
];

export default function EnterprisePage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Enterprise"
        title="Your codebase," secondaryTitle="finally explained"
        description="CoopAI gives engineering teams deep code intelligence and graph-grounded context across their entire stack."
      />

      <section className="border-b border-coop-border pb-6 md:pb-8">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <EnterpriseIntegrationGraph />
        </div>
      </section>

      <section className="pt-6 pb-16 md:pt-8">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading label="security" title="Security and compliance," secondaryTitle="built in" />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {securityFeatures.map((feature, index) => (
              <div key={feature.title} className={`${cards.card} ${index % 2 ? cards.blue : ""}`}>
                <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-coop-muted">{feature.body}</p>
                {feature.link ? (
                  <p className="mt-4">
                    <Link href={feature.link.href} className="text-sm font-medium text-gray-900 hover:underline">
                      {feature.link.label}
                    </Link>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-coop-border bg-white/40 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <SectionHeading
            label="leadership"
            title="For engineering leaders"
            description="Cut the tax of tribal knowledge. Teams onboard faster, stop pinging seniors for the same questions, and see ownership and blast radius before a change ships. Security gets controls they can review."
          />
          <ul className="mt-8 space-y-3 text-sm text-coop-muted">
            <li className="flex gap-3">
              <span className="text-gray-900">✓</span>
              Deploy CoopAI on infrastructure you control
            </li>
            <li className="flex gap-3">
              <span className="text-gray-900">✓</span>
              Integrate with GitHub, GitLab, and Bitbucket webhooks
            </li>
            <li className="flex gap-3">
              <span className="text-gray-900">✓</span>
              Zero-clone architecture: no full repo copies on every laptop
            </li>
            <li className="flex gap-3">
              <span className="text-gray-900">✓</span>
              Discuss deployment-specific data handling and contractual requirements
            </li>
          </ul>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-coop-muted">
            Read our full security posture on the{" "}
            <Link href="/security" className="font-medium text-gray-900 hover:underline">
              Security page
            </Link>
            , or set up{" "}
            <Link href="/docs/sso" className="font-medium text-gray-900 hover:underline">
              SAML SSO
            </Link>
            .
          </p>
        </div>
      </section>

      <CTASection
        title="Talk to us about" secondaryTitle="enterprise deployment"
        description="We'll walk through your security requirements, deployment model, and pilot timeline."
      />
    </>
  );
}
