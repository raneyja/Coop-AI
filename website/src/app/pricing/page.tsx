import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { Button } from "@/components/Button";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "CoopAI pricing — free Developer plan with Zero-Clone; Pro at $20/user/month adds Lightning Mode for faster cross-repo search."
};

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
    audience: "Individual engineers on a single repo",
    features: [
      "Zero-Clone remote code graph",
      "Optional integrations (Slack, Jira, Notion, and more)",
      "Chat & quick actions — no full clone needed",
      "Workspace prompt library",
      "Cloud-hosted"
    ],
    note: "Lightning Mode available in Pro",
    cta: "Join waitlist",
    href: "/demo?intent=waitlist",
    highlighted: false
  },
  {
    name: "Pro",
    price: "$20",
    period: "per user / month",
    features: [
      "Everything in Developer + Lightning Mode (local graph index for fast cross-repo search)",
      "Much faster on large repos (dependencies, symbols, ownership)",
      "Indexes your local clone or synced repo",
      "Shared prompt libraries",
      "Usage visibility & analytics",
      "Priority support"
    ],
    recommended: true,
    cta: "Book a demo",
    href: "/demo",
    highlighted: true
  },
  {
    name: "Enterprise",
    price: "Custom",
    features: [
      "Everything in Pro",
      "Zero-retention LLM routing",
      "Bring Your Own Key (BYOK)",
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
      <PageHeader
        eyebrow="Pricing"
        titleClassName="font-medium"
        title={
          <>
            Start for free with Zero-Clone.
            <br />
            Go Pro for <span className="font-semibold text-coop-accent">Lightning Mode</span>.
          </>
        }
        description="Every plan comes with a remote code graph from GitHub, GitLab, or Bitbucket, along with Slack, Jira, Notion, and other key tools. Pro unlocks Lightning Mode — a blazing-fast local graph index for dramatically quicker cross-repo search."
      />

      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-2xl border p-8 ${
                  tier.highlighted
                    ? "border-coop-blue/50 bg-coop-surface/50 shadow-lg shadow-coop-blue/10"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">{tier.name}</h2>
                  {tier.recommended ? (
                    <span className="shrink-0 rounded-full border border-coop-blue/40 bg-coop-blue/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-coop-accent">
                      Recommended
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold text-white">{tier.price}</span>
                  {tier.period ? <span className="text-sm text-coop-muted">{tier.period}</span> : null}
                </div>

                <p className="mt-3 min-h-[2.5rem] text-sm leading-snug text-coop-muted">
                  {tier.audience ?? "\u00a0"}
                </p>

                <ul className="mt-6 flex-1 space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm leading-snug text-coop-muted">
                      <span className="mt-0.5 shrink-0 text-coop-accent" aria-hidden>
                        ✓
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {tier.note ? (
                  <p className="mt-5 border-t border-white/10 pt-4 text-sm text-coop-muted">
                    {tier.note}
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
            availability.
          </p>
        </div>
      </section>

      <CTASection showInstall={false} />
    </>
  );
}
