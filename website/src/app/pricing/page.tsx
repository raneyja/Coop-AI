import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { Button } from "@/components/Button";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/pricing",
  siteConfig.seo.pages.pricing.title,
  siteConfig.seo.pages.pricing.description
);

type PricingTier = {
  name: string;
  price: string;
  period?: string;
  audience?: string;
  features: string[];
  note?: string;
  recommended?: boolean;
  cta: string;
  href: string;
  highlighted: boolean;
};

const tiers: PricingTier[] = [
  {
    name: "Developer",
    price: "Free",
    period: "during beta",
    audience: "Individual engineers — one account, no team seats",
    features: [
      "GitHub, GitLab, and Bitbucket via admin portal (same as Pro)",
      "All collaboration integrations (Slack, Jira, Notion, Teams, Google Docs)",
      "Deep-Index / Lightning Mode — up to 3 repos org-wide",
      "Workspace repos, chat, quick actions, and inline complete & edit",
      "AI credits with rolling 5-hour window (model-weighted)",
      "Cloud-hosted — solo account (1 seat)"
    ],
    note: "Pro adds unlimited Deep-Indexed repos, team seats, and higher AI limits",
    cta: "Get started free",
    href: "/signup/free",
    highlighted: false
  },
  {
    name: "Pro",
    price: "$20",
    period: "per user / month",
    features: [
      "Everything in Developer",
      "Unlimited Deep-Indexed repos (no 3-repo org cap)",
      "Team seats — invite teammates",
      "Higher AI limits and usage analytics",
      "Collections for advanced cross-repo groupings",
      "Priority support"
    ],
    note: "See Lightning Mode details →",
    recommended: true,
    cta: "Start Pro",
    href: "/signup",
    highlighted: true
  },
  {
    name: "Enterprise",
    price: "Custom",
    features: [
      "Everything in Pro",
      "Zero-retention LLM routing — your code never trains models; enterprise-grade data privacy",
      "Bring Your Own Key (BYOK) — connect your own LLM provider (AWS Bedrock, Azure, Vertex AI) or use your API key",
      "Self-hosted deployment",
      "Compliance attestation & DPA support",
      "Dedicated onboarding"
    ],
    cta: "Book a demo",
    href: "/demo",
    highlighted: false
  }
];

export default function PricingPage() {
  return (
    <>
      <PageHeader eyebrow="Pricing" title="Your codebase, finally explained" />

      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-sm border p-8 ${
                  tier.highlighted
                    ? "border-gray-900 bg-gray-50"
                    : "border-coop-border bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">{tier.name}</h2>
                  {tier.recommended ? (
                    <span className="shrink-0 rounded-sm border border-gray-300 bg-gray-100 px-2.5 py-0.5 font-mono text-[11px] text-gray-700">
                      default
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold text-gray-900">{tier.price}</span>
                  {tier.period ? <span className="text-sm text-coop-muted">{tier.period}</span> : null}
                </div>

                <p className="mt-3 min-h-[2.5rem] text-sm leading-snug text-coop-muted">
                  {tier.audience ?? "\u00a0"}
                </p>

                <ul className="mt-6 flex-1 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm leading-snug text-coop-muted">
                      <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                        ✓
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {tier.note ? (
                  <p className="mt-5 border-t border-coop-border pt-4 text-sm text-coop-muted">
                    {tier.name === "Pro" ? (
                      <>
                        <Link href="/product#lightning-mode" className="font-medium text-gray-900 hover:underline">
                          {tier.note}
                        </Link>
                      </>
                    ) : (
                      tier.note
                    )}
                  </p>
                ) : (
                  <div className="mt-5 border-t border-transparent pt-4" aria-hidden />
                )}

                <div className="mt-6">
                  <Button
                    href={tier.href}
                    variant={tier.highlighted ? "primary" : "secondary"}
                    className="w-full"
                  >
                    {tier.cta}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-12 text-center text-sm text-coop-muted">
            Beta participants receive advance notice before any pricing changes at general
            availability.{" "}
            <Link href="/login" className="font-medium text-gray-900 hover:underline">
              Already have an account? Sign in
            </Link>
            .
          </p>
        </div>
      </section>

      <CTASection showInstall={false} />
    </>
  );
}
