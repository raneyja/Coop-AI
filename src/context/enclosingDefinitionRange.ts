import type { LineRange } from "./stickyEditorSelection";

/**
 * Turn a caret click inside a function into the function’s line range.
 * Drag-select still wins; this is for “click inside get_queryset / requireAuth.”
 */
export function enclosingDefinitionRange(
  content: string,
  caretLine: number
): LineRange | undefined {
  if (!Number.isInteger(caretLine) || caretLine < 1 || !content) {
    return undefined;
  }
  const lines = content.split(/\r?\n/);
  if (caretLine > lines.length) {
    return undefined;
  }
  const python = looksLikePython(content);
  let best: LineRange | undefined;
  for (let i = 0; i < lines.length; i++) {
    const header = definitionHeader(lines[i]!, python);
    if (!header) {
      continue;
    }
    const end0 = python
      ? pythonBodyEnd(lines, i, header.indent)
      : tsBodyEnd(lines, i);
    const start = i + 1;
    const end = end0 + 1;
    if (caretLine >= start && caretLine <= end) {
      // Innermost header wins (later start).
      if (!best || start >= best[0]) {
        best = [start, end];
      }
    }
  }
  return best;
}

function looksLikePython(content: string): boolean {
  return (
    /^\s*(async\s+def|def|class)\s+\w+/m.test(content) &&
    !/^\s*(export\s+)?(async\s+)?function\s+/m.test(content)
  );
}

function definitionHeader(
  line: string,
  python: boolean
): { indent: number } | undefined {
  const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
  if (python) {
    if (/^\s*(async\s+def|def|class)\s+\w+/.test(line)) {
      return { indent };
    }
    return undefined;
  }
  if (
    /^\s*(export\s+)?(async\s+)?function\s+\w+/.test(line) ||
    /^\s*(export\s+)?(async\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?(?:\(|function)/.test(line)
  ) {
    return { indent };
  }
  return undefined;
}

function pythonBodyEnd(lines: string[], defIndex0: number, defIndent: number): number {
  let end = defIndex0;
  for (let i = defIndex0 + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      continue;
    }
    const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
    if (indent <= defIndent) {
      break;
    }
    end = i;
  }
  return end;
}

function tsBodyEnd(lines: string[], defIndex0: number): number {
  let depth = 0;
  let seenBrace = false;
  for (let i = defIndex0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        seenBrace = true;
      } else if (ch === "}") {
        depth -= 1;
        if (seenBrace && depth <= 0) {
          return i;
        }
      }
    }
  }
  return defIndex0;
}
