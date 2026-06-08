import Image from "next/image";
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
        className="inline-flex items-center gap-1.5 text-sm text-coop-muted transition-colors hover:text-white"
      >
        <span aria-hidden>←</span> All posts
      </Link>

      {heroImage && (
        <div className="relative mt-8 aspect-[16/10] w-full overflow-hidden border border-white/10 bg-coop-surface/40">
          <Image
            src={heroImage}
            alt={heroImageAlt ?? title}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
        </div>
      )}

      <header className={`border-b border-white/10 pb-10 ${heroImage ? "mt-8" : "mt-8"}`}>
        <p className="text-sm text-coop-muted">
          <span>{formatPostDateShort(publishedAt)}</span>
          <span className="mx-2 text-white/20">·</span>
          <span className="text-coop-accent">{formatCategoryLabel(category)}</span>
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white md:text-5xl">{title}</h1>
        <p className="mt-6 text-sm text-coop-muted">
          {author}
          <span className="mx-2 text-white/20">·</span>
          {readTimeMinutes} min read
        </p>
      </header>

      <div className="prose prose-lg prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-coop-accent prose-code:text-coop-accent prose-img:my-10 prose-img:border prose-img:border-white/10 max-w-none pt-10">
        {children}
      </div>
    </article>
  );
}
