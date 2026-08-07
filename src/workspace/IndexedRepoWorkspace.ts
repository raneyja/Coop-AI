import type { ContextFetchResult } from "../context/requestBatcher";
import type {
  RepoFileEvidence,
  RepoIdentity,
  RepoInventoryEvidence,
  RepoTarget,
  RepoTreeEvidence
} from "./indexedRepoWorkspaceTypes";
import type { RepoFactNeeds } from "./repoFactIntent";
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
  public constructor(private readonly deps: RepoInventoryDeps) {}

  public getIdentity(target: RepoTarget): RepoIdentity | undefined {
    const repoId = target.repoId?.trim();
    if (!repoId) {
      return undefined;
    }
    const resolved = resolveInventoryRepoIds(repoId, target);
    return {
      repoId: resolved.preferred,
      provider: resolved.coords?.provider ?? "github",
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
      try {
        const provider =
          identity.provider === "gitlab" || identity.provider === "bitbucket"
            ? identity.provider
            : "github";
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
    const provider =
      identity.provider === "gitlab" || identity.provider === "bitbucket" ? identity.provider : "github";
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
      "No line count is recorded for this repository — Deep-Index has not stored line stats for it yet. " +
      "Say the line count is unavailable and offer to re-index. Do not estimate it from file counts or attached snippets."
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
    "Say so clearly and suggest Deep-Indexing the repo. Do not estimate totals from search samples or attached files."
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
