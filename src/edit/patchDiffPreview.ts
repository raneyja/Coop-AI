import type { PatchCardState, PatchDiffLine, PatchPreviewFile, PatchPreviewHunk } from "../chat/types";
import { findSearchMatch } from "./patchContent";
import { countHunks, countUniqueFiles, type ParsedPatchSet, type PatchHunk } from "./patchParser";
import { getSuppressedMessageTimestamps, markMessageMarkdownSuppressed } from "./patchSession";
import { resolveEditablePatchTarget } from "./patchTarget";

const CONTEXT_LINES = 2;

export type PatchStatePublisher = (state: PatchCardState) => void;

export const PATCH_CARD_IDLE: PatchCardState = {
  status: "idle",
  fileCount: 0,
  hunkCount: 0,
  files: []
};

/**
 * Registers `state`'s message (when it suppresses markdown) in the session-wide
 * suppression list, then stamps the full accumulated list onto the returned state.
 * Every card we publish or hand back to the webview should be passed through this so
 * a newer /edit patch replacing the "live" card never resurfaces an older message's
 * raw SEARCH/REPLACE fence.
 */
export function withSuppressionRegistry(state: PatchCardState): PatchCardState {
  if (state.suppressMarkdown) {
    markMessageMarkdownSuppressed(state.messageTimestamp);
  }
  return { ...state, suppressedMessageTimestamps: getSuppressedMessageTimestamps() };
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/);
}

function readWorkspaceFile(relativePath: string, overrides?: Readonly<Record<string, string>>): string {
  if (overrides && relativePath in overrides) {
    return overrides[relativePath] ?? "";
  }
  const target = resolveEditablePatchTarget(relativePath);
  return target?.readText() ?? "";
}

function lineIndexAtOffset(content: string, offset: number): number {
  const prefix = content.slice(0, Math.max(0, offset));
  return splitLines(prefix).length - 1;
}

function buildUnmatchedHunkPreview(hunk: PatchHunk, hunkId: string): PatchPreviewHunk {
  const lines: PatchDiffLine[] = [];
  for (const line of splitLines(hunk.search)) {
    lines.push({ kind: "remove", text: line });
  }
  for (const line of splitLines(hunk.replace)) {
    lines.push({ kind: "add", text: line });
  }
  return { id: hunkId, lines, matchStatus: "not_found", status: "pending" };
}

function buildMatchedHunkPreview(
  content: string,
  hunk: PatchHunk,
  hunkId: string,
  matchStatus: "matched" | "ambiguous"
): PatchPreviewHunk {
  const match = findSearchMatch(content, hunk.search);
  if (!match.ok) {
    return { ...buildUnmatchedHunkPreview(hunk, hunkId), matchStatus };
  }

  const contentLines = splitLines(content);
  const matchedLines = splitLines(match.matched);
  const replaceLines = splitLines(hunk.replace);
  const startLineIdx = lineIndexAtOffset(content, match.start);
  const endLineIdx = startLineIdx + Math.max(matchedLines.length, 1) - 1;
  const contextStart = Math.max(0, startLineIdx - CONTEXT_LINES);
  const contextEnd = Math.min(contentLines.length - 1, endLineIdx + CONTEXT_LINES);

  const lines: PatchDiffLine[] = [];
  for (let i = contextStart; i < startLineIdx; i++) {
    lines.push({ kind: "context", text: contentLines[i] ?? "", lineNumber: i + 1 });
  }
  for (let i = 0; i < matchedLines.length; i++) {
    lines.push({
      kind: "remove",
      text: matchedLines[i] ?? "",
      lineNumber: startLineIdx + i + 1
    });
  }
  for (const line of replaceLines) {
    lines.push({ kind: "add", text: line });
  }
  for (let i = endLineIdx + 1; i <= contextEnd; i++) {
    lines.push({ kind: "context", text: contentLines[i] ?? "", lineNumber: i + 1 });
  }

  return { id: hunkId, lines, matchStatus, status: "pending" };
}

export function buildPatchCardState(
  patches: ParsedPatchSet,
  options: {
    status: PatchCardState["status"];
    messageTimestamp?: number;
    error?: string;
    appliedFileCount?: number;
    canUndo?: boolean;
    fileContents?: Readonly<Record<string, string>>;
    /** Preserve per-hunk apply/reject when rebuilding previews. */
    previousFiles?: readonly PatchPreviewFile[];
  }
): PatchCardState {
  const previousStatusById = new Map<string, NonNullable<PatchPreviewHunk["status"]>>();
  for (const file of options.previousFiles ?? []) {
    for (const hunk of file.hunks) {
      if (hunk.status) {
        previousStatusById.set(hunk.id, hunk.status);
      }
    }
  }

  const files: PatchPreviewFile[] = [];
  let hunkCounter = 0;

  for (const filePatch of patches.files) {
    const content = readWorkspaceFile(filePatch.relativePath, options.fileContents);
    const hunks: PatchPreviewHunk[] = [];

    for (const hunk of filePatch.hunks) {
      const hunkId = `hunk-${hunkCounter}`;
      hunkCounter += 1;
      const match = findSearchMatch(content, hunk.search);
      let preview: PatchPreviewHunk;
      if (!match.ok) {
        preview = {
          ...buildUnmatchedHunkPreview(hunk, hunkId),
          matchStatus: match.reason === "ambiguous" ? "ambiguous" : "not_found"
        };
      } else {
        preview = buildMatchedHunkPreview(content, hunk, hunkId, "matched");
      }
      const prior = previousStatusById.get(hunkId);
      if (prior) {
        preview = { ...preview, status: prior };
      }
      hunks.push(preview);
    }

    files.push({ relativePath: filePatch.relativePath, hunks });
  }

  return {
    status: options.status,
    messageTimestamp: options.messageTimestamp,
    fileCount: countUniqueFiles(patches),
    hunkCount: countHunks(patches),
    files,
    error: options.error,
    appliedFileCount: options.appliedFileCount,
    canUndo: options.canUndo
  };
}

export function setHunkStatusOnCard(
  card: PatchCardState,
  hunkId: string,
  status: NonNullable<PatchPreviewHunk["status"]>
): PatchCardState {
  return {
    ...card,
    files: card.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => (hunk.id === hunkId ? { ...hunk, status } : hunk))
    }))
  };
}

export function pendingHunkIds(card: PatchCardState): string[] {
  return card.files.flatMap((file) =>
    file.hunks.filter((hunk) => (hunk.status ?? "pending") === "pending").map((hunk) => hunk.id)
  );
}

export function deriveCardStatusFromHunks(card: PatchCardState): PatchCardState["status"] {
  const statuses = card.files.flatMap((file) => file.hunks.map((hunk) => hunk.status ?? "pending"));
  if (statuses.length === 0) {
    return card.status;
  }
  if (statuses.every((status) => status === "applied")) {
    return "applied";
  }
  if (statuses.every((status) => status === "rejected")) {
    return "rejected";
  }
  if (statuses.some((status) => status === "applied") && !statuses.some((status) => status === "pending")) {
    return "applied";
  }
  return "pending";
}
