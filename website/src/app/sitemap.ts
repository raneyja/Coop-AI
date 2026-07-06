import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllDocs } from "@/lib/docs";
import { siteConfig } from "@/lib/site.config";

const HIGH_PRIORITY_PATHS = new Set(["/", "/product", "/enterprise", "/pricing", "/integrations", "/manual"]);

const STATIC_PATHS = [
  "/",
  "/product",
  "/enterprise",
  "/integrations",
  "/pricing",
  "/manual",
  "/docs",
  "/security",
  "/blog",
  "/privacy",
  "/terms",
  "/demo"
] as const;

/** Approximate last-updated dates for static marketing pages. Update when page content changes. */
const STATIC_LAST_MODIFIED: Partial<Record<(typeof STATIC_PATHS)[number], string>> = {
  "/": "2026-07-06",
  "/product": "2026-07-06",
  "/enterprise": "2026-07-06",
  "/integrations": "2026-07-06",
  "/pricing": "2026-07-06",
  "/manual": "2026-06-29",
  "/docs": "2026-06-29",
  "/security": "2026-07-06",
  "/blog": "2026-07-06",
  "/privacy": "2026-05-29",
  "/terms": "2026-05-29",
  "/demo": "2026-06-29"
};

function toLastModified(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url;

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: path === "/" ? base : `${base}${path}`,
    lastModified: toLastModified(STATIC_LAST_MODIFIED[path]) ?? new Date(),
    changeFrequency: HIGH_PRIORITY_PATHS.has(path) ? "weekly" : "monthly",
    priority: HIGH_PRIORITY_PATHS.has(path) ? 1 : 0.7
  }));

  const blogEntries: MetadataRoute.Sitemap = getAllPosts()
    .filter((post) => !post.draft)
    .map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: toLastModified(post.publishedAt) ?? new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8
    }));

  const docsEntries: MetadataRoute.Sitemap = getAllDocs().map((doc) => ({
    url: `${base}/docs/${doc.slug}`,
    lastModified: toLastModified(doc.lastUpdated) ?? new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8
  }));

  return [...staticEntries, ...blogEntries, ...docsEntries];
}
