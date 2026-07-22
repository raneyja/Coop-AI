import type { RepoContext } from "../chat/types";
import { isExplicitRepoScope, normalizeRepoContext } from "./contextScope";
import {
  coerceChipFileSource,
  shouldKeepRemoteProvenance
} from "./fileChipIdentity";
import { isLocalDiskFileSource } from "./localFileContext";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

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

function applyIncomingFileMeta(merged: RepoContext, incoming: RepoContext): void {
  if ("selectedLines" in incoming) {
    merged.selectedLines = incoming.selectedLines;
  }
  if ("selectedSymbol" in incoming) {
    merged.selectedSymbol = incoming.selectedSymbol;
  }
  if ("languageId" in incoming) {
    merged.languageId = incoming.languageId;
  }
}

/**
 * Merge incoming editor/webview context without clobbering repo/file fields
 * when the incoming snapshot is incomplete (e.g. virtual editor URIs, focus loss).
 */
export function mergeRepoContext(existing: RepoContext, incoming: RepoContext): RepoContext {
  // Explicit explorer "Use repo" clears any prior file chip — including Downloads / Cmd+O.
  // (normalize's absolute-path early-exit would otherwise re-force scope:"file".)
  if (isExplicitRepoScope(incoming) && !incoming.file?.trim()) {
    const cleared: RepoContext = {
      ...existing,
      ...incoming,
      scope: "repo",
      file: undefined,
      fileSource: undefined,
      selectedLines: undefined,
      selectedSymbol: undefined,
      languageId: undefined,
      contextWarning: undefined
    };
    if (!incoming.owner?.trim() && existing.owner?.trim()) {
      cleared.owner = existing.owner;
    }
    if (!incoming.repo?.trim() && existing.repo?.trim()) {
      cleared.repo = existing.repo;
    }
    if (!incoming.branch?.trim() && existing.branch?.trim()) {
      cleared.branch = existing.branch;
    }
    if (!incoming.provider && existing.provider) {
      cleared.provider = existing.provider;
    }
    return stripStaleContextWarning(normalizeRepoContext(cleared));
  }

  const merged: RepoContext = {
    ...existing,
    ...incoming
  };

  // Active editor file always wins over explorer "Use repo" scope — including Downloads.
  if (incoming.file?.trim()) {
    merged.file = incoming.file.trim();
    merged.scope = "file";
    applyIncomingFileMeta(merged, incoming);

    if (isOsAbsoluteDiskPath(incoming.file) || incoming.fileSource === "external") {
      // Downloads / Cmd+O — always L; never inherit a prior "remote" stamp.
      merged.fileSource = "external";
      merged.contextWarning = undefined;
    } else if (shouldKeepRemoteProvenance(existing, incoming)) {
      // Explorer remote pick opened via local clone — keep R + repo-relative path.
      merged.file = existing.file?.trim() || incoming.file.trim();
      merged.fileSource = "remote";
      if ("contextWarning" in incoming) {
        merged.contextWarning = incoming.contextWarning;
      }
    } else {
      merged.fileSource = coerceChipFileSource(
        merged.file,
        incoming.fileSource ?? existing.fileSource
      );
      if (merged.fileSource === "external") {
        merged.contextWarning = undefined;
      } else if ("contextWarning" in incoming) {
        merged.contextWarning = incoming.contextWarning;
      }
    }
  } else if (
    incoming.fileSource === "external" &&
    isFocusLossDiskLinkWarning(incoming.contextWarning)
  ) {
    // Sidebar focus steal: keep prior file identity; drop the disk-link banner.
    merged.file = existing.file;
    merged.fileSource = existing.fileSource;
    merged.contextWarning = undefined;
  } else if (!incoming.file?.trim() && existing.file?.trim()) {
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
        : coerceChipFileSource(existing.file, incoming.fileSource ?? existing.fileSource);
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
