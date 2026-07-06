import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  estimateReadTime,
  normalizeCategory,
  type BlogPost,
  type BlogPostMeta
} from "@/lib/blog.shared";

export {
  blogCategories,
  estimateReadTime,
  formatCategoryLabel,
  formatPostDate,
  formatPostDateShort,
  normalizeCategory,
  type BlogCategory,
  type BlogPost,
  type BlogPostMeta
} from "@/lib/blog.shared";

const postsDirectory = path.join(process.cwd(), "content/blog");

function readPostFile(filename: string): BlogPost {
  const filePath = path.join(postsDirectory, filename);
  const fileContents = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(fileContents);
  const slug = filename.replace(/\.md$/, "");
  const category = normalizeCategory(data.category);

  const heroImage = data.heroImage ? String(data.heroImage) : undefined;

  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ""),
    seoTitle: data.seoTitle ? String(data.seoTitle) : undefined,
    publishedAt: String(data.publishedAt ?? ""),
    author: String(data.author ?? "CoopAI"),
    category,
    readTimeMinutes: estimateReadTime(content),
    featured: data.featured !== false,
    quote: data.quote ? String(data.quote) : undefined,
    heroImage,
    heroImageAlt: data.heroImageAlt ? String(data.heroImageAlt) : undefined,
    ogImage: data.ogImage ? String(data.ogImage) : heroImage,
    draft: Boolean(data.draft),
    content
  };
}

export function getAllPosts(includeDrafts = false): BlogPostMeta[] {
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(postsDirectory)
    .filter((filename) => filename.endsWith(".md"))
    .map((filename) => {
      const post = readPostFile(filename);
      return {
        slug: post.slug,
        title: post.title,
        description: post.description,
        seoTitle: post.seoTitle,
        publishedAt: post.publishedAt,
        author: post.author,
        category: post.category,
        readTimeMinutes: post.readTimeMinutes,
        featured: post.featured,
        quote: post.quote,
        heroImage: post.heroImage,
        heroImageAlt: post.heroImageAlt,
        ogImage: post.ogImage,
        draft: post.draft
      };
    })
    .filter((post) => includeDrafts || !post.draft)
    .sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  const filePath = path.join(postsDirectory, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const post = readPostFile(`${slug}.md`);
  if (post.draft && process.env.NODE_ENV === "production") {
    return undefined;
  }

  return post;
}

export function getFeaturedPosts(limit = 4): BlogPostMeta[] {
  return getAllPosts()
    .filter((post) => post.featured !== false)
    .slice(0, limit);
}

export function getHighlightedQuote(): { text: string; sourceTitle: string; sourceSlug: string } | undefined {
  const post = getAllPosts().find((entry) => entry.quote);
  if (!post?.quote) {
    return undefined;
  }

  return {
    text: post.quote,
    sourceTitle: post.title,
    sourceSlug: post.slug
  };
}
