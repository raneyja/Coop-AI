import { marketplaceHref, siteConfig } from "@/lib/site.config";
import { PRODUCT_FACTS } from "@/lib/productFacts";

export function SiteSchema() {
  const marketplaceUrl = marketplaceHref();
  const sameAs = [
    siteConfig.links.github,
    ...(marketplaceUrl ? [marketplaceUrl] : [])
  ];

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteConfig.url}/#organization`,
        name: siteConfig.name,
        url: siteConfig.url,
        logo: `${siteConfig.url}/coop-wordmark.png`,
        email: siteConfig.contactEmail,
        description: PRODUCT_FACTS.oneLiner,
        sameAs
      },
      {
        "@type": "WebSite",
        "@id": `${siteConfig.url}/#website`,
        url: siteConfig.url,
        name: siteConfig.name,
        description: PRODUCT_FACTS.oneLiner,
        publisher: { "@id": `${siteConfig.url}/#organization` },
        inLanguage: "en-US"
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteConfig.url}/#software`,
        name: siteConfig.name,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "VS Code",
        description: PRODUCT_FACTS.oneLiner,
        featureList: [
          ...PRODUCT_FACTS.workflows,
          "Zero-clone Deep-Index",
          "Company Slack and Jira context",
          "Inline complete and reviewable edits"
        ],
        url: siteConfig.url,
        ...(marketplaceUrl ? { downloadUrl: marketplaceUrl } : {}),
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free Developer plan available"
        },
        publisher: { "@id": `${siteConfig.url}/#organization` }
      }
    ]
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
  );
}
