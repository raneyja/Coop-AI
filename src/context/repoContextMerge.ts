import type { RepoContext } from "../chat/types";

/**
 * Merge incoming editor/webview context without clobbering repo/file fields
 * when the incoming snapshot is incomplete (e.g. virtual editor URIs, focus loss).
 */
export function mergeRepoContext(existing: RepoContext, incoming: RepoContext): RepoContext {
  const merged: RepoContext = {
    ...existing,
    ...incoming
  };

  if (!incoming.file?.trim() && existing.file?.trim()) {
    merged.file = existing.file;
    merged.fileSource = shouldPreserveFileSource(incoming.fileSource, existing.fileSource)
      ? existing.fileSource
      : incoming.fileSource ?? existing.fileSource;
    if (incoming.fileSource === "external" && existing.fileSource === "remote") {
      merged.contextWarning = existing.contextWarning;
    } else if (!incoming.contextWarning && existing.contextWarning) {
      merged.contextWarning = existing.contextWarning;
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

  if (!incoming.selectedLines && existing.selectedLines) {
    merged.selectedLines = existing.selectedLines;
  }

  return merged;
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
