import { tryParseCitationLocator } from "./codeCitationLocator";

export type GroundedCitation = {
  startLine: number;
  endLine: number;
  code: string;
  grounded: boolean;
};

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
  claimedEnd?: number
): GroundedCitation {
  const fileLines = splitFileLines(fileText);
  const snippetLines = trimSnippetLines(snippet);

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
    if (linesMatch(claimedSlice, snippetLines)) {
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

  return {
    startLine: claimedStart ?? 1,
    endLine: claimedEnd ?? claimedStart ?? snippetLines.length,
    code: snippetLines.join("\n"),
    grounded: false
  };
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Rewrite citation fences in assistant markdown so displayed lines match the file.
 */
export function applyGroundedCitations(markdown: string, filesByPath: Map<string, string>): string {
  if (filesByPath.size === 0 || !markdown.includes("```")) {
    return markdown;
  }

  const lines = splitFileLines(markdown);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith("```")) {
      out.push(line);
      i += 1;
      continue;
    }

    const open = line;
    const info = open.slice(3).trim();
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !lines[i]!.startsWith("```")) {
      body.push(lines[i]!);
      i += 1;
    }
    const close = i < lines.length ? lines[i]! : "```";
    if (i < lines.length) {
      i += 1;
    }

    const infoLocator = info ? tryParseCitationLocator(info) : null;
    const bodyLocator = body[0] ? tryParseCitationLocator(body[0]) : null;
    const locator = infoLocator ?? bodyLocator;
    const codeLines = infoLocator ? body : bodyLocator ? body.slice(1) : body;
    const file = locator ? filesByPath.get(normalizePath(locator.path)) : undefined;

    if (!locator || !file) {
      out.push(open, ...body, close);
      continue;
    }

    const grounded = groundCodeCitation(file, codeLines.join("\n"), locator.startLine, locator.endLine);
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
    if (!lines[i]!.startsWith("```")) {
      i += 1;
      continue;
    }
    const info = lines[i]!.slice(3).trim();
    i += 1;
    const body: string[] = [];
    while (i < lines.length && !lines[i]!.startsWith("```")) {
      body.push(lines[i]!);
      i += 1;
    }
    if (i < lines.length) {
      i += 1;
    }
    const locator =
      (info ? tryParseCitationLocator(info) : null) ??
      (body[0] ? tryParseCitationLocator(body[0]) : null);
    if (locator?.path) {
      paths.add(locator.path);
    }
  }
  return [...paths];
}
