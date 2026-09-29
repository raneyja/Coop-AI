import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { CTASection } from "@/components/CTASection";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/security",
  siteConfig.seo.pages.security.title,
  siteConfig.seo.pages.security.description
);

const neverLeaves = [
  "Source remains on your infrastructure (zero-clone architecture).",
  "We index repository metadata, ownership graphs, and change history — not a full copy of the tree onto every laptop.",
  "Admin-connected integrations (GitHub/GitLab/Bitbucket, Slack/Teams, Jira, Confluence, Notion, Google Docs). Developers do not OAuth their personal Slack into the org graph."
] as const;

const inference = [
  "Server-side model router.",
  "Zero-retention configuration for enterprise-confidential context.",
  "Bring your own keys. Provider keys live on your server, not in the IDE or source control.",
  "We do not use your code, prompts, or completions to train models."
] as const;

const controls = [
  "SAML SSO (Enterprise)",
  "Role-based admin vs developer access",
  "Audit log for integrations, invites, and API keys",
  "Scoped integration access (channels, projects, repos)"
] as const;

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        tight
        eyebrow="Security"
        title="Architecture and data handling"
        description="CoopAI is built for teams that cannot paste a monorepo into a chatbot. Source stays on your infrastructure. Org context is connected by an admin. Inference can run with zero-retention and your own keys."
      />

      <section className="pb-16">
        <div className="mx-auto max-w-3xl space-y-14 px-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">What never leaves your control</h2>
            <ul className="mt-5 space-y-3">
              {neverLeaves.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-coop-muted">
                  <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted">
              Index jobs use a transient shallow clone on the server to build indexes, then delete the
              clone when the job completes. Persistent storage holds search indexes and graph
              metadata, not long-lived git mirrors — the same zero-clone model described in{" "}
              <Link href="/blog/introducing-coop-ai" className="font-medium text-gray-900 hover:underline">
                Introducing CoopAI
              </Link>
              .
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">How inference is routed</h2>
            <ul className="mt-5 space-y-3">
              {inference.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-coop-muted">
                  <span className="mt-0.5 shrink-0 text-gray-900" aria-hidden>
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted">
              Model providers (Anthropic, OpenAI, Google, Fireworks, or the customer&apos;s BYOK
              endpoint) process prompts only under the customer&apos;s configuration. More detail:{" "}
              <Link
                href="/docs/security-architecture"
                className="font-medium text-gray-900 hover:underline"
              >
                Security architecture docs
              </Link>
              .
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">Controls</h2>
            <ul className="mt-5 space-y-3">
              {controls.map((item) => (
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
            <h2 className="text-xl font-semibold text-gray-900">Subprocessors</h2>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted">
              Exact subprocessors depend on the customer&apos;s chosen model providers and connected
              tools. We will send a current list on request.
            </p>
            <div className="mt-6 overflow-x-auto rounded-sm border border-coop-border">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-coop-border bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-gray-900">Category</th>
                    <th className="px-4 py-3 font-medium text-gray-900">Examples</th>
                    <th className="px-4 py-3 font-medium text-gray-900">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-coop-border bg-white">
                  <tr>
                    <td className="px-4 py-3 text-coop-muted">Model providers</td>
                    <td className="px-4 py-3 text-coop-muted">
                      Anthropic, OpenAI, Google, Fireworks, or customer BYOK endpoint
                    </td>
                    <td className="px-4 py-3 text-coop-muted">
                      Process prompts under the customer&apos;s configuration only
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-coop-muted">Connected tools</td>
                    <td className="px-4 py-3 text-coop-muted">
                      GitHub, GitLab, Bitbucket, Slack, Teams, Jira, Confluence, Notion, Google Docs
                    </td>
                    <td className="px-4 py-3 text-coop-muted">
                      Admin-connected org integrations queried live when needed
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-coop-muted">Infrastructure</td>
                    <td className="px-4 py-3 text-coop-muted">Customer-chosen hosting for Coop API / worker</td>
                    <td className="px-4 py-3 text-coop-muted">
                      Runs index jobs and the model router on your side or managed Coop infra
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-sm border border-coop-border bg-white/70 p-6 md:p-8">
            <h2 className="text-xl font-semibold text-gray-900">Request a DPA</h2>
            <p className="mt-3 text-sm leading-relaxed text-coop-muted">
              Email{" "}
              <a
                href={`mailto:${siteConfig.contactEmail}`}
                className="font-medium text-gray-900 hover:underline"
              >
                {siteConfig.contactEmail}
              </a>{" "}
              with your legal entity name and we will send our DPA.
            </p>
            <div className="mt-6">
              <Button href={siteConfig.links.demo} variant="secondary">
                Book a 20-minute architecture walkthrough
              </Button>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Questions about security?"
        description="Walk through architecture, deployment options, and compliance documentation on your repo."
        primaryLabel="Book a 20-minute architecture walkthrough"
        showInstall={false}
      />
    </>
  );
}
