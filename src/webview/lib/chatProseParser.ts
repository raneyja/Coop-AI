import type {
  ChatInlineNode,
  ChatJiraTicket,
  ChatListItem,
  ChatParagraphBlock,
  ChatProseBlock,
  ChatProseDocument
} from "./chatProseTypes";
import { isCoopMainSection } from "./coopChatSections";
import {
  isKgFieldLabelText,
  normalizeCoopChatProse,
  normalizeKgFieldLabel
} from "./normalizeKnowledgeGapProse";

const SECTION_HEADING_RE = /^\*\*[^*\n]+\*\*\s*$/;
const MARKDOWN_HEADING_RE = /^#{1,6}\s+.+/;
const CODE_FENCE_OPEN_RE = /^```/;
const LIST_ITEM_RE = /^(\s*)(- |\* |(\d+)\.\s)(.*)$/;
const CITATION_HEADER_RE = /^(\d+):(\d+):(.+)$/;
const INLINE_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const INLINE_URL_RE = /^https?:\/\/[^\s)]+/;
const INLINE_CODE_RE = /^`([^`\n]+)`/;
const INLINE_STRONG_RE = /^\*\*([^*\n]+)\*\*/;
const INLINE_EM_RE = /^\*([^*\n]+)\*/;
const FILE_WITH_EXTENSION_RE = /^[^/\s]+\.[A-Za-z0-9._-]+(?::\d+)?$/;
const FILE_LINE_RE = /^(.*):(\d+)$/;

const JIRA_TICKET_LINK_LINE_RE = /^\[([A-Z][A-Z0-9]+-\d+)\]\((https?:\/\/[^)]+)\)\s*$/;
const JIRA_FIELD_LINE_RE = /^([A-Za-z][A-Za-z ]*):\s*(.+)$/;

export function parseChatProse(content: string): ChatProseDocument {
  const normalized = normalizeCoopChatProse(
    normalizeJiraTicketBreaks(content.replace(/\r\n/g, "\n"))
  );
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
      const text = stripHeadingSyntax(lines[i]);
      blocks.push({
        type: "section-heading",
        text,
        headingLevel: resolveHeadingLevel(text, blocks)
      });
      i += 1;
      continue;
    }

    const knowledgeGapList = tryParseKnowledgeGapGroupedList(lines, i);
    if (knowledgeGapList) {
      blocks.push(...knowledgeGapList.blocks);
      i = knowledgeGapList.nextIndex;
      continue;
    }

    const listBlock = tryParseList(lines, i);
    if (listBlock) {
      blocks.push({ type: "list", items: listBlock.items });
      i = listBlock.nextIndex;
      continue;
    }

    const jiraStack = tryParseJiraTicketStack(lines, i);
    if (jiraStack) {
      blocks.push(jiraStack.block);
      i = jiraStack.nextIndex;
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

function hasGroupedSubsections(blocks: ChatProseBlock[]): boolean {
  return blocks.some(
    (block) => block.type === "list" && block.items.some((item) => isKgFieldListItem(item.content))
  );
}

function resolveHeadingLevel(text: string, blocks: ChatProseBlock[]): 1 | 2 {
  const lower = text.toLowerCase();
  if (isCoopMainSection(lower) || lower.startsWith("key unknowns")) {
    return 1;
  }
  const hasMainHeading = blocks.some(
    (block) => block.type === "section-heading" && block.headingLevel === 1
  );
  if (hasMainHeading || hasGroupedSubsections(blocks)) {
    return 2;
  }
  return 1;
}

function isKgFieldListItem(content: ChatInlineNode[]): boolean {
  const first = content[0];
  return first?.type === "strong" && isKgFieldLabelText(first.text);
}

function isKgCategoryListItem(content: ChatInlineNode[]): boolean {
  if (content.length !== 1 || content[0]?.type !== "strong") {
    return false;
  }
  const text = content[0].text;
  if (isKgFieldLabelText(text)) {
    return false;
  }
  if (isCoopMainSection(text)) {
    return false;
  }
  return !text.endsWith("?");
}

function normalizeKgFieldListItem(item: ChatListItem): ChatListItem {
  const content = [...item.content];
  const first = content[0];
  if (first?.type === "strong" && isKgFieldLabelText(first.text)) {
    content[0] = { type: "strong", text: `${normalizeKgFieldLabel(first.text)}:` };
  }
  return { ...item, content };
}

function tryParseKnowledgeGapGroupedList(
  lines: string[],
  startIndex: number
): { blocks: ChatProseBlock[]; nextIndex: number } | null {
  const parsed = tryParseList(lines, startIndex);
  if (!parsed) {
    return null;
  }

  const categoryItems = parsed.items.filter((item) => isKgCategoryListItem(item.content));
  const fieldItems = parsed.items.filter((item) => isKgFieldListItem(item.content));
  if (categoryItems.length === 0 || fieldItems.length < 2) {
    return null;
  }

  const blocks: ChatProseBlock[] = [];
  let pendingFields: ChatListItem[] = [];

  const flushFields = () => {
    if (pendingFields.length === 0) {
      return;
    }
    blocks.push({ type: "list", items: pendingFields });
    pendingFields = [];
  };

  for (const item of parsed.items) {
    if (isKgCategoryListItem(item.content)) {
      flushFields();
      const title = item.content[0]!.type === "strong" ? item.content[0].text : "";
      blocks.push({
        type: "section-heading",
        text: title,
        headingLevel: isCoopMainSection(title) ? 1 : 2
      });
      continue;
    }
    if (isKgFieldListItem(item.content)) {
      pendingFields.push(normalizeKgFieldListItem(item));
      continue;
    }
    flushFields();
    blocks.push({ type: "list", items: [item] });
  }
  flushFields();

  return { blocks, nextIndex: parsed.nextIndex };
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
    if (
      parts.length > 0 &&
      (isSectionHeading(line) || isListLine(line) || CODE_FENCE_OPEN_RE.test(line) || isJiraTicketStartLine(line))
    ) {
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

    const emMatch = remaining.match(INLINE_EM_RE);
    if (emMatch) {
      flushText();
      nodes.push({ type: "em", text: emMatch[1] });
      cursor += emMatch[0].length;
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

const FIELD_LABEL_HEADING_RE =
  /^(open question|what to check|question|evidence needed|unknown|risk|owner|answer|status|impact|confidence|note|priority|type|source)s?:$/i;

function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!SECTION_HEADING_RE.test(trimmed) && !MARKDOWN_HEADING_RE.test(trimmed)) {
    return false;
  }
  const plain = stripHeadingSyntax(trimmed);
  if (plain.endsWith(".")) {
    return false;
  }
  if (FIELD_LABEL_HEADING_RE.test(plain)) {
    return false;
  }
  if (plain.endsWith(":") && plain.length <= 60) {
    return false;
  }
  return true;
}

function stripHeadingSyntax(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .trim();
}

function isListLine(line: string): boolean {
  return LIST_ITEM_RE.test(line);
}

/** Insert paragraph breaks before Jira ticket link lines so stacked tickets don't merge. */
export function normalizeJiraTicketBreaks(content: string): string {
  return content.replace(/\n(?=\[[A-Z][A-Z0-9]+-\d+\]\(https?:\/\/)/g, "\n\n");
}

function isJiraTicketStartLine(line: string): boolean {
  return JIRA_TICKET_LINK_LINE_RE.test(line.trim());
}

function tryParseJiraTicketStack(
  lines: string[],
  startIndex: number
): { block: ChatProseBlock; nextIndex: number } | null {
  if (!isJiraTicketStartLine(lines[startIndex] ?? "")) {
    return null;
  }

  const tickets: ChatJiraTicket[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const trimmed = lines[i]?.trim() ?? "";
    if (trimmed === "") {
      const next = lines[i + 1]?.trim() ?? "";
      if (isJiraTicketStartLine(next)) {
        i += 1;
        continue;
      }
      break;
    }
    if (!isJiraTicketStartLine(lines[i] ?? "")) {
      break;
    }
    const parsed = parseJiraTicket(lines, i);
    if (!parsed) {
      break;
    }
    tickets.push(parsed.ticket);
    i = parsed.nextIndex;
  }

  if (tickets.length === 0) {
    return null;
  }

  return {
    block: { type: "jira-ticket-stack", tickets },
    nextIndex: i
  };
}

function parseJiraTicket(
  lines: string[],
  startIndex: number
): { ticket: ChatJiraTicket; nextIndex: number } | null {
  const linkLine = lines[startIndex]?.trim() ?? "";
  const linkMatch = linkLine.match(JIRA_TICKET_LINK_LINE_RE);
  if (!linkMatch) {
    return null;
  }

  const ticket: ChatJiraTicket = {
    key: linkMatch[1],
    url: linkMatch[2],
    fields: []
  };

  let i = startIndex + 1;
  while (i < lines.length) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed) {
      break;
    }
    if (isJiraTicketStartLine(trimmed)) {
      break;
    }

    const fieldMatch = trimmed.match(JIRA_FIELD_LINE_RE);
    if (fieldMatch) {
      const label = fieldMatch[1].trim();
      const value = fieldMatch[2].trim();
      if (/^summary$/i.test(label)) {
        ticket.summary = value;
      } else {
        ticket.fields.push({ label, value });
      }
    }
    i += 1;
  }

  return { ticket, nextIndex: i };
}
