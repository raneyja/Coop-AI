import type { Metadata } from "next";
import Link from "next/link";
import cards from "@/components/MarketingCards.module.css";
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
  "Repository files originate at your code host; index jobs and on-demand reads bring source into Coop.",
  "We index repository metadata, ownership graphs, and change history — not a full copy of the tree onto every laptop.",
  "Org admins configure supported integration connections and scopes. Actual access depends on the deployment mode and vendor permissions."
] as const;

const inference = [
  "Server-side model router.",
  "Application request controls; provider retention requires verified account settings and agreements.",
  "Server operators configure supported provider keys. Customer-key routing per organization is not available.",
  "Prompts and source excerpts are sent for inference; provider training terms require account-specific verification."
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
        title="Architecture" secondaryTitle="and data handling"
        description="See how repository source, conversation history and integration context move through Coop storage and configured providers, and which deployment controls need verification."
      />

      <section className="pb-16">
        <div className="mx-auto max-w-3xl space-y-14 px-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Repository data flow</h2>
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
              returned clone through the job cleanup path. Process death or early clone failure needs
              separate cleanup. Persistent storage includes search indexes, graph metadata and source
              chunks, together with synced chat history — the same zero-clone model described in{" "}
              <Link href="/blog/introducing-coop-ai" className="font-medium text-gray-900 hover:underline">
                Introducing CoopAI
              </Link>
              . Clearing local chat does not guarantee deletion of synced server history or backups.
              Retention and deletion must be qualified for the deployment.
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
              Supported model providers process prompts for inference. Provider-side retention depends
              on the actual account settings and agreement. More detail:{" "}
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
            <div className="mt-6 overflow-x-auto rounded-xs border border-coop-border">
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
                      Supported provider API accounts
                    </td>
                    <td className="px-4 py-3 text-coop-muted">
                      Process prompts under their applicable account settings and agreement
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

          <div className={cards.noteCard}>
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
