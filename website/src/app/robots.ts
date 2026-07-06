import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site.config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/welcome",
        "/signup",
        "/login",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/file-context-demo"
      ]
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url
  };
}
