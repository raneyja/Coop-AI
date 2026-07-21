import type { RepoContext } from "../chat/types";
import { isExplicitRepoScope, normalizeRepoContext } from "./contextScope";
import { isLocalDiskFileSource } from "./localFileContext";

const DISK_LINK_WARNING = "Only files on disk can be linked to GitHub";

/** Drop misleading disk-link warnings when a valid repo file is still in context. */
export function stripStaleContextWarning(ctx: RepoContext): RepoContext {
  if (!ctx.contextWarning?.includes(DISK_LINK_WARNING)) {
    return ctx;
  }
  if (ctx.file?.trim() && ctx.fileSource !== "external") {
    return { ...ctx, contextWarning: undefined };
  }
  return ctx;
}

function isFocusLossDiskLinkWarning(warning: string | undefined): boolean {
  return Boolean(warning?.includes(DISK_LINK_WARNING));
}

/**
 * Merge incoming editor/webview context without clobbering repo/file fields
 * when the incoming snapshot is incomplete (e.g. virtual editor URIs, focus loss).
 * Active editor switches that include a file path (including outside-workspace local)
 * always replace the prior file chip.
 */
export function mergeRepoContext(existing: RepoContext, incoming: RepoContext): RepoContext {
  const merged: RepoContext = {
    ...existing,
    ...incoming
  };

  // Explicit active-file switch (workspace / git / remote / external with a path).
  if (incoming.file?.trim()) {
    merged.file = incoming.file;
    merged.fileSource = incoming.fileSource ?? existing.fileSource;
    if ("selectedLines" in incoming) {
      merged.selectedLines = incoming.selectedLines;
    }
    return stripStaleContextWarning(normalizeRepoContext(merged));
  }

  if (!incoming.file?.trim() && existing.file?.trim()) {
    const preserveFile =
      !isExplicitRepoScope(existing) ||
      incoming.scope === "file" ||
      Boolean(incoming.file?.trim());
    if (!preserveFile) {
      merged.file = undefined;
      merged.fileSource = undefined;
      merged.selectedLines = undefined;
      merged.selectedSymbol = undefined;
      merged.languageId = undefined;
    } else {
    merged.file = existing.file;
    merged.fileSource = shouldPreserveFileSource(incoming.fileSource, existing.fileSource)
      ? existing.fileSource
      : incoming.fileSource ?? existing.fileSource;
    if (incoming.fileSource === "external" && existing.fileSource === "remote") {
      merged.contextWarning = isFocusLossDiskLinkWarning(incoming.contextWarning)
        ? existing.contextWarning && !isFocusLossDiskLinkWarning(existing.contextWarning)
          ? existing.contextWarning
          : undefined
        : incoming.contextWarning ?? existing.contextWarning;
    } else if (isFocusLossDiskLinkWarning(incoming.contextWarning)) {
      merged.contextWarning = undefined;
    } else if (
      isFocusLossDiskLinkWarning(merged.contextWarning) &&
      (isLocalDiskFileSource(merged.fileSource) || merged.fileSource === "remote")
    ) {
      merged.contextWarning = undefined;
    } else if (!incoming.contextWarning) {
      merged.contextWarning = isFocusLossDiskLinkWarning(existing.contextWarning)
        ? undefined
        : existing.contextWarning;
    }
    }
  }

  if (!incoming.owner?.trim() && existing.owner?.trim()) {
    merged.owner = existing.owner;
  }
  if (!incoming.repo?.trim() && existing.repo?.trim()) {
    merged.repo = existing.repo;
  }
  if (!incoming.branch?.trim() && existing.branch?.trim()) {
    merged.branch = existing.branch;
  }
  if (!incoming.provider && existing.provider) {
    merged.provider = existing.provider;
  }

  if (!incoming.selectedLines && existing.selectedLines && !("selectedLines" in incoming)) {
    merged.selectedLines = existing.selectedLines;
  }

  return stripStaleContextWarning(normalizeRepoContext(merged));
}

function shouldPreserveFileSource(
  incoming: RepoContext["fileSource"],
  existing: RepoContext["fileSource"]
): boolean {
  if (!existing) {
    return false;
  }
  if (incoming === "external" || incoming === undefined) {
    return existing === "remote" || existing === "workspace" || existing === "git";
  }
  return false;
}
