import type { IndexedRepoFileMap } from "../api/CoopBackendClient";
import { rankExplorerFilePaths } from "../api/codeHosts/explorerFileTreeSearch";
import type { ContextFetchResult } from "../context/requestBatcher";
import type {
  RepoFileEvidence,
  RepoIdentity,
  RepoInventoryEvidence,
  RepoTarget,
  RepoTreeEvidence
} from "./indexedRepoWorkspaceTypes";
import type { RepoFactNeeds } from "./repoFactIntent";
import { parseCodeHostProvider } from "../api/codeHosts/types";
import {
  fetchIndexStatsInventory,
  fetchManifestInventory,
  fetchTreeInventory,
  fetchTreeOverview,
  resolveInventoryRepoIds,
  type RepoInventoryDeps
} from "./repoInventorySources";

/**
 * The single entry point for "what does Coop know about this indexed repo".
 *
 * Deep-Index stores a map plus durable facts — never a full copy of the source.
 * Facts (identity, counts, tree) come from the index; file bodies are fetched on
 * demand. Chat, agent tools, and UI must go through this facade so a repository
 * total is always measured, never estimated from a retrieval sample.
 */
export class IndexedRepoWorkspace {
  // A workspace instance belongs to one frozen gather. Do not retain it across turns.
  private readonly fileMaps = new Map<string, Promise<IndexedRepoFileMap | undefined>>();

  public constructor(private readonly deps: RepoInventoryDeps) {}

  /** Complete durable path map; undefined means unavailable, [] means no filename matches. */
  public async findFiles(
    target: RepoTarget,
    query: string,
    options?: {
      limit?: number;
      acceptPath?: (path: string) => boolean;
      /** Tell the cloud filename search to exclude UI paths and widen via the tree fallback. */
      excludeClientUi?: boolean;
      rankPaths?: (paths: string[]) => string[];
      /** Augment non-empty indexed matches when task evidence needs a wider host filename pool. */
      augmentFromCodeHost?: boolean;
      onDiagnostic?: (event: Record<string, unknown>) => void;
    }
  ): Promise<Array<{ path: string; name: string }> | undefined> {
    const identity = this.getIdentity(target);
    if (!identity || !identity.branch?.trim() || !query.trim()) {
      return undefined;
    }
    try {
      const key = JSON.stringify([this.deps.apiBaseUrl, identity.repoId, identity.branch]);
      let pending = this.fileMaps.get(key);
      if (!pending) {
        pending = this.deps.api.fetchIndexedRepoFileMap(
          this.deps.apiBaseUrl, identity.repoId, identity.branch, options?.onDiagnostic
        ).catch(() => undefined);
        this.fileMaps.set(key, pending);
      }
      const map = await pending;
      const fallbackToCodeHost = async (reason: string): Promise<Array<{ path: string; name: string }> | undefined> => {
        options?.onDiagnostic?.({
          stage: "indexed-map-fallback",
          requestedRepoId: identity.repoId,
          requestedBranch: identity.branch,
          responseRepoId: map?.repoId,
          responseIndexedBranch: map?.indexedBranch,
          responseIndexedCommit: map?.indexedCommit,
          responseStale: map?.stale,
          responseHasDataArray: Array.isArray(map?.data),
          responseFileCount: Array.isArray(map?.data) ? map.data.length : undefined,
          status: undefined,
          fallbackReason: reason
        });
        // The index map is the preferred filename source, but a stale map must
        // not turn a server-side locate into a one-search miss. The same
        // branch-bound fallback is also required when the map response has
        // usable file data but omits branch metadata.
        const coordinates = resolveInventoryRepoIds(identity.repoId, identity).coords;
        if (!coordinates) {
          return undefined;
        }
        try {
          // Task-specific ranking happens after filename discovery. Request a
          // wider host pool first so unrelated sign-in/sign-out or infrastructure
          // files cannot hide the actual operation before that ranking runs.
          const fallbackLimit = Math.max(options?.limit ?? 20, 100);
          const normalizedFilenameQuery = query.replace(/[.]+$/g, "").trim();
          const augmentationQueries = options?.augmentFromCodeHost
            ? [...new Set([
                normalizedFilenameQuery,
                ...(normalizedFilenameQuery.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? [])
                  .filter((word) => word.length >= 4 && !new Set(["must", "with", "that", "where", "does", "this", "from", "signer", "document", "pending"]).has(word))
                  .flatMap((word) => [word, word.replace(/(?:ing|ed|er)$/, "")])
              ])].slice(0, 5)
            : [normalizedFilenameQuery];
          const fallbackHits = (await Promise.all(augmentationQueries.map((candidate) =>
            this.deps.codeHostRouter.searchRepositoryFiles(candidate, coordinates, fallbackLimit, {
              excludeClientUi: options?.excludeClientUi
            })
          ))).flat();
          const paths = [...new Set(fallbackHits.map((file) => file.path))]
            .filter((path) => typeof path === "string" && Boolean(path.trim()))
            .filter((path) => !options?.acceptPath || options.acceptPath(path));
          const matches = rankExplorerFilePaths(paths, query, paths.length);
          return (options?.rankPaths ? options.rankPaths(matches) : matches)
            .slice(0, Math.max(1, Math.min(100, options?.limit ?? 20)))
            .map((path) => ({ path, name: path.split("/").pop() ?? path }));
        } catch (error) {
          const details = error as Error & { code?: unknown; status?: unknown; response?: { status?: unknown } };
          options?.onDiagnostic?.({
            stage: "code-host-filename-fallback",
            outcome: "error",
            errorName: error instanceof Error ? error.name : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorCode: typeof details.code === "string" ? details.code : undefined,
            errorStatus: typeof details.status === "number"
              ? details.status
              : typeof details.response?.status === "number" ? details.response.status : undefined
          });
          return undefined;
        }
      };
      // A same-repo legacy map without ref metadata is a filename lead, never
      // source evidence or inventory for the selected branch. Read every lead
      // through readFile(target, path) before answering. Do not spend the entire
      // interactive budget walking folders when useful paths already exist.
      if (map?.repoId === identity.repoId && !map.indexedBranch && !map.stale && Array.isArray(map.data)) {
        const paths = [...new Set(map.data.map(file => file.path))]
          .filter(path => typeof path === "string" && Boolean(path.trim()))
          .filter(path => !options?.acceptPath || options.acceptPath(path));
        const matches = rankExplorerFilePaths(paths, query, paths.length);
        const ranked = options?.rankPaths ? options.rankPaths(matches) : matches;
        if (ranked.length) {
          options?.onDiagnostic?.({ stage: "indexed-map-leads", requestedRepoId: identity.repoId,
            requestedBranch: identity.branch, provenance: "unverified-ref-paths", pathCount: ranked.length });
          return ranked.slice(0, Math.max(1, Math.min(100, options?.limit ?? 20)))
            .map(path => ({path, name: path.split("/").pop() ?? path}));
        }
      }
      if (!map || map.repoId !== identity.repoId || !map.indexedBranch ||
          (identity.branch && map.indexedBranch !== identity.branch)) {
        const fallbackReason = !map
          ? "map_unavailable"
          : map.repoId !== identity.repoId
            ? "response_repo_mismatch"
            : !map.indexedBranch
              ? "response_branch_metadata_missing"
              : "response_branch_mismatch";
        return fallbackToCodeHost(fallbackReason);
      }
      if (map.stale) {
        return fallbackToCodeHost("response_stale");
      }
      const paths = [...new Set(map.data.map((file) => file.path)
        .filter((path) => typeof path === "string" && Boolean(path.trim())))]
        .filter((path) => !options?.acceptPath || options.acceptPath(path));
      const limit = Math.max(1, Math.min(100, options?.limit ?? 20));
      const matches = rankExplorerFilePaths(paths, query, paths.length);
      if (matches.length === 0) {
        // A map can be valid for the requested branch and still be partial or
        // older than the source tree. An empty map match is not proof that the
        // file does not exist; give the live branch-bound host/tree search a
        // chance before returning no candidate to the agent.
        return (await fallbackToCodeHost("no_filename_matches")) ?? [];
      }
      if (options?.augmentFromCodeHost) {
        const liveMatches = await fallbackToCodeHost("augment_nonempty_map");
        if (liveMatches?.length) {
          const merged = [...new Set([...matches, ...liveMatches.map((file) => file.path)])];
          const ranked = options.rankPaths ? options.rankPaths(merged) : rankExplorerFilePaths(merged, query, merged.length);
          return ranked.slice(0, limit)
            .map((path) => ({ path, name: path.split("/").pop() ?? path }));
        }
      }
      return (options?.rankPaths ? options.rankPaths(matches) : matches).slice(0, limit)
        .map((path) => ({ path, name: path.split("/").pop() ?? path }));
    } catch (error) {
      const details = error as Error & { code?: unknown; status?: unknown; response?: { status?: unknown } };
      options?.onDiagnostic?.({
        stage: "indexed-workspace",
        outcome: "error",
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: typeof details.code === "string" ? details.code : undefined,
        errorStatus: typeof details.status === "number"
          ? details.status
          : typeof details.response?.status === "number" ? details.response.status : undefined
      });
      return undefined;
    }
  }

  public getIdentity(target: RepoTarget): RepoIdentity | undefined {
    const repoId = target.repoId?.trim();
    if (!repoId) {
      return undefined;
    }
    const resolved = resolveInventoryRepoIds(repoId, target);
    return {
      repoId: resolved.preferred,
      provider: resolved.coords?.provider ?? parseCodeHostProvider(target.provider),
      owner: resolved.coords?.owner ?? target.owner,
      repo: resolved.coords?.repo ?? target.repo,
      branch: resolved.coords?.branch ?? target.branch
    };
  }

  /**
   * Repository totals in a fixed source order so the same question always gets
   * the same number. Returns `unavailable` rather than a guess.
   */
  public async getInventory(
    target: RepoTarget,
    needs: RepoFactNeeds,
    options?: { allowExpensiveTreeWalk?: boolean }
  ): Promise<RepoInventoryEvidence> {
    const repoId = target.repoId?.trim();
    if (!repoId) {
      return {
        source: "unavailable",
        note: "No repository is selected, so Coop cannot measure this repository."
      };
    }

    const resolved = resolveInventoryRepoIds(repoId, target);

    const fromStats = await fetchIndexStatsInventory(this.deps, resolved.candidates);
    if (fromStats) {
      return withInventoryNote(fromStats, needs);
    }

    const fromManifest = await fetchManifestInventory(this.deps, resolved.candidates);
    if (fromManifest) {
      return withInventoryNote(fromManifest, needs);
    }

    // Recursive live tree count can take minutes on large repos — never on the chat hot path.
    if (options?.allowExpensiveTreeWalk !== false) {
      const fromTree = await fetchTreeInventory(this.deps, resolved.coords);
      if (fromTree) {
        return withInventoryNote(fromTree, needs);
      }
    }

    return {
      source: "unavailable",
      note: unavailableNote(needs)
    };
  }

  public async getTreeOverview(target: RepoTarget): Promise<RepoTreeEvidence | undefined> {
    const repoId = target.repoId?.trim();
    const resolved = repoId
      ? resolveInventoryRepoIds(repoId, target)
      : target.owner && target.repo
        ? resolveInventoryRepoIds(`${target.owner}/${target.repo}`, target)
        : undefined;
    return fetchTreeOverview(this.deps, resolved?.coords);
  }

  /**
   * One-level directory listing for the active Use-repo.
   * Prefer code-host tree; fall back to Coop org tree API (same path Remote browse uses)
   * so package-boundary gather works when the host listing is unavailable.
   */
  public async listDirectory(
    target: RepoTarget,
    path = ""
  ): Promise<Array<{ name: string; type: "dir" | "file" }> | undefined> {
    const cleanPath = path.replace(/^\/+|\/+$/g, "");
    const repoId = target.repoId?.trim();
    const resolved = repoId
      ? resolveInventoryRepoIds(repoId, target)
      : target.owner && target.repo
        ? resolveInventoryRepoIds(`${target.owner}/${target.repo}`, target)
        : undefined;
    const coords = resolved?.coords;
    if (coords) {
      try {
        const tree = await this.deps.codeHostRouter.getRepositoryTree(cleanPath, coords);
        const entries = (tree.entries ?? []).map((entry) => ({
          name: entry.name,
          type: (entry.type === "dir" ? "dir" : "file") as "dir" | "file"
        }));
        if (entries.length) {
          return entries;
        }
      } catch {
        /* fall through to org API */
      }
    }

    const preferredRepoId = resolved?.preferred ?? repoId;
    if (!preferredRepoId) {
      return undefined;
    }
    try {
      const tree = await this.deps.api.fetchRepoTreeViaCloud(
        this.deps.apiBaseUrl,
        preferredRepoId,
        cleanPath,
        target.branch
      );
      const entries = (tree.entries ?? []).map((entry) => ({
        name: entry.name,
        type: (entry.type === "dir" ? "dir" : "file") as "dir" | "file"
      }));
      return entries.length ? entries : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Read any file in the indexed repo from the code host / API only (Zero-Clone).
   * Indexed does not mean mirrored — never prefer a local clone or workspace disk.
   */
  public async readFile(target: RepoTarget, path: string): Promise<RepoFileEvidence | undefined> {
    const cleanPath = path.trim().replace(/^\/+/, "");
    if (!cleanPath) {
      return undefined;
    }
    const repoId = target.repoId?.trim();
    const identity = this.getIdentity(target);

    if (!repoId) {
      return undefined;
    }

    try {
      const remote = await this.deps.api
        .getBackendClient()
        .fetchRepoFile(this.deps.apiBaseUrl, repoId, cleanPath, target.branch);
      if (remote.content?.trim()) {
        return {
          path: remote.path || cleanPath,
          repoId,
          content: remote.content,
          origin: "remote",
          truncated: remote.truncated
        };
      }
    } catch {
      /* fall through to code-host router (same path Remote browse uses) */
    }

    // Same reader as Remote explorer — cloud proxy or direct token via CodeHostRouter.
    if (identity?.owner && identity?.repo) {
      const provider = parseCodeHostProvider(identity.provider);
      if (!provider) {
        return undefined;
      }
      try {
        const remote = await this.deps.codeHostRouter.getFileContent(cleanPath, {
          provider,
          owner: identity.owner,
          repo: identity.repo,
          branch: target.branch
        });
        const content = remote.content ?? remote.lines?.map((line) => line.text).join("\n");
        if (content?.trim()) {
          return {
            path: remote.path || cleanPath,
            repoId,
            content,
            origin: "remote",
            truncated: remote.truncated
          };
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}

/**
 * True when an open workspace folder is actually this Use-repo (clone or VFS).
 * Used only to drop *foreign* editor chips — never as permission to read disk
 * for file bodies (Zero-Clone: {@link mayReadLocalRepoDiskForIntelligence}).
 */
export async function localDiskMatchesTargetRepo(
  identity: { owner?: string; repo?: string; provider?: string } | undefined
): Promise<boolean> {
  if (!identity?.owner?.trim() || !identity?.repo?.trim()) {
    return false;
  }
  try {
    const { isRepoOpenInEditorWorkspace } = await import("./repoEditorOpener");
    const provider = parseCodeHostProvider(identity.provider);
    if (!provider) {
      return false;
    }
    return isRepoOpenInEditorWorkspace(identity.owner, identity.repo, provider);
  } catch {
    return false;
  }
}

function withInventoryNote(
  inventory: RepoInventoryEvidence,
  needs: RepoFactNeeds
): RepoInventoryEvidence {
  if (!needs.lineCount || typeof inventory.lineCount === "number") {
    return inventory;
  }
  return {
    ...inventory,
    note:
      "No line count is recorded for this repository yet. " +
      "Say the line count is unavailable. Do not estimate it from file counts or attached snippets."
  };
}

function unavailableNote(needs: RepoFactNeeds): string {
  const subject = needs.lineCount && needs.fileCount
    ? "file and line counts are"
    : needs.lineCount
      ? "the line count is"
      : "the file count is";
  return (
    `Coop has no indexed inventory for this repository yet, so ${subject} unavailable. ` +
    "Say so clearly. Do not estimate totals from related-file hits or attached files."
  );
}

export type RepoStructureEntryFile = {
  path: string;
  content: string;
  truncated?: boolean;
  repoId?: string;
};

/** Attach workspace evidence to the chat context bundle. */
export function mergeRepoInventoryContext(
  result: ContextFetchResult,
  inventory: RepoInventoryEvidence | undefined,
  treeOverview?: RepoTreeEvidence,
  options?: {
    entryFiles?: RepoStructureEntryFile[];
    packageBoundaryNote?: string;
    packageStructure?: {
      packages: string[];
      parents: string[];
      workspaceGlobs?: string[];
    };
  }
): ContextFetchResult {
  const entryFiles = options?.entryFiles?.filter((file) => file.path?.trim() && file.content?.trim());
  const note = options?.packageBoundaryNote?.trim();
  const packageStructure =
    options?.packageStructure &&
    (options.packageStructure.packages.length > 0 ||
      options.packageStructure.parents.length > 0 ||
      (options.packageStructure.workspaceGlobs?.length ?? 0) > 0)
      ? options.packageStructure
      : undefined;
  if (!inventory && !treeOverview && !entryFiles?.length && !note && !packageStructure) {
    return result;
  }
  const baseData =
    typeof result.data === "object" && result.data !== null
      ? (result.data as Record<string, unknown>)
      : {};
  return {
    ...result,
    data: {
      ...baseData,
      ...(inventory ? { repoInventory: inventory } : {}),
      ...(treeOverview ? { treeOverview } : {}),
      ...(entryFiles?.length ? { entryFiles } : {}),
      ...(note ? { packageBoundaryNote: note } : {}),
      ...(packageStructure ? { packageStructure } : {})
    }
  };
}
