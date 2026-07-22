import type { RepoContext } from "../chat/types";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

export type ChipFileSource = NonNullable<RepoContext["fileSource"]>;

function normalizeRelativePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Single rules for L vs R chip provenance:
 * - Absolute OS path (Downloads / Cmd+O) → always "external" (L). Never "remote".
 * - "remote" = codehost / explorer pick / vfs — even if a local clone buffer is used to view it.
 * - workspace / git = on-disk repo buffers opened from the editor (L).
 */
export function coerceChipFileSource(
  file: string | undefined,
  fileSource: RepoContext["fileSource"]
): ChipFileSource | undefined {
  const trimmed = file?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (isOsAbsoluteDiskPath(trimmed)) {
    return "external";
  }
  return fileSource;
}

/** UI badge: R only for codehost provenance; absolute disk is never R. */
export function isRemoteChip(ctx: Pick<RepoContext, "file" | "fileSource">): boolean {
  if (isOsAbsoluteDiskPath(ctx.file)) {
    return false;
  }
  return ctx.fileSource === "remote";
}

export function isSameRepoFilePath(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) {
    return false;
  }
  const left = a.trim().replace(/\\/g, "/");
  const right = b.trim().replace(/\\/g, "/");
  if (isOsAbsoluteDiskPath(left) || isOsAbsoluteDiskPath(right)) {
    return left === right;
  }
  const na = normalizeRelativePath(left);
  const nb = normalizeRelativePath(right);
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

/**
 * After a remote explorer pick, VS Code may open the local clone (workspace/git URI).
 * Keep chip provenance "remote" when the relative path still matches.
 */
export function shouldKeepRemoteProvenance(
  existing: Pick<RepoContext, "file" | "fileSource">,
  incoming: Pick<RepoContext, "file" | "fileSource">
): boolean {
  if (existing.fileSource !== "remote" || !existing.file?.trim() || !incoming.file?.trim()) {
    return false;
  }
  if (isOsAbsoluteDiskPath(incoming.file) || isOsAbsoluteDiskPath(existing.file)) {
    return false;
  }
  if (!isSameRepoFilePath(existing.file, incoming.file)) {
    return false;
  }
  return (
    incoming.fileSource === "workspace" ||
    incoming.fileSource === "git" ||
    incoming.fileSource === undefined
  );
}
