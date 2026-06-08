"use client";

import { useMemo, useState } from "react";
import type { BlogCategory, BlogPostMeta } from "@/lib/blog.shared";
import { blogCategories, formatCategoryLabel } from "@/lib/blog.shared";
import { BlogFeaturedCard } from "@/components/BlogFeaturedCard";
import { BlogPostRow } from "@/components/BlogPostRow";

type BlogFilter = "all" | BlogCategory;

type BlogIndexProps = {
  featuredPosts: BlogPostMeta[];
  posts: BlogPostMeta[];
};

const filters: BlogFilter[] = ["all", ...blogCategories];

export function BlogIndex({ featuredPosts, posts }: BlogIndexProps) {
  const [activeFilter, setActiveFilter] = useState<BlogFilter>("all");
  const [visibleCount, setVisibleCount] = useState(12);

  const filteredPosts = useMemo(() => {
    if (activeFilter === "all") {
      return posts;
    }
    return posts.filter((post) => post.category === activeFilter);
  }, [activeFilter, posts]);

  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  return (
    <>
      {featuredPosts.length > 0 && (
        <section className="border-b border-white/5 py-12 md:py-16">
          <div className="mx-auto max-w-6xl px-6">
            {featuredPosts.length === 1 ? (
              <div className="max-w-3xl">
                <BlogFeaturedCard post={featuredPosts[0]} large />
              </div>
            ) : (
              <div className="grid gap-8 lg:grid-cols-[2fr_1fr] lg:gap-10">
                <BlogFeaturedCard post={featuredPosts[0]} large />
                <div className="flex flex-col gap-8">
                  {featuredPosts.slice(1, 4).map((post) => (
                    <BlogFeaturedCard key={post.slug} post={post} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="border-b border-white/5 py-10 md:py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col gap-4 border border-white/10 bg-coop-surface/30 px-6 py-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-coop-accent">Stay in the loop</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                Product updates from the CoopAI team
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-coop-muted">
                We share launch notes, engineering deep dives, and how teams use code intelligence in
                production.
              </p>
            </div>
            <a
              href="mailto:hello@coop-ai.dev?subject=CoopAI%20blog%20updates"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white px-5 py-2.5 text-sm font-medium text-coop-dark transition hover:bg-white/90"
            >
              Get updates →
            </a>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">Blog</h1>

            <div className="flex flex-wrap gap-2">
              {filters.map((filter) => {
                const isActive = activeFilter === filter;
                const label = filter === "all" ? "All" : formatCategoryLabel(filter);

                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => {
                      setActiveFilter(filter);
                      setVisibleCount(12);
                    }}
                    className={`rounded-full px-4 py-1.5 text-sm transition ${
                      isActive
                        ? "bg-white text-coop-dark"
                        : "border border-white/10 text-coop-muted hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {visiblePosts.length === 0 ? (
            <p className="mt-12 text-coop-muted">No posts in this category yet.</p>
          ) : (
            <div className="mt-8 divide-y divide-white/10 border-t border-white/10">
              {visiblePosts.map((post) => (
                <BlogPostRow key={post.slug} post={post} />
              ))}
            </div>
          )}

          {hasMore && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + 12)}
                className="text-sm font-medium text-coop-accent transition hover:text-white"
              >
                View more ↓
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
