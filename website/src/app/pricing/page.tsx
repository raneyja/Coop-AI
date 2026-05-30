import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { Button } from "@/components/Button";

export const metadata: Metadata = {
  title: "Pricing",
  description: "CoopAI pricing — free extension for developers, enterprise plans for teams."
};

const tiers = [
  {
    name: "Developer",
    price: "Free",
    period: "during beta",
    description: "For individual engineers exploring CoopAI on their repos.",
    features: [
      "VS Code extension",
      "Chat with repo context",
      "Quick actions",
      "Workspace prompt library",
      "Connect to self-hosted or CoopAI cloud server"
    ],
    cta: "Join waitlist",
    href: "/demo?intent=waitlist",
    highlighted: false
  },
  {
    name: "Team",
    price: "TBD",
    period: "coming soon",
    description: "For engineering teams that need shared context and admin controls.",
    features: [
      "Everything in Developer",
      "Shared prompt libraries",
      "Team usage visibility",
      "Priority support",
      "Slack & ticket integrations"
    ],
    cta: "Book a demo",
    href: "/demo",
    highlighted: true
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For organizations with security, compliance, and deployment requirements.",
    features: [
      "Everything in Team",
      "Zero-retention LLM routing",
      "BYOK (Bring Your Own Key)",
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
        title="Simple plans for engineers and teams"
        description="CoopAI is in active development. Join the beta for free, or talk to us about enterprise deployment."
      />

      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`flex flex-col rounded-2xl border p-8 ${
                  tier.highlighted
                    ? "border-coop-blue/50 bg-coop-surface/50 shadow-lg shadow-coop-blue/10"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <h2 className="text-lg font-semibold text-white">{tier.name}</h2>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold text-white">{tier.price}</span>
                  {tier.period && <span className="text-sm text-coop-muted">{tier.period}</span>}
                </div>
                <p className="mt-4 text-sm text-coop-muted">{tier.description}</p>
                <ul className="mt-8 flex-1 space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm text-coop-muted">
                      <span className="text-coop-accent">✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
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
            Pricing will be finalized before general availability. Beta participants will receive
            advance notice of any changes.
          </p>
        </div>
      </section>

      <CTASection showInstall={false} />
    </>
  );
}
