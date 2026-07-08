export type DocsFigureItem = {
  alt: string;
  src: string;
  caption?: string;
};

export type DocsFigureSize = "sm";

export type DocsContentSegment =
  | { type: "markdown"; content: string }
  | { type: "figures"; items: DocsFigureItem[]; size?: DocsFigureSize };

const imageLineRe = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const captionLineRe = /^\*(.+)\*$/;

export function parseDocsFigures(block: string): DocsFigureItem[] {
  const items: DocsFigureItem[] = [];
  let pending: Partial<DocsFigureItem> | null = null;

  for (const line of block.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const imageMatch = trimmed.match(imageLineRe);
    if (imageMatch) {
      if (pending?.src) {
        items.push(pending as DocsFigureItem);
      }
      pending = { alt: imageMatch[1], src: imageMatch[2] };
      continue;
    }

    const captionMatch = trimmed.match(captionLineRe);
    if (captionMatch && pending) {
      pending.caption = captionMatch[1];
      items.push(pending as DocsFigureItem);
      pending = null;
    }
  }

  if (pending?.src) {
    items.push(pending as DocsFigureItem);
  }

  return items;
}

const figuresBlockRe = /<!--\s*figures(?:\s+([a-z]+))?\s*-->([\s\S]*?)<!--\s*\/figures\s*-->/g;

function parseFigureSize(token: string | undefined): DocsFigureSize | undefined {
  return token === "sm" ? "sm" : undefined;
}

export function splitDocsContent(content: string): DocsContentSegment[] {
  const segments: DocsContentSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(figuresBlockRe)) {
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push({ type: "markdown", content: content.slice(lastIndex, index) });
    }

    segments.push({
      type: "figures",
      items: parseDocsFigures(match[2]),
      size: parseFigureSize(match[1])
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "markdown", content: content.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: "markdown", content });
  }

  return segments;
}
