import type { RepoContext } from "../chat/types";

/**
 * True when a path is an absolute disk path (or a stripped absolute like Users/...).
 * These must never be treated as repository-relative targets for quick actions.
 * Kept browser-safe (no node:path) so webview can import via quickActionScope.
 */
export function looksLikeAbsoluteDiskPath(filePath: string | undefined): boolean {
  if (!filePath?.trim()) {
    return false;
  }
  let normalized = filePath.trim().replace(/\\/g, "/");
  if (/^Users\/[^/]+\//i.test(normalized) || /^home\/[^/]+\//i.test(normalized)) {
    normalized = `/${normalized}`;
  }
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return true;
  }
  if (
    normalized.startsWith("/Users/") ||
    normalized.startsWith("/home/") ||
    normalized.startsWith("/tmp/") ||
    normalized.startsWith("/var/") ||
    normalized.startsWith("/private/")
  ) {
    return true;
  }
  // Unix absolute (any rooted path) and UNC.
  return normalized.startsWith("/") || normalized.startsWith("//");
}

/**
 * True for real OS absolute disk roots (home/tmp/drive).
 * Unlike looksLikeAbsoluteDiskPath, does NOT treat "/src/foo.ts" as a disk path.
 */
export function isOsAbsoluteDiskPath(filePath: string | undefined): boolean {
  if (!filePath?.trim()) {
    return false;
  }
  let normalized = filePath.trim().replace(/\\/g, "/");
  if (/^Users\/[^/]+\//i.test(normalized) || /^home\/[^/]+\//i.test(normalized)) {
    normalized = `/${normalized}`;
  }
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return true;
  }
  return (
    normalized.startsWith("/Users/") ||
    normalized.startsWith("/home/") ||
    normalized.startsWith("/tmp/") ||
    normalized.startsWith("/var/") ||
    normalized.startsWith("/private/")
  );
}

/** Active editor / context points at a file outside the opened workspace or git clone. */
export function isExternalFileContext(
  ctx: Pick<RepoContext, "file" | "fileSource"> | undefined
): boolean {
  if (!ctx) {
    return false;
  }
  if (ctx.fileSource === "external") {
    return true;
  }
  return looksLikeAbsoluteDiskPath(ctx.file);
}
