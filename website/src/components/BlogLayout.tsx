import Link from "next/link";
import type { ReactNode } from "react";
import type { BlogCategory } from "@/lib/blog.shared";
import { formatCategoryLabel, formatPostDateShort } from "@/lib/blog.shared";

type BlogLayoutProps = {
  title: string;
  publishedAt: string;
  author: string;
  category: BlogCategory;
  readTimeMinutes: number;
  heroImage?: string;
  heroImageAlt?: string;
  children: ReactNode;
};

export function BlogLayout({
  title,
  publishedAt,
  author,
  category,
  readTimeMinutes,
  heroImage,
  heroImageAlt,
  children
}: BlogLayoutProps) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 md:py-20">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-sm text-coop-muted transition-colors hover:text-gray-900"
      >
        <span aria-hidden>←</span> All posts
      </Link>

        {heroImage && (
        <div className="relative mt-8 aspect-[16/10] w-full overflow-hidden border border-coop-border bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImage}
            alt={heroImageAlt ?? title}
            className="h-full w-full object-cover"
            fetchPriority="high"
          />
        </div>
      )}

      <header className={`border-b border-coop-border pb-10 ${heroImage ? "mt-8" : "mt-8"}`}>
        <p className="text-sm text-coop-muted">
          <span>{formatPostDateShort(publishedAt)}</span>
          <span className="mx-2 text-gray-300">·</span>
          <span className="text-gray-700">{formatCategoryLabel(category)}</span>
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-gray-900 md:text-5xl">{title}</h1>
        <p className="mt-6 text-sm text-coop-muted">
          {author}
          <span className="mx-2 text-gray-300">·</span>
          {readTimeMinutes} min read
        </p>
      </header>

      <div className="prose prose-lg prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-gray-900 prose-a:text-gray-900 prose-code:text-gray-800 prose-img:my-10 prose-img:border prose-img:border-gray-200 max-w-none pt-10">
        {children}
      </div>
    </article>
  );
}
