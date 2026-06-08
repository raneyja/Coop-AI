export const blogCategories = ["product", "engineering", "company", "ideas"] as const;
export type BlogCategory = (typeof blogCategories)[number];

export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  seoTitle?: string;
  publishedAt: string;
  author: string;
  category: BlogCategory;
  readTimeMinutes: number;
  featured?: boolean;
  quote?: string;
  heroImage?: string;
  heroImageAlt?: string;
  ogImage?: string;
  waitlistUrl?: string;
  draft?: boolean;
};

export type BlogPost = BlogPostMeta & {
  content: string;
};

export function estimateReadTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function normalizeCategory(value: unknown): BlogCategory {
  const raw = String(value ?? "product").toLowerCase();
  if (raw === "research") {
    return "engineering";
  }
  return blogCategories.includes(raw as BlogCategory) ? (raw as BlogCategory) : "product";
}

export function formatPostDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
}

export function formatPostDateShort(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

export function formatCategoryLabel(category: BlogCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
