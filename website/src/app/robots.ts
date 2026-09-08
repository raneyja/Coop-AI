import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site.config";

/** Paths that should stay out of search / AI crawler indexes. */
const DISALLOW = [
  "/api/",
  "/welcome",
  "/signup",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/email-preview",
  "/file-context-demo"
] as const;

/** Major AI / answer-engine crawlers — allow site content for GEO (same paths as *). */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot"
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOW]
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: [...DISALLOW]
      }))
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url
  };
}
