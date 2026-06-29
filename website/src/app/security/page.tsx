import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/LegalLayout";
import { TrustBadges } from "@/components/TrustBadges";
import { CTASection } from "@/components/CTASection";

export const metadata: Metadata = {
  title: "Security",
  description:
    "CoopAI security: Zero-retention routing, BYOK, audit-ready logging, data residency.",
  openGraph: {
    description:
      "How CoopAI protects your code and context. Enterprise-grade security architecture."
  },
  twitter: {
    description:
      "How CoopAI protects your code and context. Enterprise-grade security architecture."
  }
};

export default function SecurityPage() {
  return (
    <>
      <div className="border-b border-coop-border bg-gray-50 py-12">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-gray-900">Security</h1>
          <p className="mt-4 text-lg text-coop-muted">
            How CoopAI protects your code, credentials, and inference data.
          </p>
          <p className="mt-4 text-sm text-coop-muted">
            Enterprise benefits and business considerations?{" "}
            <Link href="/enterprise" className="font-medium text-gray-900 hover:underline">
              See Enterprise page →
            </Link>
          </p>
          <div className="mt-8">
            <TrustBadges compact />
          </div>
        </div>
      </div>

      <LegalLayout title="Security Overview" lastUpdated="June 27, 2026">
        <h2>Architecture</h2>
        <p>
          CoopAI is a code intelligence platform with three primary components: a VS Code
          extension, a Coop API server (graph, jobs, webhooks, OAuth, and LLM routing), and a
          background worker for indexing. All customer data is scoped to an{" "}
          <strong>organization</strong> — every indexed repo, integration credential, audit record,
          and API key belongs to exactly one org.
        </p>
        <p>
          CoopAI uses <strong>instance-wide indexing</strong> on Pro and Enterprise plans. When an
          org admin connects a code host, CoopAI builds a Deep-Code Graph across accessible
          repositories — symbol metadata, full-text search indexes, and embedding chunks — on Coop
          infrastructure or your self-hosted deployment. Developers query this graph from VS Code
          without maintaining full repository clones on every laptop.
        </p>
        <p>
          Index jobs use a transient shallow clone on the server to build indexes, then delete the
          clone when the job completes. Persistent storage holds search indexes and graph metadata,
          not long-lived git mirrors.
        </p>
        <p>
          LLM inference is routed through a dedicated server-side <strong>Model Router</strong>.
          Provider API keys live in server configuration — not in the IDE, client settings, or source
          control.
        </p>

        <h2>What gets indexed vs. queried live</h2>
        <p>
          <strong>Indexed on the server (code repositories):</strong>
        </p>
        <ul>
          <li>
            <strong>Symbol graph</strong> — file paths, symbols, references, and ownership signals
            (no full source file bodies in the symbol store)
          </li>
          <li>
            <strong>Full-text search</strong> — searchable file content for Coop-Search across
            Deep-Indexed repos
          </li>
          <li>
            <strong>Embeddings</strong> — vector chunks for files without symbol coverage (Pro and
            Enterprise, when enabled)
          </li>
          <li>
            <strong>Graph metadata</strong> — commit summaries, PR and branch metadata, dependency
            edges, and webhook-derived change signals
          </li>
        </ul>
        <p>
          <strong>Queried live at chat time (not background-indexed):</strong> Slack threads, Jira
          issues, Confluence pages, Notion docs, Google Docs, and Microsoft Teams messages. CoopAI
          fetches integration content on demand when a workflow or chat command needs it — so ticket
          and conversation data is not copied into a standing index.
        </p>
        <p>
          Slack webhook processing may extract decision keywords and repository references for graph
          context. Full message bodies are not retained in the graph cache.
        </p>

        <h2>Multi-tenant isolation</h2>
        <ul>
          <li>
            Every org has a unique ID; repos, indexes, integrations, and audit logs are keyed by{" "}
            <code>org_id</code>
          </li>
          <li>
            Org API keys are stored as SHA-256 hashes — raw keys are shown once at creation and
            never persisted in plaintext
          </li>
          <li>
            Integration OAuth tokens are encrypted at rest using{" "}
            <code>CREDENTIALS_ENCRYPTION_KEY</code>
          </li>
          <li>
            Enterprise plans support SAML 2.0 SSO with per-org configuration; session tokens are
            stored as hashes
          </li>
          <li>
            Connecting integrations and syncing code-host catalogs requires org owner or admin
            role
          </li>
        </ul>

        <h2>Zero-retention LLM routing</h2>
        <p>
          Before any code context reaches an LLM provider, CoopAI applies a zero-retention
          configuration layer:
        </p>
        <ul>
          <li>
            System instructions declaring CoopAI code context as enterprise-confidential
          </li>
          <li>
            Request headers including <code>x-data-retention-policy</code>,{" "}
            <code>x-use-case</code>, <code>x-enterprise-mode</code>, <code>x-no-training</code>,
            and <code>x-no-logging</code>
          </li>
          <li>
            Body annotations under <code>retention_policy</code> with{" "}
            <code>store_conversation</code>, <code>use_for_training</code>,{" "}
            <code>use_for_fine_tuning</code>, and <code>allow_logging</code> set to{" "}
            <code>false</code>
          </li>
          <li>
            Payload sanitization via <code>sanitizeLlmRequestPayload</code> before transmission
          </li>
        </ul>
        <p>
          Inline completions use a separate <code>x-use-case: code-completion-only</code> path —
          distinct from chat, with the same zero-retention posture.
        </p>

        <h2>No model training</h2>
        <p>
          CoopAI does not use your code, prompts, or completions to train models. Inference
          requests are sent to third-party LLM providers under their commercial API terms:
        </p>
        <ul>
          <li>
            <strong>Anthropic:</strong> Commercial Claude API data is not used for training by
            default unless explicitly opted in
          </li>
          <li>
            <strong>OpenAI:</strong> Standard inference API data is not used for training by
            default; abuse-monitoring retention may apply unless zero data retention is contracted
          </li>
          <li>
            <strong>Google Gemini:</strong> Paid API or Vertex AI terms apply; web search, context
            caching, and session storage features are disabled for zero-retention workloads
          </li>
          <li>
            <strong>DeepSeek:</strong> Blocked for enterprise-confidential routing unless legal
            approves a DPA with explicit no-training/no-retention terms
          </li>
        </ul>

        <h2>Bring Your Own Key (BYOK)</h2>
        <p>
          Enterprise customers may route inference through their own provider accounts (Anthropic,
          OpenAI, Gemini, and approved providers). In BYOK mode:
        </p>
        <ul>
          <li>CoopAI stores only an API key hash and encrypted key material</li>
          <li>Decrypted keys exist only for the duration of the outbound request</li>
          <li>API keys are never written to logs, error reports, or audit payloads</li>
          <li>
            BYOK audit events capture customer ID, provider, model, timestamp, request ID, and
            status — retained for 90 days
          </li>
          <li>
            BYOK audit events explicitly exclude API keys, prompts, responses, and raw code context
          </li>
        </ul>

        <h2>Authentication</h2>
        <p>
          API access to the Coop server uses bearer token authentication (
          <code>Authorization: Bearer &lt;COOP_API_TOKEN&gt;</code>). In production,{" "}
          <code>COOP_REQUIRE_API_AUTH=true</code> validates org API keys against the database.
        </p>
        <p>
          The VS Code extension stores the Coop API token using VS Code&apos;s SecretStorage API,
          which leverages the operating system keychain. In production mode, developers sign in with
          their org credentials — integration tokens are not pasted into the IDE.
        </p>

        <h2>Audit logging</h2>
        <p>
          CoopAI maintains an append-only <code>audit_log</code> scoped by organization. Typical
          events include chat completions, indexing enable/disable, workspace repo changes,
          integration connect/disconnect, SAML login, and admin actions.
        </p>
        <p>
          Audit records capture <strong>who</strong> performed an action, <strong>what</strong>{" "}
          action occurred, and limited metadata (provider, model, repo ID) — not prompt content,
          response text, or assembled context bundles. Audit write failures are logged but do not
          block user actions.
        </p>
        <p>
          Org admins can review audit history in the admin portal. Retention reports and signed
          attestation payloads are available for enterprise compliance reviews.
        </p>

        <h2>Data in transit and at rest</h2>
        <ul>
          <li>All API communication uses HTTPS/TLS</li>
          <li>
            Inbound webhooks from GitHub, GitLab, and Slack are signature-verified before
            processing
          </li>
          <li>
            Graph indexes, job queues, and org data persist in PostgreSQL for production
            deployments
          </li>
          <li>Integration credentials and BYOK key material are encrypted at rest</li>
          <li>
            Self-hosted Enterprise deployments keep repo indexes and inference on infrastructure
            you control
          </li>
        </ul>

        <h2>Integrations</h2>
        <p>
          CoopAI connects to GitHub, GitLab, and Bitbucket for repository webhooks and catalog
          sync; Slack, Jira, Confluence, Notion, Google Docs, and Microsoft Teams for
          organizational context. Each integration uses OAuth or host-specific authentication
          configured on the server — credentials are never stored in VS Code settings in production
          mode.
        </p>

        <h2>Logging and error handling</h2>
        <p>CoopAI is designed to exclude sensitive data from logs and crash reports:</p>
        <ul>
          <li>
            Request bodies, response bodies, API keys, and prompt content are excluded from error
            logs
          </li>
          <li>Provider compliance checks run on backend startup</li>
          <li>
            Configuration changes for BYOK, provider enablement, and policy overrides are logged
          </li>
        </ul>

        <h2>Compliance attestation</h2>
        <p>CoopAI can generate retention reports and signed attestation payloads documenting:</p>
        <ul>
          <li>Percentage of requests sent with zero-retention flags</li>
          <li>Count of BYOK requests</li>
          <li>Provider policy links and verification dates</li>
          <li>Sanitization rules applied before transmission</li>
          <li>Configuration changes in the last 90 days</li>
        </ul>
        <p>
          A zero-retention DPA addendum template is available for enterprise customers undergoing
          legal review.
        </p>
        <p>
          We are happy to discuss your security requirements during an enterprise evaluation and
          provide architecture documentation for your review.
        </p>

        <h2>Responsible disclosure</h2>
        <p>
          If you discover a security vulnerability, please report it to{" "}
          <a href="mailto:security@coop-ai.dev">security@coop-ai.dev</a>. We aim to acknowledge
          reports within 48 hours.
        </p>
      </LegalLayout>

      <CTASection
        title="Questions about security?"
        description="Book a demo and we'll walk through architecture, deployment options, and compliance documentation."
        showInstall={false}
      />
    </>
  );
}
