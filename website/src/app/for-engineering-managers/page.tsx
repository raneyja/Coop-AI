import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Button, InstallExtensionButton } from "@/components/Button";
import { CTASection } from "@/components/CTASection";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/for-engineering-managers",
  siteConfig.seo.pages.forEngineeringManagers.title,
  siteConfig.seo.pages.forEngineeringManagers.description
);

const costsToday = [
  {
    label: "New hire",
    body: "Weeks of “who owns this?”"
  },
  {
    label: "Staff engineer",
    body: "Hours per week repeating answers in Slack"
  },
  {
    label: "Risky edits",
    body: "No ticket, no last PR, no blast radius in the file"
  }
] as const;

const whatChanges = [
  "Minutes to find owner, decision trail, and last shipped pattern",
  "Shared org workspace (admin-connected), not personal chat",
  "Ask, complete, and edit with citations still in VS Code"
] as const;

const demoSteps = [
  "You pick a real service, not a toy repo",
  "We ask who owns a path, why a module exists, and what a change breaks",
  "We make a small edit grounded in that context"
] as const;

export default function ForEngineeringManagersPage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="For engineering managers"
        title="Onboarding and interruptions are the tax. The editor should pay it down."
        description="CoopAI sits next to Copilot, Codex, and Cursor. It does not replace them. It puts Slack, tickets, owners, and shipped history into VS Code so new hires stop asking, staff engineers stop answering, and changes carry blast radius before the PR."
      />

      <section className="pb-16">
        <div className="mx-auto max-w-3xl space-y-14 px-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">What it costs today</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {costsToday.map((item) => (
                <div key={item.label} className="rounded-sm border border-coop-border bg-white/70 p-5">
                  <p className="font-mono text-xs uppercase tracking-wide text-gray-400">
                    {item.label}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-coop-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">What changes with CoopAI</h2>
            <ul className="mt-5 space-y-3">
              {whatChanges.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-coop-muted">
                  <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Works with the assistants you already bought
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted">
              Keep Copilot, Codex, or Cursor. CoopAI is the org-context layer those tools do not
              have.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">How a 20-minute demo works</h2>
            <ul className="mt-5 space-y-3">
              {demoSteps.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-coop-muted">
                  <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <Button href={siteConfig.links.demo}>Book a 20-minute demo on your repo</Button>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">How teams start</h2>
            <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-coop-muted">
              <li>Admin connects GitHub/GitLab + Slack + Jira</li>
              <li>Developers install the VS Code extension</li>
              <li>
                Review plans on{" "}
                <Link href="/pricing" className="font-medium text-gray-900 hover:underline">
                  Pricing
                </Link>
              </li>
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <InstallExtensionButton label="Install the free VS Code extension" />
              <Button href="/pricing" variant="secondary">
                See pricing
              </Button>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="See CoopAI on your codebase"
        description="Install the extension, or spend 20 minutes on your actual repo with the founder."
        primaryLabel="Book a 20-minute demo on your repo"
      />
    </>
  );
}
