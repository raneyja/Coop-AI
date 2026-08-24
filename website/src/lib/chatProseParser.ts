import type {
  ChatInlineNode,
  ChatListItem,
  ChatParagraphBlock,
  ChatProseBlock,
  ChatProseDocument
} from "./chatProseTypes";
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
const CODE_FENCE_LINE_RE = /^(\s*)```(.*)$/;
const LIST_ITEM_RE = /^(\s*)(- |\* |(\d+)\.\s)(.*)$/;
const INLINE_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const INLINE_URL_RE = /^https?:\/\/[^\s)]+/;
const INLINE_CODE_RE = /^`([^`\n]+)`/;
const INLINE_STRONG_RE = /^\*\*([^*\n]+)\*\*/;
const FILE_WITH_EXTENSION_RE = /^[^/\s]+\.[A-Za-z0-9._-]+(?::\d+)?$/;
const FILE_LINE_RE = /^(.*):(\d+)$/;

export type ParseChatProseOptions = {
  activeFilePath?: string;
};

export function parseChatProse(content: string, options?: ParseChatProseOptions): ChatProseDocument {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: ChatProseBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }

    const codeBlock = tryParseCodeFence(lines, i, options);
    if (codeBlock) {
      if (codeBlock.skip) {
        i = codeBlock.nextIndex;
        continue;
      }
      blocks.push(codeBlock.block);
      i = codeBlock.nextIndex;
      continue;
    }

    const bareCitation = tryParseBareCitation(lines, i, options);
    if (bareCitation) {
      blocks.push(bareCitation.block);
      i = bareCitation.nextIndex;
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

function citationBlockFromLocator(
  locator: CodeCitationLocator,
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
): { locator: CodeCitationLocator; codeStart: number } | null {
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
  return isSectionHeading(line) || isListLine(line) || isUnfencedCitationStartLine(line);
}

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

  const infoCitation = infoString ? tryParseFenceInfoLocator(infoString) : null;
  if (infoCitation) {
    return finish(citationBlockFromLocator(infoCitation, body.join("\n")));
  }

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
