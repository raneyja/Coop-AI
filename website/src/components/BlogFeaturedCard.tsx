import Link from "next/link";
import type { BlogPostMeta } from "@/lib/blog.shared";
import { formatCategoryLabel, formatPostDateShort } from "@/lib/blog.shared";

type BlogFeaturedCardProps = {
  post: BlogPostMeta;
  large?: boolean;
};

export function BlogFeaturedCard({ post, large = false }: BlogFeaturedCardProps) {
  const aspectClass = large ? "aspect-[16/10]" : "aspect-[4/3]";

  return (
    <article className="group relative flex flex-col">
      <div
        className={`relative overflow-hidden border border-coop-border bg-gray-50 transition group-hover:border-gray-300 group-hover:bg-gray-100 ${aspectClass}`}
      >
        {post.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.heroImage}
            alt={post.heroImageAlt ?? post.title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-sm text-coop-muted">
          <span>{formatPostDateShort(post.publishedAt)}</span>
          <span className="mx-2 text-gray-300">·</span>
          <span className="text-gray-700">{formatCategoryLabel(post.category)}</span>
        </p>
        <h2
          className={`mt-2 font-semibold leading-snug tracking-tight text-gray-900 transition-colors group-hover:text-gray-600 ${
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
          <span className="mx-2 text-gray-300">·</span>
          {post.readTimeMinutes} min read
        </p>
      </div>
    </article>
  );
}
