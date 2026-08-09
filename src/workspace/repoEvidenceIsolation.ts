import type { RepoContext } from "../chat/types";
import { isExplicitRepoScope } from "../context/contextScope";
import { isOsAbsoluteDiskPath } from "../context/outsideWorkspaceFile";

/**
 * Enterprise trust: assembled code evidence must belong to the active Use-repo.
 * Soft prompt text is not enough — callers must drop foreign active-file chips
 * and refuse wrong-repo / local-workspace bodies before synthesis.
 */

export type RepoCoords = {
  owner?: string;
  repo?: string;
  repoId?: string;
  provider?: string;
};

export type CodeEvidenceSnippet = {
  path: string;
  repoId?: string;
  content?: string;
};

function normalizeSlug(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

/** Parse `github:owner/repo` or bare `owner/repo` into owner/repo. */
export function parseRepoIdCoords(repoId: string | undefined): { owner?: string; repo?: string } {
  const raw = repoId?.trim();
  if (!raw) {
    return {};
  }
  const withoutProvider = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const [owner, repo] = withoutProvider.split("/").map((part) => part.trim());
  if (!owner || !repo) {
    return {};
  }
  return { owner, repo };
}

export function repoSlug(coords: RepoCoords): string | undefined {
  const fromParts = normalizeSlug(coords.owner) && normalizeSlug(coords.repo)
    ? `${normalizeSlug(coords.owner)}/${normalizeSlug(coords.repo)}`
    : undefined;
  if (fromParts) {
    return fromParts;
  }
  const parsed = parseRepoIdCoords(coords.repoId);
  if (normalizeSlug(parsed.owner) && normalizeSlug(parsed.repo)) {
    return `${normalizeSlug(parsed.owner)}/${normalizeSlug(parsed.repo)}`;
  }
  return undefined;
}

export function sameRepoCoords(left: RepoCoords, right: RepoCoords): boolean {
  const a = repoSlug(left);
  const b = repoSlug(right);
  if (!a || !b) {
    return false;
  }
  return a === b;
}

/**
 * True when an evidence snippet's repoId matches the active Use-repo.
 * Snippets without repoId are treated as active-repo only when `allowMissingRepoId`
 * is true (legacy search hits that were already scoped by the search call).
 */
export function snippetBelongsToActiveRepo(
  snippet: Pick<CodeEvidenceSnippet, "repoId">,
  active: RepoCoords,
  options?: { allowMissingRepoId?: boolean }
): boolean {
  const activeSlug = repoSlug(active);
  if (!activeSlug) {
    return false;
  }
  const evidenceId = snippet.repoId?.trim();
  if (!evidenceId) {
    return options?.allowMissingRepoId !== false;
  }
  return sameRepoCoords({ repoId: evidenceId }, active);
}

/** Keep only snippets whose repoId matches the active Use-repo. */
export function filterCodeEvidenceToActiveRepo<T extends CodeEvidenceSnippet>(
  files: T[],
  active: RepoCoords,
  options?: { allowMissingRepoId?: boolean }
): T[] {
  return files.filter((file) => snippetBelongsToActiveRepo(file, active, options));
}

/**
 * Active-file chip is foreign to Use-repo when:
 * - chip carries a different owner/repo than Use-repo, or
 * - chip is a local workspace/git buffer while Use-repo is a different remote repo
 *   (`localWorkspaceMatchesUseRepo === false`).
 *
 * Outside-workspace Downloads files are left alone (explicit local attach).
 */
export function isForeignActiveFileForUseRepo(
  ctx: Pick<RepoContext, "owner" | "repo" | "file" | "fileSource" | "scope">,
  options?: {
    fileOwner?: string;
    fileRepo?: string;
    /** False when the open VS Code folder is not a clone/VFS of Use-repo. */
    localWorkspaceMatchesUseRepo?: boolean;
  }
): boolean {
  const useOwner = ctx.owner?.trim();
  const useRepo = ctx.repo?.trim();
  const file = ctx.file?.trim();
  if (!useOwner || !useRepo || !file) {
    return false;
  }
  if (isOsAbsoluteDiskPath(file) || ctx.fileSource === "external") {
    return false;
  }

  const fileOwner = options?.fileOwner?.trim() || undefined;
  const fileRepo = options?.fileRepo?.trim() || undefined;
  if (fileOwner && fileRepo && !sameRepoCoords({ owner: fileOwner, repo: fileRepo }, { owner: useOwner, repo: useRepo })) {
    return true;
  }

  const localSource = ctx.fileSource === "workspace" || ctx.fileSource === "git";
  if (localSource && options?.localWorkspaceMatchesUseRepo === false) {
    return true;
  }

  return false;
}

function clearActiveFileFields(ctx: RepoContext): RepoContext {
  return {
    ...ctx,
    file: undefined,
    fileSource: undefined,
    selectedLines: undefined,
    selectedSymbol: undefined,
    languageId: undefined,
    scope: ctx.owner?.trim() && ctx.repo?.trim() ? "repo" : ctx.scope,
    contextWarning: undefined
  };
}

/**
 * Drop active-file evidence when it belongs to another repo than Use-repo.
 * Prefer silent drop for Gaps / Understand / structure — never silently merge foreign code.
 */
export function dropForeignActiveFileEvidence(
  ctx: RepoContext,
  options?: {
    fileOwner?: string;
    fileRepo?: string;
    localWorkspaceMatchesUseRepo?: boolean;
  }
): RepoContext {
  if (!isForeignActiveFileForUseRepo(ctx, options)) {
    return ctx;
  }
  return clearActiveFileFields(ctx);
}

/**
 * Quick actions that must never treat a foreign open editor as the audit target.
 * Understand Repo already clears all file chips; Gaps / structure share this gate.
 */
export function shouldIsolateActiveFileForQuickAction(quickAction: string | undefined): boolean {
  return (
    quickAction === "knowledge-gaps" ||
    quickAction === "understand-repo" ||
    quickAction === "blast-radius" ||
    quickAction === "find-owner" ||
    quickAction === "trace-decision"
  );
}

/**
 * When Use-repo is sticky (scope:repo) and no intentional in-repo file chip exists,
 * do not invent active-file evidence from a leftover editor tab.
 */
export function shouldSkipLocalEditorAttachForRepoScope(ctx: RepoContext): boolean {
  return isExplicitRepoScope(ctx) && !ctx.file?.trim();
}

/** Prompt / Sources label: org docs are supplementary, not repo architecture SoT. */
export const ORG_DOCS_EVIDENCE_LABEL =
  "Org docs (org-wide Confluence/Notion — not this repository's architecture source of truth)";

export function orgDocsSynthesisGuardrail(activeOwner?: string, activeRepo?: string): string {
  const label =
    activeOwner?.trim() && activeRepo?.trim()
      ? `${activeOwner.trim()}/${activeRepo.trim()}`
      : "the active Use-repo";
  return (
    `Org documentation hits (Confluence/Notion/Google Docs) are org-wide supplementary context. ` +
    `Label them as org docs in the answer. Never treat them as ${label}'s architecture source of truth ` +
    `(especially Coop-AI ADRs or pages about other products). Prefer indexed repo code, inventory, and tree for architecture.`
  );
}
