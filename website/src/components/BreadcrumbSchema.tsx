import { siteConfig } from "@/lib/site.config";

type BreadcrumbItem = {
  name: string;
  href: string;
};

type BreadcrumbSchemaProps = {
  items: BreadcrumbItem[];
};

export function BreadcrumbSchema({ items }: BreadcrumbSchemaProps) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.href.startsWith("http") ? item.href : `${siteConfig.url}${item.href}`
    }))
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
  );
}
