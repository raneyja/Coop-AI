import Link from "next/link";
import type { BlogPostMeta } from "@/lib/blog.shared";
import { formatCategoryLabel, formatPostDateShort } from "@/lib/blog.shared";

type BlogPostRowProps = {
  post: BlogPostMeta;
};

export function BlogPostRow({ post }: BlogPostRowProps) {
  return (
    <article className="group relative grid gap-3 py-6 transition first:pt-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8">
      <div>
        <p className="text-sm text-coop-muted">
          <span>{formatPostDateShort(post.publishedAt)}</span>
          <span className="mx-2 text-white/20">·</span>
          <span className="capitalize text-coop-accent">{formatCategoryLabel(post.category)}</span>
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white transition-colors group-hover:text-coop-accent md:text-2xl">
          <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0">
            {post.title}
          </Link>
        </h2>
      </div>

      <p className="text-sm text-coop-muted md:text-right">
        {post.author}
        <span className="mx-2 text-white/20">·</span>
        {post.readTimeMinutes} min read
      </p>
    </article>
  );
}
