import type { Metadata } from "next";
import type { BlogPost } from "@/lib/blog.shared";
import { siteConfig } from "@/lib/site.config";

const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: siteConfig.seo.ogImageAlt
};

export function buildBlogPostMetadata(post: BlogPost): Metadata {
  const url = `${siteConfig.url}/blog/${post.slug}`;
  const postOgImage = post.ogImage ? `${siteConfig.url}${post.ogImage}` : undefined;
  const ogImage = postOgImage
    ? { url: postOgImage, alt: post.heroImageAlt ?? post.title }
    : DEFAULT_OG_IMAGE;
  const pageTitle = post.seoTitle ?? `${post.title} · ${siteConfig.name}`;

  return {
    title: {
      absolute: pageTitle
    },
    description: post.description,
    alternates: {
      canonical: url
    },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.publishedAt,
      authors: [post.author],
      images: [ogImage]
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [postOgImage ?? "/opengraph-image"]
    }
  };
}
