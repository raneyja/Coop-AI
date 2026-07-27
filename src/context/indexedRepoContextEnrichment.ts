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

function contextHasRepoSummaryEvidence(data: Record<string, unknown>): boolean {
  return hasRepoSummaryEvidence(data);
}

/**
 * Baseline indexed-repo evidence for every chat turn, quick action, and slash command
 * when the active repository is in the remote workspace.
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
  const summaryReady = contextHasRepoSummaryEvidence(baseData);
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
    return result;
  }

  const workspace = new IndexedRepoWorkspace(deps);

  const load = async (): Promise<ContextFetchResult> => {
    try {
      const [treeOverview, inventory, manifestFiles, remoteContent] = await Promise.all([
        needsTree ? workspace.getTreeOverview(normalizedTarget) : Promise.resolve(undefined),
        needsInventory
          ? workspace.getInventory(normalizedTarget, { fileCount: true, treeOverview: false, lineCount: false })
          : Promise.resolve(undefined),
        needsManifest || needsEntryFiles
          ? loadManifestEntries(
              deps.api,
              deps.apiBaseUrl,
              resolveInventoryRepoIds(repoId, normalizedTarget).candidates
            )
          : Promise.resolve([]),
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
          : Promise.resolve(undefined)
      ]);

      let merged = mergeRepoInventoryContext(result, inventory, treeOverview);

      if ((needsManifest || needsEntryFiles) && manifestFiles.length > 0) {
        const manifestStats = summarizeManifest(manifestFiles);
        const mergedData = asRecord(merged.data);
        merged = {
          ...merged,
          data: {
            ...mergedData,
            manifest: {
              fileCount: manifestStats.fileCount,
              entryPoints: manifestStats.entryPoints,
              extensionBreakdown: manifestStats.extensionBreakdown
            },
            indexedManifestSource: "indexed-manifest"
          }
        };
      }

      if (needsEntryFiles) {
        const treeForPick = {
          topLevelDirs: treeOverview?.topLevelDirs ?? [],
          topLevelFiles: treeOverview?.topLevelFiles ?? []
        };
        const entryPaths = pickEntryPaths({
          manifest: manifestFiles,
          treeOverview: treeForPick,
          activeFile: file
        });
        const entryFiles: Array<{ path: string; content: string; truncated?: boolean }> = [];
        for (const path of entryPaths) {
          const content = await readRepoFileForContext(deps, {
            repoId,
            owner: normalizedTarget.owner,
            repo: normalizedTarget.repo,
            branch: normalizedTarget.branch,
            provider: normalizedTarget.provider as CodeHostProviderPreference | undefined,
            path
          });
          if (!content?.trim()) {
            continue;
          }
          const truncated = content.length > MAX_ENTRY_FILE_CHARS;
          entryFiles.push({
            path,
            content: truncated ? `${content.slice(0, MAX_ENTRY_FILE_CHARS)}\n… [truncated]` : content,
            truncated
          });
          if (entryFiles.length >= MAX_ENTRY_FILES) {
            break;
          }
        }
        if (entryFiles.length > 0) {
          const mergedData = asRecord(merged.data);
          merged = {
            ...merged,
            data: {
              ...mergedData,
              entryFiles,
              source: mergedData.source ?? "indexed-entry-files"
            }
          };
        }
      }

      if (remoteContent && file) {
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
        merged = {
          ...merged,
          data: attachLocalFilesToData(asRecord(merged.data), payload)
        };
      }

      const finalData = asRecord(merged.data);
      const withMeta = {
        ...finalData,
        indexedWorkspaceAttached: true,
        indexedRepoId: repoId,
        ...(resolvedBranch?.trim() ? { resolvedBranch: resolvedBranch.trim() } : {})
      };
      if (!finalData.indexedWorkspaceAttached || resolvedBranch?.trim()) {
        merged = {
          ...merged,
          data: withMeta
        };
      }

      return merged;
    } catch {
      return result;
    }
  };

  return await Promise.race([
    load(),
    delayMs(budgetMs).then(() => result)
  ]);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
