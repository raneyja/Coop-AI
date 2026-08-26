import type { LineRange } from "./stickyEditorSelection";

function isLineRange(value: LineRange | undefined): value is LineRange {
  return Array.isArray(value) && value.length === 2 && value[0] >= 1 && value[1] >= 1;
}

function rangeContains(outer: LineRange, inner: LineRange): boolean {
  return outer[0] <= inner[0] && inner[1] <= outer[1];
}

/**
 * Click / caret inside a function becomes that function’s range.
 * A drag-select still wins. A sticky range that is not this function
 * (DEFAULT_STATES leftover while the caret is in get_queryset) is replaced.
 * Chat focus-loss with no caret info keeps the sticky range.
 */
export function resolveEditTargetLines(options: {
  dragLines?: LineRange;
  fileContent?: string;
  caretLine?: number;
  stickyLines?: LineRange;
  userClearedSelection?: boolean;
}): LineRange | undefined {
  if (isLineRange(options.dragLines)) {
    return options.dragLines;
  }
  const enclosing =
    options.fileContent && options.caretLine
      ? enclosingDefinitionRange(options.fileContent, options.caretLine)
      : undefined;
  if (enclosing) {
    if (options.stickyLines && rangeContains(enclosing, options.stickyLines)) {
      return options.stickyLines;
    }
    return enclosing;
  }
  if (options.userClearedSelection) {
    return undefined;
  }
  return isLineRange(options.stickyLines) ? options.stickyLines : undefined;
}

export type DefinitionAnchor = {
  /** e.g. StateManager.get_queryset */
  label: string;
  /** 1-based line to show at the top of a diff (class if present, else def). */
  contextLine: number;
};

/**
 * Name the class/function that contains this line so a patch card can say
 * where the edit lands — not only “get_queryset” next to the wrong class.
 */
export function enclosingDefinitionAnchor(
  content: string,
  caretLine: number
): DefinitionAnchor | undefined {
  const inner = enclosingDefinitionRange(content, caretLine);
  if (!inner) {
    return undefined;
  }
  const lines = content.split(/\r?\n/);
  const python = looksLikePython(content);
  const defLine = inner[0];
  const defNamed = definitionName(lines[defLine - 1] ?? "", python);
  let classNamed: { name: string; line: number } | undefined;
  const floor = Math.max(0, defLine - 13);
  for (let i = defLine - 2; i >= floor; i--) {
    const named = definitionName(lines[i] ?? "", python);
    if (named?.kind === "class" && named.indent < (defNamed?.indent ?? 99)) {
      classNamed = { name: named.name, line: i + 1 };
      break;
    }
  }
  const defLabel = defNamed && defNamed.kind !== "class" ? defNamed.name : undefined;
  const label =
    classNamed && defLabel
      ? `${classNamed.name}.${defLabel}`
      : defLabel ?? classNamed?.name ?? defNamed?.name;
  if (!label) {
    return undefined;
  }
  return { label, contextLine: classNamed?.line ?? defLine };
}

function definitionName(
  line: string,
  python: boolean
): { kind: "class" | "def"; name: string; indent: number } | undefined {
  const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
  if (python) {
    const classMatch = /^\s*class\s+(\w+)/.exec(line);
    if (classMatch?.[1]) {
      return { kind: "class", name: classMatch[1], indent };
    }
    const defMatch = /^\s*(?:async\s+)?def\s+(\w+)/.exec(line);
    if (defMatch?.[1]) {
      return { kind: "def", name: defMatch[1], indent };
    }
    return undefined;
  }
  const tsClass = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(line);
  if (tsClass?.[1]) {
    return { kind: "class", name: tsClass[1], indent };
  }
  const tsFn = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(line);
  if (tsFn?.[1]) {
    return { kind: "def", name: tsFn[1], indent };
  }
  const tsConst = /^\s*(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/.exec(
    line
  );
  if (tsConst?.[1]) {
    return { kind: "def", name: tsConst[1], indent };
  }
  return undefined;
}

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
