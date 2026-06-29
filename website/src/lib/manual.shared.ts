export type ManualTocEntry = {
  id: string;
  title: string;
  depth: 2 | 3;
};

export type ManualContent = {
  title: string;
  description: string;
  lastUpdated: string;
  content: string;
  toc: ManualTocEntry[];
};

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function extractToc(markdown: string): ManualTocEntry[] {
  const entries: ManualTocEntry[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) {
      continue;
    }

    const depth = match[1].length as 2 | 3;
    const title = match[2].replace(/\{#.+\}$/, "").trim();
    entries.push({ id: slugifyHeading(title), title, depth });
  }

  return entries;
}
