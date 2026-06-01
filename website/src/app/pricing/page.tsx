import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { Button } from "@/components/Button";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "CoopAI pricing — free Developer plan with Zero-Clone context; Pro at $20/user/month adds Lightning Mode."
};

const tiers = [
  {
    name: "Developer",
    price: "Free",
    period: "during beta",
    description:
      "Zero-Clone remote graph for individual engineers. Great on a single repo — no Lightning Mode (local graph index).",
    features: [
      "Zero-Clone: remote code graph from GitHub, GitLab, or Bitbucket",
      "Optional: Slack, Jira, Teams, Notion, Confluence, Google Docs",
      "Chat & quick actions — no full local clone required",
      "Workspace prompt library",
      "CoopAI cloud or self-hosted server"
    ],
    gap: "Lightning Mode — upgrade to Pro for faster cross-repo search on large codebases",
    cta: "Join waitlist",
    href: "/demo?intent=waitlist",
    highlighted: false
  },
  {
    name: "Pro",
    price: "$20",
    period: "per user / month",
    description:
      "Everything in Developer, plus Lightning Mode — local graph index for faster answers on large and cross-repo codebases.",
    features: [
      "Lightning Mode — local code graph for cross-repo search",
      "Faster on large repos (dependencies, symbols, ownership)",
      "Uses your clone or synced repo; the product is the indexed graph",
      "Shared prompt libraries",
      "Usage visibility",
      "Priority support"
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
      "Everything in Pro",
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
] as const;

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Start free with Zero-Clone. Go Pro for Lightning."
        description="Every plan includes a remote code graph from GitHub, GitLab, or Bitbucket, plus Slack, Jira, Notion, and more when connected. Pro adds Lightning Mode — a local graph index for faster cross-repo search."
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
                  {"gap" in tier && tier.gap ? (
                    <li className="flex gap-2 text-sm text-coop-muted/90">
                      <span className="text-coop-muted">—</span>
                      {tier.gap}
                    </li>
                  ) : null}
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
            Pro is $20/user/month. Beta participants will receive advance notice of any pricing
            changes before general availability.
          </p>
        </div>
      </section>

      <CTASection showInstall={false} />
    </>
  );
}
