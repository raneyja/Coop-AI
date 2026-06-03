import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How CoopAI collects, uses, and protects your data."
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="May 29, 2026">
      <p>
        This Privacy Policy describes how CoopAI (&quot;Coop,&quot; &quot;we,&quot; &quot;us&quot;)
        collects, uses, and protects information when you use our website at {siteConfig.domain},
        the CoopAI VS Code extension, and related services (collectively, the &quot;Services&quot;).
      </p>

      <h2>1. Information we collect</h2>

      <h3>Website visitors</h3>
      <p>When you visit {siteConfig.domain}, we may collect:</p>
      <ul>
        <li>
          <strong>Contact information</strong> you submit through demo requests, waitlist forms, or
          chat widgets (name, email, company, role, message)
        </li>
        <li>
          <strong>Usage analytics</strong> via Vercel Analytics — aggregated page views, referrers,
          and performance metrics. We do not use third-party advertising trackers.
        </li>
        <li>
          <strong>Technical data</strong> such as browser type, device type, and IP address (may be
          processed by our hosting provider, Vercel, for delivery and security)
        </li>
      </ul>

      <h3>Extension and server users</h3>
      <p>When you use the CoopAI VS Code extension with a CoopAI server, we process:</p>
      <ul>
        <li>
          <strong>Repository metadata</strong> — file paths, ownership, dependency graphs, commit
          history, and PR metadata indexed via webhooks and background jobs
        </li>
        <li>
          <strong>Code excerpts</strong> — selected file content and line ranges you include in chat
          prompts or quick actions, transmitted to your CoopAI server for context assembly
        </li>
        <li>
          <strong>Prompts and completions</strong> — chat messages and AI responses, routed through
          your CoopAI server to LLM providers for inference
        </li>
        <li>
          <strong>Authentication credentials</strong> — CoopAI API tokens stored in VS Code SecretStorage;
          LLM provider keys stored on the server (not in the extension)
        </li>
        <li>
          <strong>Integration data</strong> — Slack messages, ticket references, and other
          organizational context when integrations are configured
        </li>
        <li>
          <strong>Usage metadata</strong> — token counts, model selection, request timestamps, and
          cost estimates for billing and monitoring
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <p>We use collected information to:</p>
      <ul>
        <li>Provide, operate, and improve the Services</li>
        <li>Route inference requests to LLM providers on your behalf</li>
        <li>Build and maintain repository knowledge graphs</li>
        <li>Respond to demo requests, support inquiries, and waitlist signups</li>
        <li>Monitor service health, security, and performance</li>
        <li>Comply with legal obligations</li>
      </ul>
      <p>
        <strong>We do not use your code, prompts, or completions to train machine learning
        models.</strong>
      </p>

      <h2>3. LLM provider processing</h2>
      <p>
        When you use chat or quick actions, code context and prompts are transmitted from your CoopAI
        server to third-party LLM providers (such as Anthropic, OpenAI, or Google) for inference.
        These providers process data under their respective API terms. CoopAI applies zero-retention
        configuration flags to requests where supported. See our{" "}
        <a href="/security">Security page</a> for details.
      </p>
      <p>
        If you use BYOK (Bring Your Own Key), inference is routed through your organization&apos;s
        provider account and governed by your agreement with that provider.
      </p>

      <h2>4. Data retention</h2>
      <ul>
        <li>
          <strong>Website form submissions</strong> are stored in Google Sheets (when configured) or
          server logs until you request deletion
        </li>
        <li>
          <strong>Graph and repository index data</strong> is retained for the duration of your
          subscription or deployment, unless you request deletion
        </li>
        <li>
          <strong>LLM inference data</strong> is processed transiently; CoopAI configures requests to
          disable conversation storage and training use. Provider-side retention varies by provider
          and contract
        </li>
        <li>
          <strong>BYOK audit logs</strong> are retained for 90 days and contain no prompts, responses,
          or code content
        </li>
        <li>
          <strong>Analytics data</strong> is aggregated and retained per Vercel Analytics policies
        </li>
      </ul>

      <h2>5. Data sharing</h2>
      <p>We share information only with:</p>
      <ul>
        <li>
          <strong>LLM providers</strong> — to perform inference you request (Anthropic, OpenAI,
          Google, and others as configured)
        </li>
        <li>
          <strong>Infrastructure providers</strong> — Vercel (website hosting), and your chosen
          deployment environment for the CoopAI server
        </li>
        <li>
          <strong>Code host platforms</strong> — GitHub, GitLab, Bitbucket for webhook and API
          access you authorize
        </li>
        <li>
          <strong>Chat integrations</strong> — Slack or similar, when configured by your organization
        </li>
      </ul>
      <p>We do not sell personal information. We do not share data with advertisers.</p>

      <h2>6. Self-hosted deployments</h2>
      <p>
        Enterprise customers may deploy the CoopAI server on infrastructure they control. In
        self-hosted deployments, repository data, graph indexes, and inference traffic remain within
        your environment. This Privacy Policy still applies to data you submit through our website
        and any CoopAI-operated services.
      </p>

      <h2>7. Your rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li>Access personal information we hold about you</li>
        <li>Request correction or deletion of your personal information</li>
        <li>Object to or restrict certain processing</li>
        <li>Data portability</li>
        <li>Withdraw consent where processing is consent-based</li>
      </ul>
      <p>
        To exercise these rights, contact us at{" "}
        <a href={`mailto:${siteConfig.privacyEmail}`}>{siteConfig.privacyEmail}</a>.
      </p>

      <h2>8. Cookies and tracking</h2>
      <p>
        Our website uses Vercel Analytics, which collects anonymized usage data without cookies for
        basic analytics. If you configure a live chat widget (Tawk.to), that provider may set
        cookies to maintain chat sessions. You can manage cookies through your browser settings.
      </p>

      <h2>9. Children</h2>
      <p>
        The Services are not directed to individuals under 16. We do not knowingly collect personal
        information from children.
      </p>

      <h2>10. International transfers</h2>
      <p>
        If you access the Services from outside the United States, your information may be
        transferred to and processed in the United States or other countries where our service
        providers operate. We take steps to ensure appropriate safeguards for such transfers.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will post the revised policy on this
        page with an updated &quot;Last updated&quot; date. Material changes will be communicated
        via email or in-product notice where appropriate.
      </p>

      <h2>12. Contact us</h2>
      <p>
        Questions about this Privacy Policy? Contact{" "}
        <a href={`mailto:${siteConfig.privacyEmail}`}>{siteConfig.privacyEmail}</a>.
      </p>
    </LegalLayout>
  );
}
