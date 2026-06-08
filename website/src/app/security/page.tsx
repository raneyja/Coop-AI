import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import { TrustBadges } from "@/components/TrustBadges";
import { CTASection } from "@/components/CTASection";

export const metadata: Metadata = {
  title: "Security",
  description: "CoopAI security practices — zero-retention LLM routing, BYOK, and data handling."
};

export default function SecurityPage() {
  return (
    <>
      <div className="border-b border-coop-border bg-coop-surface/20 py-12">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-white">Security</h1>
          <p className="mt-4 text-lg text-coop-muted">
            How CoopAI protects your code, credentials, and inference data.
          </p>
          <div className="mt-8">
            <TrustBadges compact />
          </div>
        </div>
      </div>

      <LegalLayout title="Security Overview" lastUpdated="May 29, 2026">
        <p>
          CoopAI is a code intelligence platform consisting of a VS Code extension, a backend
          server (graph, jobs, webhooks, and LLM routing), and optional integrations with code
          hosts and chat systems. This page describes our security architecture and data handling
          practices as implemented in the current product.
        </p>

        <h2>Architecture</h2>
        <p>
          CoopAI uses a <strong>zero-clone</strong> architecture. Repository metadata, ownership
          graphs, and change history are indexed on the CoopAI server via webhooks and background jobs.
          Developers query this remote graph through the VS Code extension without cloning entire
          codebases locally for intelligence features.
        </p>
        <p>
          LLM inference is routed through a dedicated server-side <strong>Model Router</strong>.
          Provider API keys are stored in server environment configuration — not in the IDE, not in
          client-side settings, and not in source control.
        </p>

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
          <li>Payload sanitization via <code>sanitizeLlmRequestPayload</code> before transmission</li>
        </ul>

        <h2>No model training</h2>
        <p>
          CoopAI does not use your code, prompts, or completions to train models. Inference
          requests are sent to third-party LLM providers under their commercial API terms, which
          by default do not use API data for model training:
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
          Enterprise customers may route inference through their own provider accounts. In BYOK
          mode:
        </p>
        <ul>
          <li>CoopAI stores only an API key hash and encrypted key material</li>
          <li>Decrypted keys exist only for the duration of the outbound request</li>
          <li>API keys are never written to logs, error reports, or audit payloads</li>
          <li>
            Audit logs include customer ID, provider, model, timestamp, request ID, status, and
            status code — retained for 90 days
          </li>
          <li>
            Audit logs explicitly exclude API keys, prompts, responses, and raw code context
          </li>
        </ul>

        <h2>Authentication</h2>
        <p>
          API access to the CoopAI server uses bearer token authentication (
          <code>Authorization: Bearer &lt;COOP_API_TOKEN&gt;</code>). In production, a token must
          be configured; development mode may skip auth when no token is set.
        </p>
        <p>
          The VS Code extension stores the CoopAI API token using VS Code&apos;s SecretStorage API,
          which leverages the operating system keychain.
        </p>

        <h2>Data in transit and at rest</h2>
        <ul>
          <li>All API communication uses HTTPS/TLS</li>
          <li>Webhook payloads from code hosts are validated and processed server-side</li>
          <li>
            Graph and job data storage depends on deployment configuration (in-memory for
            development; PostgreSQL supported for production job queues)
          </li>
          <li>BYOK key material is encrypted at rest</li>
        </ul>

        <h2>Logging and error handling</h2>
        <p>
          CoopAI is designed to exclude sensitive data from logs and crash reports:
        </p>
        <ul>
          <li>Request bodies, response bodies, API keys, and prompt content are excluded from error logs</li>
          <li>Provider compliance checks run on backend startup</li>
          <li>Configuration changes for BYOK, provider enablement, and policy overrides are logged</li>
        </ul>

        <h2>Integrations</h2>
        <p>
          CoopAI integrates with GitHub, GitLab, and Bitbucket for repository webhooks and
          metadata. Slack integration may receive webhook events for organizational context. Each
          integration uses host-specific authentication configured on the server.
        </p>

        <h2>Compliance attestation</h2>
        <p>
          CoopAI can generate retention reports and signed attestation payloads documenting:
        </p>
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
