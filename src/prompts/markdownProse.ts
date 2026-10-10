export type MarkdownBlock = { kind: "prose"; text: string } | {
  kind: "code"; text: string; closed: boolean; info: string; body: string; fence: string;
};

/** Keep fenced source opaque to narrative formatting, including unfinished fences. */
export function splitMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm;
  let offset = 0;
  for (let match = opening.exec(content); match; match = opening.exec(content)) {
    if (match[1][0] === "`" && match[2].includes("`")) continue;
    const closing = new RegExp(`^ {0,3}${match[1][0]}{${match[1].length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(content);
    const endOffset = end ? closing.lastIndex : content.length;
    if (match.index > offset) blocks.push({ kind: "prose", text: content.slice(offset, match.index) });
    blocks.push({ kind: "code", text: content.slice(match.index, endOffset), closed: Boolean(end), fence: match[1],
      info: match[2].trim(), body: content.slice(opening.lastIndex, end?.index ?? content.length) });
    offset = endOffset;
    opening.lastIndex = endOffset;
    if (!end) break;
  }
  if (offset < content.length) blocks.push({ kind: "prose", text: content.slice(offset) });
  return blocks;
}

export function mapMarkdownProse(content: string, transform: (prose: string) => string): string {
  const blocks = splitMarkdownBlocks(content);
  return blocks.map((block, index) => {
    if (block.kind === "code") return block.text;
    const prose = transform(block.text);
    // Keep a following opening fence at a line boundary after prose removal.
    return blocks[index + 1]?.kind === "code" && prose && !prose.endsWith("\n") ? prose + "\n" : prose;
  }).join("");
}

export function trimMarkdownProse(content: string): string {
  const blocks = splitMarkdownBlocks(content);
  if (blocks[0]?.kind === "prose") blocks[0].text = blocks[0].text.trimStart();
  const last = blocks.at(-1);
  if (last?.kind === "prose") last.text = last.text.trimEnd();
  return blocks.map(block => block.text).join("");
}

export function collapseProseBlankLines(content: string): string {
  return trimMarkdownProse(mapMarkdownProse(content, prose => prose.replace(/\n{3,}/g, "\n\n")));
}
