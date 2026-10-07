import { shouldNeverUpgradeLanguageFence, tryParseCitationLocator } from "./codeCitationLocator";

export type GroundedCitation = {
  startLine: number;
  endLine: number;
  code: string;
  grounded: boolean;
};

export type GroundCodeCitationOptions = {
  /** Do not restore a broad claimed range around a narrower verified snippet. */
  strictRange?: boolean;
};

const MAX_STRICT_CITATION_LINES = 20;

function splitFileLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function trimSnippetLines(snippet: string): string[] {
  const lines = splitFileLines(snippet);
  while (lines.length > 0 && lines[0]!.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  return lines;
}

function linesMatch(fileSlice: string[], snippet: string[]): boolean {
  if (fileSlice.length !== snippet.length) {
    return false;
  }
  return fileSlice.every((line, index) => line.trimEnd() === snippet[index]!.trimEnd());
}

/** True when snippet is the file slice with some lines removed (still in order). */
function snippetIsSubsequence(fileSlice: string[], snippet: string[]): boolean {
  if (snippet.length === 0 || snippet.length > fileSlice.length) {
    return false;
  }
  let i = 0;
  for (const fileLine of fileSlice) {
    if (i < snippet.length && fileLine.trimEnd() === snippet[i]!.trimEnd()) {
      i += 1;
    }
  }
  return i === snippet.length;
}

function shouldRestoreStrippedClaimedSlice(fileSlice: string[], snippet: string[]): boolean {
  if (!snippetIsSubsequence(fileSlice, snippet)) {
    return false;
  }
  return snippet.length * 5 >= fileSlice.length * 3;
}

/** Restore explicit omissions only between exact source blocks in a bounded range. */
function hasVerifiedElision(fileSlice: string[], snippet: string[]): boolean {
  if (fileSlice.length > 120 || !snippet.some((line) => line.trim() === "...")) return false;
  const blocks: string[][] = [[]];
  for (const line of snippet) {
    if (line.trim() === "...") blocks.push([]);
    else blocks.at(-1)!.push(line);
  }
  if (blocks.length < 2 || blocks.some((block) => block.filter((line) => line.trim()).length < 2)) return false;
  if (!linesMatch(fileSlice.slice(0, blocks[0]!.length), blocks[0]!)) return false;
  const last = blocks.at(-1)!;
  const lastStart = fileSlice.length - last.length;
  if (!linesMatch(fileSlice.slice(lastStart), last)) return false;
  let cursor = blocks[0]!.length;
  for (const block of blocks.slice(1, -1)) {
    const start = findSnippetStart(fileSlice.slice(cursor, lastStart), block);
    if (start < 0) return false;
    cursor += start + block.length;
  }
  return cursor <= lastStart;
}

function sliceLines(fileLines: string[], startLine: number, endLine: number): string[] {
  return fileLines.slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
}

function findSnippetStart(fileLines: string[], snippet: string[]): number {
  if (snippet.length === 0) {
    return -1;
  }
  const first = snippet[0]!.trimEnd();
  for (let i = 0; i <= fileLines.length - snippet.length; i++) {
    if (fileLines[i]!.trimEnd() !== first) {
      continue;
    }
    const slice = fileLines.slice(i, i + snippet.length);
    if (linesMatch(slice, snippet)) {
      return i;
    }
  }
  return -1;
}

/**
 * Map a model-emitted snippet onto the real file. Cite must show the file's
 * line numbers and body, not the model's guess.
 */
export function groundCodeCitation(
  fileText: string,
  snippet: string,
  claimedStart?: number,
  claimedEnd?: number,
  options?: GroundCodeCitationOptions
): GroundedCitation {
  const fileLines = splitFileLines(fileText);
  const rawSnippetLines = trimSnippetLines(snippet);
  const numberedLines = [...rawSnippetLines];
  while (/^\s*(?:\d+\s*\|\s*)?(?:`{2,}|\d+:\d+:[^\s]+`*)\s*$/.test(numberedLines.at(-1) ?? "")) numberedLines.pop();
  const numbered = numberedLines.map((line) => line.match(/^\s*(\d+)\s*\| ?(.*)$/));
  const isSequential = numbered.length > 0 && numbered.every((match, index) =>
    match && (index === 0 || Number(match[1]) === Number(numbered[index - 1]![1]) + 1));
  // Number prefixes are presentation metadata only. Recover them only when
  // the resulting verbatim snippet matches the actual remote source below.
  const snippetLines = isSequential ? numbered.map((match) => match![2]!) : rawSnippetLines;

  if (snippetLines.length === 0) {
    return {
      startLine: claimedStart ?? 1,
      endLine: claimedEnd ?? claimedStart ?? 1,
      code: snippet,
      grounded: false
    };
  }

  if (claimedStart != null && claimedEnd != null && claimedEnd >= claimedStart) {
    const claimedSlice = sliceLines(fileLines, claimedStart, claimedEnd);
    if (
      linesMatch(claimedSlice, snippetLines) ||
      (!options?.strictRange && (shouldRestoreStrippedClaimedSlice(claimedSlice, snippetLines) || hasVerifiedElision(claimedSlice, snippetLines)))
    ) {
      return {
        startLine: claimedStart,
        endLine: claimedEnd,
        code: claimedSlice.join("\n"),
        grounded: true
      };
    }
  }

  const foundAt = findSnippetStart(fileLines, snippetLines);
  if (foundAt >= 0) {
    const startLine = foundAt + 1;
    const endLine = foundAt + snippetLines.length;
    return {
      startLine,
      endLine,
      code: fileLines.slice(foundAt, foundAt + snippetLines.length).join("\n"),
      grounded: true
    };
  }
  if (isSequential) {
    const dedentedAt = findSnippetStart(fileLines.map((line) => line.trimStart()), snippetLines.map((line) => line.trimStart()));
    if (dedentedAt >= 0) {
      return { startLine: dedentedAt + 1, endLine: dedentedAt + snippetLines.length,
        code: fileLines.slice(dedentedAt, dedentedAt + snippetLines.length).join("\n"), grounded: true };
    }
  }

  return {
    startLine: claimedStart ?? 1,
    endLine: claimedEnd ?? claimedStart ?? snippetLines.length,
    code: rawSnippetLines.join("\n"),
    grounded: false
  };
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function nearbyLocator(lines: string[]): ReturnType<typeof tryParseCitationLocator> {
  for (const line of lines.slice(-6).reverse()) {
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const locator = tryParseCitationLocator(match[1]!);
      if (locator) return locator;
    }
  }
  return null;
}

/**
 * Rewrite citation fences in assistant markdown so displayed lines match the file.
 */
export function applyGroundedCitations(
  markdown: string,
  filesByPath: Map<string, string>,
  options?: GroundCodeCitationOptions
): string {
  if (filesByPath.size === 0 || !markdown.includes("```")) {
    return markdown;
  }

  const lines = splitFileLines(markdown);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith("```")) {
      out.push(line);
      i += 1;
      continue;
    }

    const open = line;
    const info = open.trimStart().slice(3).trim();
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
      body.push(lines[i]!);
      i += 1;
    }
    const close = i < lines.length ? lines[i]! : "```";
    if (i < lines.length) {
      i += 1;
    }

    const infoLocator = info ? tryParseCitationLocator(info) : null;
    const bodyLocator = body[0] ? tryParseCitationLocator(body[0]) : null;
    const locator = infoLocator ?? bodyLocator ?? (shouldNeverUpgradeLanguageFence(info) ? null : nearbyLocator(out));
    const codeLines = infoLocator ? body : bodyLocator ? body.slice(1) : body;
    const file = locator ? filesByPath.get(normalizePath(locator.path)) : undefined;

    if (!locator || !file) {
      out.push(open, ...body, close);
      continue;
    }

    const grounded = groundCodeCitation(file, codeLines.join("\n"), locator.startLine, locator.endLine, options);
    if (!grounded.grounded) {
      out.push(open, ...body, close);
      continue;
    }
    if (options?.strictRange && grounded.endLine - grounded.startLine + 1 > MAX_STRICT_CITATION_LINES) {
      const sourceLines = splitFileLines(file);
      for (let startLine = grounded.startLine; startLine <= grounded.endLine; startLine += MAX_STRICT_CITATION_LINES) {
        const endLine = Math.min(grounded.endLine, startLine + MAX_STRICT_CITATION_LINES - 1);
        out.push(`\`\`\`${startLine}:${endLine}:${locator.path}`);
        out.push(...sourceLines.slice(startLine - 1, endLine));
        out.push(close);
      }
      continue;
    }
    const newLocator = `${grounded.startLine}:${grounded.endLine}:${locator.path}`;
    if (infoLocator) {
      out.push(`\`\`\`${newLocator}`);
      out.push(...grounded.code.split("\n"));
    } else {
      out.push(open.startsWith("```") && !info ? "```" : open);
      out.push(newLocator);
      out.push(...grounded.code.split("\n"));
    }
    out.push(close);
  }

  return out.join("\n");
}

export function citationPathsInMarkdown(markdown: string): string[] {
  if (!markdown.includes("```")) {
    return [];
  }
  const paths = new Set<string>();
  const lines = splitFileLines(markdown);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.trimStart().startsWith("```")) {
      i += 1;
      continue;
    }
    const preceding = lines.slice(0, i);
    const info = lines[i]!.trimStart().slice(3).trim();
    i += 1;
    const body: string[] = [];
    while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
      body.push(lines[i]!);
      i += 1;
    }
    if (i < lines.length) {
      i += 1;
    }
    const locator =
      (info ? tryParseCitationLocator(info) : null) ??
      (body[0] ? tryParseCitationLocator(body[0]) : null) ?? (shouldNeverUpgradeLanguageFence(info) ? null : nearbyLocator(preceding));
    if (locator?.path) {
      paths.add(locator.path);
    }
  }
  return [...paths];
}
