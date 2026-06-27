import type { Metadata } from "next";
import { BlogIndex } from "@/components/BlogIndex";
import { BlogQuoteHighlight } from "@/components/BlogQuoteHighlight";
import { CTASection } from "@/components/CTASection";
import { getAllPosts, getFeaturedPosts, getHighlightedQuote } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Latest thinking from CoopAI on code intelligence, context aggregation, and SDLC tooling.",
  openGraph: {
    description:
      "Read CoopAI's latest perspectives on team code intelligence and organizational context."
  },
  twitter: {
    description:
      "Read CoopAI's latest perspectives on team code intelligence and organizational context."
  }
};

export default function BlogPage() {
  const posts = getAllPosts();
  const featuredPosts = getFeaturedPosts();
  const quote = getHighlightedQuote();

  return (
    <>
      <BlogIndex featuredPosts={featuredPosts} posts={posts} />

      {quote && (
        <BlogQuoteHighlight
          text={quote.text}
          sourceTitle={quote.sourceTitle}
          sourceSlug={quote.sourceSlug}
        />
      )}

      <CTASection
        title="See CoopAI on your codebase"
        description="Book a demo with our team and see how zero-clone code intelligence works inside VS Code."
      />
    </>
  );
}
