import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/terms",
  siteConfig.seo.pages.terms.title,
  siteConfig.seo.pages.terms.description
);

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="May 29, 2026">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of CoopAI
        services, including the website at {siteConfig.domain}, the VS Code extension, backend
        server software, and related services (collectively, the &quot;Services&quot;) provided by
        CoopAI (&quot;Coop,&quot; &quot;we,&quot; &quot;us&quot;).
      </p>
      <p>
        By accessing or using the Services, you agree to these Terms. If you are using the Services
        on behalf of an organization, you represent that you have authority to bind that
        organization.
      </p>

      <h2>1. Beta and pre-release status</h2>
      <p>
        CoopAI is currently in active development and beta. Features, availability, pricing, and
        these Terms may change without prior notice. The Services are provided on an &quot;as
        is&quot; and &quot;as available&quot; basis during the beta period. We do not guarantee
        uptime, feature completeness, or backward compatibility until general availability.
      </p>

      <h2>2. Account and access</h2>
      <p>
        Access to the CoopAI server requires a valid API token. You are responsible for maintaining
        the confidentiality of your credentials and for all activity under your account. Notify us
        immediately at <a href="mailto:security@coop-ai.dev">security@coop-ai.dev</a> if you suspect
        unauthorized access.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Services to violate any applicable law or regulation</li>
        <li>Attempt to gain unauthorized access to systems, data, or accounts</li>
        <li>Reverse engineer, decompile, or disassemble the Services except as permitted by law</li>
        <li>Use the Services to generate malicious code, spam, or content that infringes third-party rights</li>
        <li>Interfere with or disrupt the integrity or performance of the Services</li>
        <li>Share API tokens or provider credentials in violation of your organization&apos;s policies</li>
      </ul>

      <h2>4. Your content and data</h2>
      <p>
        You retain ownership of code, prompts, and other content you submit through the Services
        (&quot;Customer Content&quot;). You grant Coop a limited license to process Customer Content
        solely to provide the Services — including indexing repositories, assembling context, and
        routing inference requests.
      </p>
      <p>
        You represent that you have the rights and permissions necessary to submit Customer Content
        and to connect repositories and integrations to the Services.
      </p>

      <h2>5. LLM providers and third-party services</h2>
      <p>
        The Services integrate with third-party LLM providers, code hosts, and communication
        platforms. Your use of those services is subject to their respective terms. Coop is not
        responsible for third-party service availability, pricing, or data practices. When you
        configure BYOK, inference is governed by your agreement with the LLM provider.
      </p>

      <h2>6. Intellectual property</h2>
      <p>
        CoopAI, the Coop logo, and the Services (excluding Customer Content) are owned by Coop and
        protected by intellectual property laws. The extension source is available under the MIT
        license where applicable. These Terms do not grant you any rights to our trademarks or
        branding except as needed to use the Services.
      </p>

      <h2>7. Privacy</h2>
      <p>
        Our collection and use of personal information is described in our{" "}
        <a href="/privacy">Privacy Policy</a>, which is incorporated into these Terms by reference.
      </p>

      <h2>8. Fees and payment</h2>
      <p>
        During the beta period, the developer extension may be available at no charge. Enterprise
        pricing will be agreed separately. We reserve the right to introduce fees upon general
        availability with advance notice to beta participants.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        THE SERVICES ARE PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
        IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT. COOP DOES NOT WARRANT THAT AI-GENERATED OUTPUTS WILL BE
        ACCURATE, COMPLETE, OR SUITABLE FOR PRODUCTION USE. YOU ARE RESPONSIBLE FOR REVIEWING ALL
        AI OUTPUT BEFORE ACTING ON IT.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, COOP AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND
        AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
        DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICES.
        OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM THESE TERMS OR THE SERVICES SHALL NOT EXCEED
        THE AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED US
        DOLLARS ($100), WHICHEVER IS GREATER.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless Coop from claims arising from your use of the
        Services, your Customer Content, or your violation of these Terms or applicable law.
      </p>

      <h2>12. Termination</h2>
      <p>
        We may suspend or terminate your access to the Services at any time for violation of these
        Terms or for operational reasons. You may stop using the Services at any time. Provisions
        that by their nature should survive termination (including disclaimers, limitation of
        liability, and indemnification) will survive.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, United States, without regard
        to conflict of law principles. Disputes shall be resolved in the state or federal courts
        located in Delaware, and you consent to personal jurisdiction therein.
      </p>

      <h2>14. Changes to these Terms</h2>
      <p>
        We may modify these Terms at any time. We will post updated Terms on this page with a
        revised &quot;Last updated&quot; date. Continued use of the Services after changes
        constitutes acceptance of the modified Terms.
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about these Terms? Contact{" "}
        <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>.
      </p>
    </LegalLayout>
  );
}
