import { HomepagePreview } from "@/components/homepage-preview/HomepagePreview";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";
import type { Metadata } from "next";

const homeTitle = `${siteConfig.name} | ${siteConfig.tagline}`;
const homeMetadata = buildPageMetadata("/", siteConfig.name, siteConfig.seo.defaultDescription);

export const metadata: Metadata = {
  ...homeMetadata,
  title: {
    absolute: homeTitle
  },
  openGraph: {
    ...homeMetadata.openGraph,
    title: homeTitle,
    description: siteConfig.seo.defaultDescription
  },
  twitter: {
    ...homeMetadata.twitter,
    title: homeTitle,
    description: siteConfig.seo.defaultDescription
  },
  description: siteConfig.seo.defaultDescription
};

export default function HomePage() {
  return <HomepagePreview />;
}
