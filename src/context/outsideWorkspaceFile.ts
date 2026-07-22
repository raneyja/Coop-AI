import * as path from "node:path";
import type { RepoContext } from "../chat/types";

/**
 * True when a path is an absolute disk path (or a stripped absolute like Users/...).
 * These must never be treated as repository-relative targets for quick actions.
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
  try {
    return path.isAbsolute(normalized.replace(/\//g, path.sep));
  } catch {
    return false;
  }
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
