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
  audience: string;
  features: string[];
  recommended?: boolean;
  cta: string;
  href: string;
  highlighted: boolean;
};

const paidSharedFeatures = [
  "Unlimited Deep-Indexed repos",
  "Team seats and Collections",
  "Monthly included usage",
  "Model picker (default Auto)",
  "Priority support"
];

const selfServeTiers: PricingTier[] = [
  {
    name: "Free",
    price: "Free",
    audience: "Solo engineers. One seat.",
    features: [
      "GitHub, GitLab, Bitbucket, and collaboration tools",
      "Deep-Index up to 3 repos",
      "Chat, complete, and edit",
      "Auto models on a rolling 5-hour window"
    ],
    cta: "Get started free",
    href: "/signup/free",
    highlighted: false
  },
  {
    name: "Pro",
    price: "$25",
    period: "per user / month",
    audience: "Teams. Unlimited index.",
    features: ["Everything in Free", ...paidSharedFeatures],
    cta: "Start Pro",
    href: "/signup?tier=pro",
    highlighted: false
  },
  {
    name: "Pro+",
    price: "$60",
    period: "per user / month",
    audience: "Heavier chat and model use.",
    features: [
      ...paidSharedFeatures,
      "More included usage each month",
      "Hard stop at the cap — upgrade to continue"
    ],
    recommended: true,
    cta: "Start Pro+",
    href: "/signup?tier=pro_plus",
    highlighted: true
  },
  {
    name: "Max",
    price: "$100",
    period: "per user / month",
    audience: "Highest self-serve usage.",
    features: [
      ...paidSharedFeatures,
      "Largest included usage before Enterprise",
      "Hard stop at the cap — contact us to go further"
    ],
    cta: "Start Max",
    href: "/signup?tier=max",
    highlighted: false
  }
];

const enterpriseFeatures = [
  "Everything in Max",
  "Custom usage contract",
  "Zero-retention LLM routing",
  "Bring Your Own Key (BYOK)",
  "Self-hosted deployment",
  "Compliance attestation & DPA"
];

export default function PricingPage() {
  return (
    <>
      <PageHeader tight eyebrow="Pricing" title="Your codebase, finally explained" />

      <section className="pb-20">
        <div className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-10">
          <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            {selfServeTiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex h-full min-w-0 flex-col rounded-sm border p-6 md:p-7 ${
                  tier.highlighted
                    ? "border-gray-900 bg-white/90 shadow-sm backdrop-blur-sm"
                    : "border-coop-border bg-white/70 backdrop-blur-sm"
                }`}
              >
                <div className="flex min-h-[1.75rem] items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">{tier.name}</h2>
                  {tier.recommended ? (
                    <span className="shrink-0 rounded-sm border border-gray-300 bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-700">
                      recommended
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-4xl font-semibold tracking-tight text-gray-900">{tier.price}</span>
                  {tier.period ? <span className="text-sm text-coop-muted">{tier.period}</span> : null}
                </div>

                <p className="mt-3 min-h-[2.5rem] text-sm leading-snug text-coop-muted">{tier.audience}</p>

                <ul className="mt-5 flex-1 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm leading-snug text-coop-muted">
                      <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                        ✓
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-6">
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

          <div className="mt-5 rounded-sm border border-coop-border bg-white/70 px-6 py-5 backdrop-blur-sm md:px-8 md:py-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="shrink-0 lg:w-52">
                <h2 className="text-lg font-semibold text-gray-900">Enterprise</h2>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">Custom</p>
                <p className="mt-2 text-sm text-coop-muted">Security, self-host, and a custom contract.</p>
              </div>
              <ul className="grid flex-1 gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                {enterpriseFeatures.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm leading-snug text-coop-muted">
                    <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                      ✓
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="shrink-0 lg:w-44">
                <Button href="/demo" variant="secondary" className="w-full">
                  Contact Sales
                </Button>
              </div>
            </div>
          </div>

          <p className="mt-12 text-center text-sm text-coop-muted">
            Usage is included with your seat. Hit the cap and upgrade to continue — there is no on-demand
            spend.{" "}
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
