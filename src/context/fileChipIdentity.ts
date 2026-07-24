import type { RepoContext } from "../chat/types";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

export type ChipFileSource = NonNullable<RepoContext["fileSource"]>;

function normalizeRelativePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Single rules for L vs R chip provenance:
 * - Absolute OS path (Downloads / Cmd+O) → always "external" (L). Never "remote".
 * - "remote" = codehost / explorer pick / vfs. Content attach and open must NOT
 *   fall through to a local clone unless the user explicitly picks a local path.
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

/**
 * True when the user is working a remote explorer / codehost file.
 * Callers must not read local workspace/disk for attach or open fallbacks.
 */
export function isRemoteProvenanceContext(
  ctx: Pick<RepoContext, "file" | "fileSource">,
  remoteProvenanceFile?: string
): boolean {
  if (remoteProvenanceFile?.trim() && !isOsAbsoluteDiskPath(remoteProvenanceFile)) {
    return true;
  }
  return isRemoteChip(ctx);
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
 * Leftover local-clone editor events for the same path must not steal provenance
 * or imply the session switched to local. Content attach stays remote-only.
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

/**
 * Defensive: do not demote an existing remote stamp when a local buffer event fires
 * for the same path. Prefer skipping local attach entirely when remote (see
 * isRemoteProvenanceContext) — R must mean codehost/VFS content, not a local clone.
 */
export function preserveRemoteChipSource(
  existing: RepoContext["fileSource"],
  proposed: RepoContext["fileSource"]
): RepoContext["fileSource"] {
  if (existing === "remote") {
    if (proposed === "external") {
      return "external";
    }
    if (proposed === "workspace" || proposed === "git" || proposed === undefined) {
      return "remote";
    }
  }
  return proposed ?? existing;
}
