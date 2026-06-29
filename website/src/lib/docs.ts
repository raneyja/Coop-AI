import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  buildDocsNav,
  type DocsNavEntry,
  type DocsPage,
  type DocsSection
} from "@/lib/docs.shared";

const docsDirectory = path.join(process.cwd(), "content/docs");

function readDocFile(filename: string): DocsPage {
  const filePath = path.join(docsDirectory, filename);
  const fileContents = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(fileContents);
  const slug = filename.replace(/\.md$/, "");

  return {
    slug,
    title: String(data.title ?? slug),
    description: data.description ? String(data.description) : undefined,
    section: String(data.section ?? "start"),
    order: Number(data.order ?? 99),
    lastUpdated: data.lastUpdated ? String(data.lastUpdated) : undefined,
    content
  };
}

export function getAllDocs(): DocsPage[] {
  if (!fs.existsSync(docsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(docsDirectory)
    .filter((filename) => filename.endsWith(".md"))
    .map((filename) => readDocFile(filename))
    .sort((a, b) => {
      if (a.section !== b.section) {
        return a.section.localeCompare(b.section);
      }
      return a.order - b.order;
    });
}

export function getDocNav(): DocsNavEntry[] {
  return getAllDocs().map(({ slug, title, section, order, description }) => ({
    slug,
    title,
    section,
    order,
    description
  }));
}

export function getDocsSections(): DocsSection[] {
  return buildDocsNav(getDocNav());
}

export function getDocBySlug(slug: string): DocsPage | undefined {
  const filePath = path.join(docsDirectory, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return readDocFile(`${slug}.md`);
}

export function getAdjacentDocs(slug: string): { prev?: DocsNavEntry; next?: DocsNavEntry } {
  const nav = getDocNav();
  const index = nav.findIndex((entry) => entry.slug === slug);
  if (index === -1) {
    return {};
  }

  return {
    prev: index > 0 ? nav[index - 1] : undefined,
    next: index < nav.length - 1 ? nav[index + 1] : undefined
  };
}
