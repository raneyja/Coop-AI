export type DocsNavEntry = {
  slug: string;
  title: string;
  section: string;
  order: number;
  description?: string;
};

export type DocsPage = DocsNavEntry & {
  content: string;
  lastUpdated?: string;
};

export type DocsSection = {
  id: string;
  title: string;
  pages: DocsNavEntry[];
};

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export const docsSections: { id: string; title: string }[] = [
  { id: "start", title: "Getting started" },
  { id: "extension", title: "Extension" },
  { id: "admin", title: "Admin portal" },
  { id: "integrations", title: "Integrations" },
  { id: "plans", title: "Plans & billing" },
  { id: "api", title: "API reference" },
  { id: "enterprise", title: "Enterprise" },
  { id: "help", title: "Help" }
];

export function buildDocsNav(pages: DocsNavEntry[]): DocsSection[] {
  const bySection = new Map<string, DocsNavEntry[]>();

  for (const page of pages) {
    const list = bySection.get(page.section) ?? [];
    list.push(page);
    bySection.set(page.section, list);
  }

  return docsSections
    .map((section) => ({
      id: section.id,
      title: section.title,
      pages: (bySection.get(section.id) ?? []).sort((a, b) => a.order - b.order)
    }))
    .filter((section) => section.pages.length > 0);
}
