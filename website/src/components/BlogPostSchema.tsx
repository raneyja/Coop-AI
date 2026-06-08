import { siteConfig } from "@/lib/site.config";
import type { BlogPost } from "@/lib/blog.shared";

type BlogPostSchemaProps = {
  post: BlogPost;
};

export function BlogPostSchema({ post }: BlogPostSchemaProps) {
  const url = `${siteConfig.url}/blog/${post.slug}`;
  const image = post.ogImage ? `${siteConfig.url}${post.ogImage}` : undefined;

  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    author: {
      "@type": "Organization",
      name: post.author
    },
    publisher: {
      "@type": "Organization",
      name: post.author,
      url: siteConfig.url
    },
    datePublished: post.publishedAt,
    ...(image ? { image } : {}),
    url
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
