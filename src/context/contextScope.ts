import type { RepoContext } from "../chat/types";
import { coerceChipFileSource } from "./fileChipIdentity";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

export type ContextScope = "repo" | "file";

export type RepoSelectContextPayload = Pick<RepoContext, "provider" | "owner" | "repo" | "branch">;

export type RepoFileContextOptions = {
  provider?: RepoContext["provider"];
  branch?: string;
  fileSource?: RepoContext["fileSource"];
  selectedLines?: RepoContext["selectedLines"];
  selectedSymbol?: RepoContext["selectedSymbol"];
  languageId?: string;
};

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Repo-only context chosen in explorer; editor/send should not attach a file until one is picked. */
export function isExplicitRepoScope(ctx: RepoContext): boolean {
  return ctx.scope === "repo";
}

export function inferContextScope(ctx: RepoContext): ContextScope {
  if (ctx.scope === "repo") {
    return "repo";
  }
  if (ctx.scope === "file") {
    return normalizeText(ctx.file) ? "file" : "repo";
  }
  return normalizeText(ctx.file) ? "file" : "repo";
}

export function normalizeRepoContext(ctx: RepoContext): RepoContext {
  const normalized: RepoContext = {
    ...ctx,
    owner: normalizeText(ctx.owner),
    repo: normalizeText(ctx.repo),
    branch: normalizeText(ctx.branch),
    file: normalizeText(ctx.file)
  };
  // Outside-workspace disk file: absolute path is always local (L), never remote.
  if (normalized.file && isOsAbsoluteDiskPath(normalized.file)) {
    normalized.scope = "file";
    normalized.fileSource = "external";
    normalized.contextWarning = undefined;
    return normalized;
  }
  if (normalized.file && normalized.fileSource === "external") {
    normalized.scope = "file";
    normalized.contextWarning = undefined;
    return normalized;
  }
  // Never keep orphan "external" without a path — that produced a useless "Outside workspace" chip.
  if (normalized.fileSource === "external" && !normalized.file) {
    normalized.fileSource = undefined;
  }
  // Explicit explorer "Use repo" only — clears file fields.
  // Do NOT invent scope:"repo" from a bare owner/repo seed; that made isExplicitRepoScope
  // true and showed /Coop-AI while a Downloads tab was still open.
  if (ctx.scope === "repo") {
    normalized.scope = "repo";
    normalized.file = undefined;
    normalized.fileSource = undefined;
    normalized.selectedLines = undefined;
    normalized.selectedSymbol = undefined;
    normalized.languageId = undefined;
    return normalized;
  }
  if (normalized.file) {
    normalized.scope = "file";
    normalized.fileSource = coerceChipFileSource(normalized.file, normalized.fileSource);
    return normalized;
  }
  normalized.scope = undefined;
  return normalized;
}

export function repoContextForRepoSelect(payload: RepoSelectContextPayload): Partial<RepoContext> {
  return normalizeRepoContext({
    provider: payload.provider,
    owner: payload.owner,
    repo: payload.repo,
    branch: payload.branch,
    scope: "repo"
  });
}

export function repoContextForFile(
  file: string,
  owner?: string,
  repo?: string,
  options: RepoFileContextOptions = {}
): Partial<RepoContext> {
  return normalizeRepoContext({
    provider: options.provider,
    owner,
    repo,
    branch: options.branch,
    file,
    fileSource: coerceChipFileSource(file, options.fileSource),
    selectedLines: options.selectedLines,
    selectedSymbol: options.selectedSymbol,
    languageId: options.languageId,
    scope: "file"
  });
}

export function displayRepoLabel(owner: string | undefined, repo: string | undefined): string {
  const repoName = normalizeText(repo);
  if (repoName) {
    return `/${repoName}`;
  }
  const ownerName = normalizeText(owner);
  return ownerName ? `/${ownerName}` : "/";
}

export function displayFileLabel(file: string | undefined): string {
  const filePath = normalizeText(file);
  if (!filePath) {
    return "";
  }
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
}
