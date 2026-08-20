import { isSameRepoFilePath } from "./fileChipIdentity";

export type LineRange = [number, number];

/** Minimal VS Code selection shape (0-based lines/characters). */
export type EditorSelectionLike = {
  isEmpty: boolean;
  start: { line: number; character: number };
  end: { line: number; character: number };
};

function normalizeRange(start: number, end: number): LineRange | undefined {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return undefined;
  }
  return start <= end ? [start, end] : [end, start];
}

function isLineRange(value: LineRange | undefined): value is LineRange {
  return Array.isArray(value) && value.length === 2 && value[0] >= 1 && value[1] >= 1;
}

/**
 * Convert a VS Code selection to a 1-based inclusive line range.
 * A drag that ends at column 0 of the next line (Shift+Down / line select)
 * must not include that extra line — L56–61 stays L56–61.
 */
export function selectedLinesFromEditorSelection(
  selection: EditorSelectionLike | undefined
): LineRange | undefined {
  if (!selection || selection.isEmpty) {
    return undefined;
  }
  const start = selection.start.line + 1;
  const endsAtNextLineStart =
    selection.end.character === 0 && selection.end.line > selection.start.line;
  const end = endsAtNextLineStart ? selection.end.line : selection.end.line + 1;
  return normalizeRange(start, end);
}

/**
 * Matches `vscode.TextEditorSelectionChangeKind` without importing vscode.
 * Undefined kind is focus-loss / unknown — not a user dismiss.
 */
export const EDITOR_SELECTION_CHANGE_KIND = {
  Keyboard: 1,
  Mouse: 2,
  Command: 3
} as const;

/** Mouse or keyboard emptied the range in the editor — drop the chip. */
export function isUserClearedEditorSelection(
  kind: number | undefined,
  selectionIsEmpty: boolean
): boolean {
  if (!selectionIsEmpty) {
    return false;
  }
  return (
    kind === EDITOR_SELECTION_CHANGE_KIND.Keyboard ||
    kind === EDITOR_SELECTION_CHANGE_KIND.Mouse
  );
}

/**
 * Keep the last real highlight when Chat steals focus (empty caret, same file).
 * A mouse/keyboard unhighlight clears it. A new non-empty range replaces it.
 * A different file clears it.
 */
export function resolveStickySelectedLines(options: {
  existingFile?: string;
  existingLines?: LineRange;
  incomingFile?: string;
  incomingLines?: LineRange;
  /** True when the user dismissed the highlight in the editor (not Chat focus steal). */
  userClearedSelection?: boolean;
}): LineRange | undefined {
  if (isLineRange(options.incomingLines)) {
    return options.incomingLines;
  }
  if (options.userClearedSelection) {
    return undefined;
  }
  if (!isLineRange(options.existingLines)) {
    return undefined;
  }
  const incomingFile = options.incomingFile?.trim();
  const existingFile = options.existingFile?.trim();
  if (!incomingFile) {
    // Focus loss / webview click — keep the highlight on the open file.
    return options.existingLines;
  }
  if (!existingFile || isSameRepoFilePath(incomingFile, existingFile)) {
    return options.existingLines;
  }
  return undefined;
}

export function selectedLineRangesEqual(
  left: LineRange | undefined,
  right: LineRange | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left[0] === right[0] && left[1] === right[1];
}
