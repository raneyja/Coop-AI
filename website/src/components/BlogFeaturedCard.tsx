import Link from "next/link";
import type { BlogPostMeta } from "@/lib/blog.shared";
import { formatCategoryLabel, formatPostDateShort } from "@/lib/blog.shared";

type BlogFeaturedCardProps = {
  post: BlogPostMeta;
  large?: boolean;
};

export function BlogFeaturedCard({ post, large = false }: BlogFeaturedCardProps) {
  return (
    <article className="group relative flex flex-col">
      <div
        className={`border border-white/10 bg-coop-surface/40 transition group-hover:border-white/20 group-hover:bg-coop-surface/60 ${
          large ? "aspect-[16/10]" : "aspect-[4/3]"
        }`}
        aria-hidden
      />

      <div className="mt-4">
        <p className="text-sm text-coop-muted">
          <span>{formatPostDateShort(post.publishedAt)}</span>
          <span className="mx-2 text-white/20">·</span>
          <span className="text-coop-accent">{formatCategoryLabel(post.category)}</span>
        </p>
        <h2
          className={`mt-2 font-semibold leading-snug tracking-tight text-white transition-colors group-hover:text-coop-accent ${
            large ? "text-3xl md:text-4xl" : "text-xl"
          }`}
        >
          <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0">
            {post.title}
          </Link>
        </h2>
        <p
          className={`mt-2 leading-relaxed text-coop-muted ${
            large ? "line-clamp-3 text-base" : "line-clamp-2 text-sm"
          }`}
        >
          {post.description}
        </p>
        <p className="relative mt-4 text-sm text-coop-muted">
          {post.author}
          <span className="mx-2 text-white/20">·</span>
          {post.readTimeMinutes} min read
        </p>
      </div>
    </article>
  );
}
