import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogLayout } from "@/components/BlogLayout";
import { BlogMarkdown } from "@/components/BlogMarkdown";
import { BlogPostSchema } from "@/components/BlogPostSchema";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { buildBlogPostMetadata } from "@/lib/blogMetadata";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return { title: "Post not found" };
  }

  return buildBlogPostMetadata(post);
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return (
    <>
      <BlogPostSchema post={post} />
      <BlogLayout
        title={post.title}
        publishedAt={post.publishedAt}
        author={post.author}
        category={post.category}
        readTimeMinutes={post.readTimeMinutes}
        heroImage={post.heroImage}
        heroImageAlt={post.heroImageAlt}
      >
        <BlogMarkdown content={post.content} />
      </BlogLayout>
    </>
  );
}
