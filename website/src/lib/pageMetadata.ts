import type { Metadata } from "next";
import { siteConfig } from "@/lib/site.config";

const DEFAULT_OG_IMAGE_PATH = "/opengraph-image";

/** Build metadata with an explicit apex-domain canonical URL and default social preview. */
export function buildPageMetadata(
  pathname: string,
  title: string,
  description: string,
  options?: { robots?: Metadata["robots"] }
): Metadata {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const canonical = path === "/" ? siteConfig.url : `${siteConfig.url}${path}`;
  const ogImage = {
    url: DEFAULT_OG_IMAGE_PATH,
    width: 1200,
    height: 630,
    alt: siteConfig.seo.ogImageAlt
  };

  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: siteConfig.name,
      type: "website",
      images: [ogImage]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_OG_IMAGE_PATH]
    },
    ...(options?.robots ? { robots: options.robots } : {})
  };
}

export const noIndexRobots: Metadata["robots"] = {
  index: false,
  follow: false
};
