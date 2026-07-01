import type {
  ChatInlineNode,
  ChatListItem,
  ChatParagraphBlock,
  ChatProseBlock,
  ChatProseDocument
} from "./chatProseTypes";

const SECTION_HEADING_RE = /^\*\*[^*\n]+\*\*\s*$/;
const CODE_FENCE_OPEN_RE = /^```/;
const LIST_ITEM_RE = /^(\s*)(- |\* |(\d+)\.\s)(.*)$/;
const CITATION_HEADER_RE = /^(\d+):(\d+):(.+)$/;
const INLINE_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const INLINE_URL_RE = /^https?:\/\/[^\s)]+/;
const INLINE_CODE_RE = /^`([^`\n]+)`/;
const INLINE_STRONG_RE = /^\*\*([^*\n]+)\*\*/;
const FILE_WITH_EXTENSION_RE = /^[^/\s]+\.[A-Za-z0-9._-]+(?::\d+)?$/;
const FILE_LINE_RE = /^(.*):(\d+)$/;

export function parseChatProse(content: string): ChatProseDocument {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: ChatProseBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }

    const codeBlock = tryParseCodeFence(lines, i);
    if (codeBlock) {
      blocks.push(codeBlock.block);
      i = codeBlock.nextIndex;
      continue;
    }

    if (isSectionHeading(lines[i])) {
      blocks.push({
        type: "section-heading",
        text: stripHeadingSyntax(lines[i])
      });
      i += 1;
      continue;
    }

    const listBlock = tryParseList(lines, i);
    if (listBlock) {
      blocks.push({ type: "list", items: listBlock.items });
      i = listBlock.nextIndex;
      continue;
    }

    const paragraph = parseParagraph(lines, i);
    blocks.push(paragraph.block);
    i = paragraph.nextIndex;
  }

  return { blocks };
}

function tryParseCodeFence(
  lines: string[],
  startIndex: number
): { block: ChatProseBlock; nextIndex: number } | null {
  const openingLine = lines[startIndex];
  if (!CODE_FENCE_OPEN_RE.test(openingLine)) {
    return null;
  }

  const language = openingLine.replace(/^```/, "").trim() || undefined;
  const body: string[] = [];
  let i = startIndex + 1;
  while (i < lines.length && !CODE_FENCE_OPEN_RE.test(lines[i])) {
    body.push(lines[i]);
    i += 1;
  }

  const nextIndex = i < lines.length ? i + 1 : i;
  const [firstBodyLine = "", ...rest] = body;
  const citationMatch = firstBodyLine.trim().match(CITATION_HEADER_RE);
  if (citationMatch) {
    const startLine = Number(citationMatch[1]);
    const endLine = Number(citationMatch[2]);
    const path = citationMatch[3].trim();
    return {
      block: {
        type: "code-citation",
        startLine,
        endLine,
        path,
        code: rest.join("\n")
      },
      nextIndex
    };
  }

  return {
    block: {
      type: "code-fence",
      language,
      code: body.join("\n")
    },
    nextIndex
  };
}

function tryParseList(
  lines: string[],
  startIndex: number
): { items: ChatListItem[]; nextIndex: number } | null {
  if (!isListLine(lines[startIndex])) {
    return null;
  }

  const items: ChatListItem[] = [];
  let i = startIndex;
  while (i < lines.length && isListLine(lines[i])) {
    const match = lines[i].match(LIST_ITEM_RE);
    if (!match) {
      break;
    }
    const markerToken = match[2].trim();
    const order = match[3] ? Number(match[3]) : undefined;
    const text = match[4] ?? "";
    items.push({
      marker: markerToken === "-" ? "-" : markerToken === "*" ? "*" : "ordered",
      order,
      content: parseInlineNodes(text.trim())
    });
    i += 1;
  }

  return { items, nextIndex: i };
}

function parseParagraph(
  lines: string[],
  startIndex: number
): { block: ChatParagraphBlock; nextIndex: number } {
  const parts: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      if (lines[i + 1] && lines[i + 1].trim() === "") {
        break;
      }
      parts.push("");
      i += 1;
      continue;
    }
    if (parts.length > 0 && (isSectionHeading(line) || isListLine(line) || CODE_FENCE_OPEN_RE.test(line))) {
      break;
    }
    parts.push(line);
    i += 1;
    if (i < lines.length && lines[i].trim() === "") {
      if (lines[i + 1] && lines[i + 1].trim() !== "") {
        break;
      }
    }
  }

  const text = parts.join("\n").trim();
  return {
    block: {
      type: "paragraph",
      content: parseInlineNodes(text)
    },
    nextIndex: i
  };
}

function parseInlineNodes(input: string): ChatInlineNode[] {
  if (!input) {
    return [{ type: "text", text: "" }];
  }

  const nodes: ChatInlineNode[] = [];
  let cursor = 0;
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer) {
      nodes.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  while (cursor < input.length) {
    const remaining = input.slice(cursor);

    const mdLinkMatch = remaining.match(INLINE_LINK_RE);
    if (mdLinkMatch) {
      flushText();
      nodes.push({
        type: "external-link",
        label: mdLinkMatch[1],
        url: mdLinkMatch[2]
      });
      cursor += mdLinkMatch[0].length;
      continue;
    }

    const bareUrlMatch = remaining.match(INLINE_URL_RE);
    if (bareUrlMatch) {
      flushText();
      const url = bareUrlMatch[0];
      nodes.push({
        type: "external-link",
        label: hostLabelFromUrl(url),
        url
      });
      cursor += url.length;
      continue;
    }

    const codeMatch = remaining.match(INLINE_CODE_RE);
    if (codeMatch) {
      flushText();
      nodes.push(asCodeOrFileLink(codeMatch[1]));
      cursor += codeMatch[0].length;
      continue;
    }

    const strongMatch = remaining.match(INLINE_STRONG_RE);
    if (strongMatch) {
      flushText();
      nodes.push({ type: "strong", text: strongMatch[1] });
      cursor += strongMatch[0].length;
      continue;
    }

    textBuffer += input[cursor];
    cursor += 1;
  }

  flushText();
  return mergeAdjacentTextNodes(nodes);
}

function asCodeOrFileLink(code: string): ChatInlineNode {
  const trimmed = code.trim();
  const fileLineMatch = trimmed.match(FILE_LINE_RE);
  if (fileLineMatch && looksLikeFilePath(fileLineMatch[1])) {
    return {
      type: "file-link",
      path: fileLineMatch[1],
      line: Number(fileLineMatch[2]),
      label: trimmed
    };
  }
  if (looksLikeFilePath(trimmed)) {
    return {
      type: "file-link",
      path: trimmed,
      label: trimmed
    };
  }
  return { type: "inline-code", code: trimmed };
}

function looksLikeFilePath(value: string): boolean {
  return value.includes("/") || FILE_WITH_EXTENSION_RE.test(value);
}

function mergeAdjacentTextNodes(nodes: ChatInlineNode[]): ChatInlineNode[] {
  if (nodes.length <= 1) {
    return nodes;
  }
  const merged: ChatInlineNode[] = [];
  for (const node of nodes) {
    const previous = merged[merged.length - 1];
    if (node.type === "text" && previous?.type === "text") {
      previous.text += node.text;
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function hostLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function isSectionHeading(line: string): boolean {
  if (!SECTION_HEADING_RE.test(line)) {
    return false;
  }
  const plain = stripHeadingSyntax(line);
  return !plain.endsWith(".");
}

function stripHeadingSyntax(line: string): string {
  return line.trim().replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
}

function isListLine(line: string): boolean {
  return LIST_ITEM_RE.test(line);
}
