import type { Metadata } from "next";
import { siteConfig } from "@/lib/site.config";

/** Build metadata with an explicit apex-domain canonical URL. */
export function buildPageMetadata(
  pathname: string,
  title: string,
  description: string,
  options?: { robots?: Metadata["robots"] }
): Metadata {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const canonical = path === "/" ? siteConfig.url : `${siteConfig.url}${path}`;

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
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title,
      description
    },
    ...(options?.robots ? { robots: options.robots } : {})
  };
}

export const noIndexRobots: Metadata["robots"] = {
  index: false,
  follow: false
};
