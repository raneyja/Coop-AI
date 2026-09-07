import type { PatchPreviewFile, PatchPreviewHunk } from "../chat/types";

export function formatLineRange(startLine?: number, endLine?: number): string | undefined {
  if (!startLine || startLine < 1) {
    return undefined;
  }
  if (!endLine || endLine <= startLine) {
    return `L${startLine}`;
  }
  return `L${startLine}–${endLine}`;
}

export function formatHunkLocation(hunk: PatchPreviewHunk): string | undefined {
  const range = formatLineRange(hunk.startLine, hunk.endLine);
  if (hunk.anchorLabel && range) {
    return `${hunk.anchorLabel} · ${range}`;
  }
  return hunk.anchorLabel ?? range;
}

export function formatFileLocation(file: PatchPreviewFile): string | undefined {
  if (file.hunks.length !== 1) {
    return undefined;
  }
  return formatHunkLocation(file.hunks[0]!);
}

/** One-line “where does this land” for the card body. */
export function formatPatchLandingCopy(
  files: readonly PatchPreviewFile[],
  status: "pending" | "applied" | "rejected" | "failed" | string
): string | undefined {
  if (files.length !== 1 || files[0]!.hunks.length !== 1) {
    return undefined;
  }
  const file = files[0]!;
  const loc = formatHunkLocation(file.hunks[0]!);
  if (!loc) {
    return undefined;
  }
  const base = file.relativePath.split("/").pop() ?? file.relativePath;
  const where = `${loc} · ${base}`;
  if (status === "applied") {
    return `Landed in ${where}.`;
  }
  if (status === "rejected") {
    return `Would have landed in ${where}.`;
  }
  return `Lands in ${where}.`;
}
