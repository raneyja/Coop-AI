import type { Metadata } from "next";
import type { BlogPost } from "@/lib/blog.shared";
import { siteConfig } from "@/lib/site.config";

export function buildBlogPostMetadata(post: BlogPost): Metadata {
  const url = `${siteConfig.url}/blog/${post.slug}`;
  const ogImage = post.ogImage ? `${siteConfig.url}${post.ogImage}` : undefined;
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
      ...(ogImage ? { images: [{ url: ogImage, alt: post.heroImageAlt ?? post.title }] } : {})
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      ...(ogImage ? { images: [ogImage] } : {})
    }
  };
}
