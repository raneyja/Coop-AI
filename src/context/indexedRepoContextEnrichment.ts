import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { SecureApiClient } from "../chat/SecureApiClient";
import type { CodeHostProviderPreference } from "../chat/types";
import {
  attachLocalFilesToData,
  localFilesFromContextData,
  normalizeRelativePath,
  sliceFileContent,
  type LocalFileContextPayload
} from "./localFileContext";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import { loadManifestEntries, pickEntryPaths, summarizeManifest, hasRepoSummaryEvidence } from "./buildRepoSummaryContext";
import { IndexedRepoWorkspace, mergeRepoInventoryContext } from "../workspace/IndexedRepoWorkspace";
import { resolveInventoryRepoIds } from "../workspace/repoInventorySources";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import type { IndexedRepoFileReadRequest } from "./indexedRepoFileRegistry";
import { resolveActiveRepoTarget } from "../workspace/repoTargetResolver";
import { COOP_EXTENSION_BUILD_ID } from "../config/coopBuildId";

const MAX_ENTRY_FILES = 6;
const MAX_ENTRY_FILE_CHARS = 12_000;

export type IndexedRepoContextDeps = {
  api: SecureApiClient;
  apiBaseUrl: string;
  codeHostRouter: CodeHostRouter;
};

export async function readRepoFileForContext(
  deps: IndexedRepoContextDeps,
  request: IndexedRepoFileReadRequest
): Promise<string | undefined> {
  const workspace = new IndexedRepoWorkspace(deps);
  const provider =
    request.provider === "gitlab" || request.provider === "bitbucket" ? request.provider : "github";
  const target: RepoTarget = {
    repoId: request.repoId,
    owner: request.owner,
    repo: request.repo,
    branch: request.branch,
    provider
  };
  const path = normalizeRelativePath(request.path);
  if (!path) {
    return undefined;
  }
  const file = await workspace.readFile(target, path);
  if (!file?.content?.trim()) {
    return undefined;
  }
  const sliced = sliceFileContent(file.content, request.lines);
  return sliced.content.slice(0, 12_000);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function withResolvedMeta(
  merged: ContextFetchResult,
  repoId: string,
  resolvedBranch: string | undefined
): ContextFetchResult {
  const data = asRecord(merged.data);
  return {
    ...merged,
    data: {
      ...data,
      indexedWorkspaceAttached: true,
      indexedRepoId: repoId,
      ...(resolvedBranch?.trim() ? { resolvedBranch: resolvedBranch.trim() } : {})
    }
  };
}

/**
 * Baseline indexed-repo evidence for every chat turn, quick action, and slash command
 * when the active repository is in the remote workspace.
 *
 * On budget timeout, returns the best partial evidence already fetched — never discards
 * a successful inventory/tree to an empty shell.
 */
export async function enrichContextWithIndexedRepo(options: {
  deps: IndexedRepoContextDeps;
  target: RepoTarget;
  request: ContextFetchRequest;
  result: ContextFetchResult;
  budgetMs: number;
  resolveWorkspaceBranch?: (repoId: string) => Promise<string | undefined>;
}): Promise<ContextFetchResult> {
  const { deps, request, result, budgetMs, resolveWorkspaceBranch } = options;
  if (budgetMs <= 0 || !options.target.repoId?.trim()) {
    return result;
  }

  const normalizedTarget = await resolveActiveRepoTarget(options.target, {
    api: deps.api,
    apiBaseUrl: deps.apiBaseUrl,
    codeHostRouter: deps.codeHostRouter,
    resolveWorkspaceBranch
  });
  const resolvedBranch = normalizedTarget.branch;
  const repoId = normalizedTarget.repoId?.trim() ?? "";
  if (!repoId) {
    return result;
  }

  const baseData = asRecord(result.data);
  const summaryReady = hasRepoSummaryEvidence(baseData);
  const needsTree = !baseData.treeOverview;
  const needsInventory = !baseData.repoInventory;
  const needsManifest = !summaryReady && !baseData.manifest;
  const needsEntryFiles =
    request.params.quickAction === "understand-repo" &&
    !(Array.isArray(baseData.entryFiles) && baseData.entryFiles.length > 0);
  const file = request.params.file?.trim();
  const isRemoteFile = request.params.fileSource === "remote";
  const needsRemoteFile = Boolean(file && isRemoteFile && localFilesFromContextData(baseData).length === 0);

  if (!needsTree && !needsInventory && !needsManifest && !needsRemoteFile && !needsEntryFiles) {
    return withResolvedMeta(result, repoId, resolvedBranch);
  }

  const workspace = new IndexedRepoWorkspace(deps);
  // Mutated as stages complete so a budget timeout keeps partial evidence.
  let latest = withResolvedMeta(result, repoId, resolvedBranch);
  let timedOut = false;

  const load = async (): Promise<ContextFetchResult> => {
    try {
      // Start all fetches, but commit inventory/tree as soon as each resolves so a
      // budget timeout keeps partial evidence instead of an empty shell.
      const inventoryPromise = needsInventory
        ? workspace.getInventory(
            normalizedTarget,
            { fileCount: true, treeOverview: false, lineCount: false },
            { allowExpensiveTreeWalk: false }
          )
        : Promise.resolve(undefined);
      const treePromise = needsTree
        ? workspace.getTreeOverview(normalizedTarget)
        : Promise.resolve(undefined);
      const manifestPromise =
        needsManifest || needsEntryFiles
          ? loadManifestEntries(
              deps.api,
              deps.apiBaseUrl,
              resolveInventoryRepoIds(repoId, normalizedTarget).candidates
            )
          : Promise.resolve([]);
      const remotePromise =
        needsRemoteFile && file
          ? readRepoFileForContext(deps, {
              repoId,
              owner: normalizedTarget.owner,
              repo: normalizedTarget.repo,
              branch: normalizedTarget.branch,
              provider: normalizedTarget.provider as CodeHostProviderPreference | undefined,
              path: file,
              lines: request.params.lines
            })
          : Promise.resolve(undefined);

      const inventory = await inventoryPromise;
      if (!timedOut) {
        latest = withResolvedMeta(
          mergeRepoInventoryContext(latest, inventory, undefined),
          repoId,
          resolvedBranch
        );
      }

      const treeOverview = await treePromise;
      if (!timedOut) {
        latest = withResolvedMeta(
          mergeRepoInventoryContext(latest, undefined, treeOverview),
          repoId,
          resolvedBranch
        );
      }

      const manifestFiles = await manifestPromise;
      if (!timedOut && (needsManifest || needsEntryFiles) && manifestFiles.length > 0) {
        const manifestStats = summarizeManifest(manifestFiles);
        const mergedData = asRecord(latest.data);
        latest = withResolvedMeta(
          {
            ...latest,
            data: {
              ...mergedData,
              manifest: {
                fileCount: manifestStats.fileCount,
                entryPoints: manifestStats.entryPoints,
                extensionBreakdown: manifestStats.extensionBreakdown
              },
              indexedManifestSource: "indexed-manifest"
            }
          },
          repoId,
          resolvedBranch
        );
      }

      if (needsEntryFiles && !timedOut) {
        const treeForPick = {
          topLevelDirs: treeOverview?.topLevelDirs ?? [],
          topLevelFiles: treeOverview?.topLevelFiles ?? []
        };
        const entryPaths = pickEntryPaths({
          manifest: manifestFiles,
          treeOverview: treeForPick,
          activeFile: file
        });
        // Parallel reads within budget — sequential waits burned the 15s gather window
        // before a single README landed in Sources.
        const settled = await Promise.all(
          entryPaths.map(async (path) => {
            if (timedOut) {
              return undefined;
            }
            const content = await readRepoFileForContext(deps, {
              repoId,
              owner: normalizedTarget.owner,
              repo: normalizedTarget.repo,
              branch: normalizedTarget.branch,
              provider: normalizedTarget.provider as CodeHostProviderPreference | undefined,
              path
            });
            if (!content?.trim()) {
              return undefined;
            }
            const truncated = content.length > MAX_ENTRY_FILE_CHARS;
            return {
              path,
              content: truncated ? `${content.slice(0, MAX_ENTRY_FILE_CHARS)}\n… [truncated]` : content,
              truncated
            };
          })
        );
        const entryFiles = settled
          .filter((entry): entry is { path: string; content: string; truncated: boolean } => Boolean(entry))
          .slice(0, MAX_ENTRY_FILES);
        if (entryFiles.length > 0) {
          const mergedData = asRecord(latest.data);
          latest = withResolvedMeta(
            {
              ...latest,
              data: {
                ...mergedData,
                entryFiles,
                source: mergedData.source ?? "indexed-entry-files"
              }
            },
            repoId,
            resolvedBranch
          );
        }
      }

      const remoteContent = await remotePromise;
      if (remoteContent && file && !timedOut) {
        const payload: LocalFileContextPayload = {
          source: "remote-codehost",
          activeFile: normalizeRelativePath(file),
          files: [
            {
              path: normalizeRelativePath(file),
              content: remoteContent,
              ...(request.params.lines
                ? { lineRange: [request.params.lines.start, request.params.lines.end] as [number, number] }
                : {})
            }
          ],
          fallbackLevel: "partial"
        };
        latest = withResolvedMeta(
          {
            ...latest,
            data: attachLocalFilesToData(asRecord(latest.data), payload)
          },
          repoId,
          resolvedBranch
        );
      }

      return latest;
    } catch {
      return latest;
    }
  };

  const loadPromise = load();
  const timeoutPromise = delayMs(budgetMs).then(() => {
    timedOut = true;
    return latest;
  });

  return await Promise.race([loadPromise, timeoutPromise]);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honest user-facing copy when Understand Repo has no attachable evidence. */
export function understandRepoEmptyEvidenceMessage(options: {
  owner?: string;
  repo?: string;
  branch?: string;
}): string {
  const label =
    options.owner && options.repo ? `${options.owner}/${options.repo}` : "this repository";
  const branch = options.branch?.trim();
  return [
    `Attach check failed [${COOP_EXTENSION_BUILD_ID}]: Coop could not attach repository evidence for ${label}` +
      (branch ? ` (branch \`${branch}\`)` : "") +
      ".",
    "",
    "Deep-Index may be ready, but this turn did not receive file bodies, inventory, or a tree overview — so Coop will not invent an architecture summary.",
    "",
    "Try again in a moment, confirm the Remote workspace repo is selected, or Reindex the repo in the admin portal if browse still works but chat does not."
  ].join("\n");
}

/** True when at least one entry file body is attached (required for architecture synthesis). */
export function hasUnderstandRepoEntryBodies(data: Record<string, unknown> | undefined): boolean {
  if (!data) {
    return false;
  }
  const entryFiles = Array.isArray(data.entryFiles) ? data.entryFiles : [];
  return entryFiles.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const content = (entry as { content?: unknown }).content;
    return typeof content === "string" && content.trim().length > 0;
  });
}

/**
 * Inventory/tree without file bodies — enough to prove the index is reachable,
 * not enough to write an architecture essay.
 */
export function understandRepoMissingEntryBodiesMessage(options: {
  owner?: string;
  repo?: string;
  branch?: string;
  hasInventory?: boolean;
  hasTree?: boolean;
}): string {
  const label =
    options.owner && options.repo ? `${options.owner}/${options.repo}` : "this repository";
  const branch = options.branch?.trim();
  const attached: string[] = [];
  if (options.hasInventory) {
    attached.push("inventory");
  }
  if (options.hasTree) {
    attached.push("tree overview");
  }
  const attachedLine =
    attached.length > 0
      ? `Attached so far: ${attached.join(" + ")}. Missing: real file bodies (README / package.json / entry points).`
      : "No entry file bodies were attached.";
  return [
    `Attach check failed [${COOP_EXTENSION_BUILD_ID}]: Coop reached ${label}` +
      (branch ? ` on branch \`${branch}\`` : "") +
      " but could not load anchor file contents.",
    "",
    attachedLine,
    "",
    "Coop will not invent an architecture summary from repo identity alone. Retry Understand Repo, or confirm Remote browse can open the same files on this branch."
  ].join("\n");
}
