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
import {
  isSourceCitationLabel,
  normalizeSourceCitationLabel,
  sourceCitationSlug
} from "../../prompts/sourceCitationRegistry";
import {
  findCitationNearFence,
  isOrdinaryLanguageTag,
  isUnfencedCitationStartLine,
  locatorFromProseLine,
  resolveCitePathForLanguageFence,
  shouldNeverUpgradeLanguageFence,
  tryParseCitationLocator,
  tryParseFenceInfoLocator,
  type CodeCitationLocator
} from "./codeCitationLocator";

const SECTION_HEADING_RE = /^\*\*[^*\n]+\*\*\s*$/;
const MARKDOWN_HEADING_RE = /^#{1,6}\s+.+/;
const CODE_FENCE_LINE_RE = /^(\s*)```(.*)$/;
const LIST_ITEM_RE = /^(\s*)(- |\* |(\d+)\.\s)(.*)$/;
const INLINE_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const COOP_EVIDENCE_LINK_RE = /^\[([^\]]+)\]\(coop-evidence:\)/;
const INLINE_URL_RE = /^https?:\/\/[^\s)]+/;
const INLINE_SOURCE_CITATION_RE = /^\[Sources:\s*.+?\]/i;
const INLINE_CODE_RE = /^`([^`\n]+)`/;
const INLINE_STRONG_RE = /^\*\*([^*\n]+)\*\*/;
const INLINE_EM_RE = /^\*([^*\n]+)\*/;
const FILE_WITH_EXTENSION_RE = /^[^/\s]+\.[A-Za-z0-9._-]+(?::\d+)?$/;
const FILE_LINE_RE = /^(.*):(\d+)$/;

const JIRA_TICKET_LINK_LINE_RE = /^\[([A-Z][A-Z0-9]+-\d+)\]\((https?:\/\/[^)]+)\)\s*$/;
const JIRA_FIELD_LINE_RE = /^([A-Za-z][A-Za-z ]*):\s*(.+)$/;

export type ParseChatProseOptions = {
  /**
   * When the model dumps a language-tagged fence for the open file instead of a
   * citation locator, upgrade it to the cite surface so chrome stays IDE-native.
   */
  activeFilePath?: string;
};

export function parseChatProse(content: string, options?: ParseChatProseOptions): ChatProseDocument {
  const normalized = normalizeCoopChatProse(
    normalizeJiraTicketBreaks(content.replace(/\r\n/g, "\n"))
  );
  const lines = normalized.split("\n");
  const blocks: ChatProseBlock[] = [];
  let i = 0;

  const advance = (next: number): number => (next > i ? next : i + 1);

  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }

    const codeBlock = tryParseCodeFence(lines, i, options);
    if (codeBlock) {
      if (codeBlock.skip) {
        i = advance(codeBlock.nextIndex);
        continue;
      }
      blocks.push(codeBlock.block);
      i = advance(codeBlock.nextIndex);
      continue;
    }

    const bareCitation = tryParseBareCitation(lines, i, options);
    if (bareCitation) {
      blocks.push(bareCitation.block);
      i = advance(bareCitation.nextIndex);
      continue;
    }

    if (isSectionHeading(lines[i], nextNonEmptyLine(lines, i + 1))) {
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
      i = advance(knowledgeGapList.nextIndex);
      continue;
    }

    const listBlock = tryParseList(lines, i);
    if (listBlock) {
      blocks.push({ type: "list", items: listBlock.items });
      i = advance(listBlock.nextIndex);
      continue;
    }

    const jiraStack = tryParseJiraTicketStack(lines, i);
    if (jiraStack) {
      blocks.push(jiraStack.block);
      i = advance(jiraStack.nextIndex);
      continue;
    }

    const paragraph = parseParagraph(lines, i);
    blocks.push(paragraph.block);
    i = advance(paragraph.nextIndex);
  }

  return { blocks };
}

function citationBlockFromLocator(
  locator: NonNullable<ReturnType<typeof tryParseCitationLocator>>,
  code: string
): ChatProseBlock {
  return {
    type: "code-citation",
    startLine: locator.startLine,
    endLine: locator.endLine,
    path: locator.path,
    code
  };
}

function stripFenceIndent(line: string, indentLen: number): string {
  if (indentLen <= 0) {
    return line;
  }
  let stripped = 0;
  let result = line;
  while (stripped < indentLen && (result.startsWith(" ") || result.startsWith("\t"))) {
    result = result.slice(1);
    stripped += 1;
  }
  return result;
}

function stripCommonIndent(body: string[]): string[] {
  const indents = body
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^[ \t]*/)?.[0]?.length ?? 0);
  if (indents.length === 0) {
    return body;
  }
  const min = Math.min(...indents);
  if (min <= 0) {
    return body;
  }
  return body.map((line) => (line.trim() === "" ? line : line.slice(min)));
}

function locatorInFenceBody(
  body: string[]
): { locator: NonNullable<ReturnType<typeof tryParseCitationLocator>>; codeStart: number } | null {
  const limit = Math.min(body.length, 6);
  for (let i = 0; i < limit; i++) {
    const line = body[i] ?? "";
    const locator = locatorFromProseLine(line) ?? tryParseCitationLocator(line.trim());
    if (locator) {
      return { locator, codeStart: i + 1 };
    }
  }
  return null;
}

function looksLikeCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (
    /^(export |import |from |const |let |var |function |class |def |async |await |return |if \(|for \(|while \(|type |interface |enum |package |using |struct |public |private |protected )/.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^[{}\]<>]/.test(trimmed) || trimmed.startsWith("</")) {
    return true;
  }
  if (trimmed.includes("=>") || trimmed.includes("::")) {
    return true;
  }
  if (/[;{}()=]/.test(trimmed) && !/^[A-Z][^.]*[.?!]$/.test(trimmed)) {
    return true;
  }
  return /^[ \t]{2,}/.test(line);
}

function mergeLocatorIntoCodeBlock(
  locator: CodeCitationLocator,
  block: ChatProseBlock
): ChatProseBlock {
  if (block.type === "code-citation") {
    if (block.startLine != null) {
      return block;
    }
    return {
      ...block,
      path: block.path || locator.path,
      startLine: locator.startLine,
      endLine: locator.endLine
    };
  }
  if (block.type === "code-fence") {
    return citationBlockFromLocator(locator, block.code);
  }
  return block;
}

function isPatchOrDiffBlock(block: ChatProseBlock): boolean {
  if (block.type === "code-fence") {
    const lang = block.language?.trim().toLowerCase();
    return lang === "patch" || lang === "diff" || block.code.includes("<<<<<<< SEARCH");
  }
  if (block.type === "code-citation") {
    return block.code.includes("<<<<<<< SEARCH");
  }
  return false;
}

function isMarkdownResumeLine(line: string): boolean {
  return (
    isSectionHeading(line) ||
    isListLine(line) ||
    isUnfencedCitationStartLine(line) ||
    isJiraTicketStartLine(line)
  );
}

/**
 * Unclosed fences must not swallow the rest of the answer (lists, headings).
 * Returns "stray" to skip a lone ``` opener, a body index to truncate at, or
 * null to keep the body (in-progress stream of real code).
 */
function findUnclosedFenceResume(
  body: string[],
  infoString: string | undefined
): "stray" | number | null {
  const lang = infoString?.trim().toLowerCase() ?? "";
  if (lang === "yaml" || lang === "yml" || lang === "markdown" || lang === "md" || lang === "diff" || lang === "patch") {
    return null;
  }

  const firstIdx = body.findIndex((line) => line.trim() !== "");
  if (firstIdx < 0) {
    return null;
  }

  const first = body[firstIdx]!;
  const firstIsLocator = Boolean(locatorFromProseLine(first) ?? tryParseCitationLocator(first.trim()));
  if (isMarkdownResumeLine(first) && !firstIsLocator && !looksLikeCodeLine(first)) {
    const loc = locatorInFenceBody(body);
    if (loc && loc.codeStart > firstIdx) {
      return null;
    }
    return "stray";
  }

  let seenCode = looksLikeCodeLine(first) || firstIsLocator;
  for (let i = firstIdx + 1; i < body.length; i++) {
    const line = body[i]!;
    if (line.trim() === "") {
      continue;
    }
    if (looksLikeCodeLine(line) || locatorFromProseLine(line)) {
      seenCode = true;
      continue;
    }
    if (seenCode && isMarkdownResumeLine(line)) {
      return i;
    }
  }
  return null;
}

function consumeTrailingLocator(
  lines: string[],
  afterIndex: number,
  block: ChatProseBlock
): { block: ChatProseBlock; nextIndex: number } {
  if (isPatchOrDiffBlock(block)) {
    return { block, nextIndex: afterIndex };
  }
  let j = afterIndex;
  while (j < lines.length && lines[j]!.trim() === "") {
    j += 1;
  }
  const locator = locatorFromProseLine(lines[j] ?? "");
  if (!locator) {
    return { block, nextIndex: afterIndex };
  }
  let k = j + 1;
  while (k < lines.length && lines[k]!.trim() === "") {
    k += 1;
  }
  if (k < lines.length && CODE_FENCE_LINE_RE.test(lines[k] ?? "")) {
    return { block, nextIndex: afterIndex };
  }
  if (block.type === "code-citation" && block.startLine != null) {
    return { block, nextIndex: afterIndex };
  }
  return {
    block: mergeLocatorIntoCodeBlock(locator, block),
    nextIndex: j + 1
  };
}

type ParsedFence =
  | { skip: true; nextIndex: number; block?: undefined }
  | { skip?: false; block: ChatProseBlock; nextIndex: number };

function tryParseBareCitation(
  lines: string[],
  startIndex: number,
  options?: ParseChatProseOptions
): { block: ChatProseBlock; nextIndex: number } | null {
  const locator = locatorFromProseLine(lines[startIndex] ?? "");
  if (!locator) {
    return null;
  }

  let j = startIndex + 1;
  while (j < lines.length && lines[j]!.trim() === "") {
    j += 1;
  }

  const fence = j < lines.length ? tryParseCodeFence(lines, j, options) : null;
  if (fence && !fence.skip) {
    if (isPatchOrDiffBlock(fence.block) && /^File:\s+/i.test((lines[startIndex] ?? "").trim())) {
      return null;
    }
    return {
      block: mergeLocatorIntoCodeBlock(locator, fence.block),
      nextIndex: fence.nextIndex
    };
  }

  if (locator.startLine == null) {
    return null;
  }

  const body: string[] = [];
  let k = fence?.skip ? fence.nextIndex : j;
  while (k < lines.length) {
    const line = lines[k]!;
    if (line.trim() === "") {
      break;
    }
    if (
      isSectionHeading(line) ||
      isListLine(line) ||
      CODE_FENCE_LINE_RE.test(line) ||
      isJiraTicketStartLine(line) ||
      isUnfencedCitationStartLine(line)
    ) {
      break;
    }
    if (body.length === 0 && !looksLikeCodeLine(line) && !/^[ \t]+/.test(line)) {
      break;
    }
    body.push(line);
    k += 1;
  }

  return {
    block: citationBlockFromLocator(locator, stripCommonIndent(body).join("\n")),
    nextIndex: k
  };
}

function tryParseCodeFence(
  lines: string[],
  startIndex: number,
  options?: ParseChatProseOptions
): ParsedFence | null {
  const openingMatch = lines[startIndex]?.match(CODE_FENCE_LINE_RE);
  if (!openingMatch) {
    return null;
  }

  const openIndent = openingMatch[1] ?? "";
  const infoString = (openingMatch[2] ?? "").trim() || undefined;
  const body: string[] = [];
  let i = startIndex + 1;
  while (i < lines.length && !CODE_FENCE_LINE_RE.test(lines[i] ?? "")) {
    body.push(stripFenceIndent(lines[i] ?? "", openIndent.length));
    i += 1;
  }

  const closed = i < lines.length;
  if (!closed) {
    const resume = findUnclosedFenceResume(body, infoString);
    if (resume === "stray") {
      return { skip: true, nextIndex: startIndex + 1 };
    }
    if (typeof resume === "number") {
      body.length = resume;
      i = startIndex + 1 + resume;
    }
  }

  let nextIndex = closed ? i + 1 : i;

  const finish = (block: ChatProseBlock): ParsedFence => {
    const trailing = consumeTrailingLocator(lines, nextIndex, block);
    return { block: trailing.block, nextIndex: trailing.nextIndex };
  };

  // Cursor-style: ```startLine:endLine:path on the fence line (also recovers placeholders).
  const infoCitation = infoString ? tryParseFenceInfoLocator(infoString) : null;
  if (infoCitation) {
    return finish(citationBlockFromLocator(infoCitation, body.join("\n")));
  }

  // Locator on the first body line, or a few lines in (list preamble + locator).
  const bodyCitation = locatorInFenceBody(body);
  if (bodyCitation) {
    return finish(
      citationBlockFromLocator(bodyCitation.locator, body.slice(bodyCitation.codeStart).join("\n"))
    );
  }

  const code = body.join("\n");
  if (code.trim() && !shouldNeverUpgradeLanguageFence(infoString)) {
    if (!infoString || isOrdinaryLanguageTag(infoString)) {
      const nearby = findCitationNearFence(lines, startIndex, options?.activeFilePath);
      if (nearby) {
        return finish(citationBlockFromLocator(nearby, code));
      }
      const citePath = resolveCitePathForLanguageFence({
        language: infoString,
        code,
        lines,
        fenceStartIndex: startIndex,
        activeFilePath: options?.activeFilePath
      });
      if (citePath) {
        return finish(citationBlockFromLocator({ path: citePath }, code));
      }
    }
  }

  return finish({
    type: "code-fence",
    language: infoString,
    code
  });
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
      (isSectionHeading(line) ||
        isListLine(line) ||
        CODE_FENCE_LINE_RE.test(line) ||
        isJiraTicketStartLine(line) ||
        isUnfencedCitationStartLine(line))
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

    const evidenceLinkMatch = remaining.match(COOP_EVIDENCE_LINK_RE);
    if (evidenceLinkMatch) {
      flushText();
      nodes.push({
        type: "evidence-link",
        label: evidenceLinkMatch[1]
      });
      cursor += evidenceLinkMatch[0].length;
      continue;
    }

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

    const sourceMatch = remaining.match(INLINE_SOURCE_CITATION_RE);
    if (sourceMatch) {
      flushText();
      const label = normalizeSourceCitationLabel(sourceMatch[0]);
      nodes.push({ type: "source-citation", label, id: sourceCitationSlug(label) });
      cursor += sourceMatch[0].length;
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
  if (isSourceCitationLabel(trimmed)) {
    const label = normalizeSourceCitationLabel(trimmed);
    return { type: "source-citation", label, id: sourceCitationSlug(label) };
  }
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

function nextNonEmptyLine(lines: string[], fromIndex: number): string | undefined {
  for (let i = fromIndex; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function isSectionHeading(line: string, nextNonEmpty?: string): boolean {
  const trimmed = line.trim();
  if (!SECTION_HEADING_RE.test(trimmed) && !MARKDOWN_HEADING_RE.test(trimmed)) {
    return false;
  }
  const plain = stripHeadingSyntax(trimmed);
  if (plain.endsWith(".")) {
    const nextIsList = Boolean(nextNonEmpty && isListLine(nextNonEmpty));
    if (!(nextIsList && plain.length <= 90)) {
      return false;
    }
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
