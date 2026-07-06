import { siteConfig } from "@/lib/site.config";

export function SiteSchema() {
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
        description: siteConfig.seo.defaultDescription
      },
      {
        "@type": "WebSite",
        "@id": `${siteConfig.url}/#website`,
        url: siteConfig.url,
        name: siteConfig.name,
        description: siteConfig.seo.defaultDescription,
        publisher: { "@id": `${siteConfig.url}/#organization` },
        inLanguage: "en-US"
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteConfig.url}/#software`,
        name: siteConfig.name,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "VS Code",
        description: siteConfig.description,
        url: siteConfig.url,
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
