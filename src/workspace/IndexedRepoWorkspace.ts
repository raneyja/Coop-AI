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
  public async getInventory(target: RepoTarget, needs: RepoFactNeeds): Promise<RepoInventoryEvidence> {
    const repoId = target.repoId?.trim();
    if (!repoId) {
      return {
        source: "unavailable",
        note: "No repository is selected, so Coop cannot measure this repository."
      };
    }

    const resolved = resolveInventoryRepoIds(repoId, target);

    const fromStats = await fetchIndexStatsInventory(this.deps, resolved.candidates, target.branch);
    if (fromStats) {
      return withInventoryNote(fromStats, needs);
    }

    const fromManifest = await fetchManifestInventory(this.deps, resolved.candidates);
    if (fromManifest) {
      return withInventoryNote(fromManifest, needs);
    }

    const fromTree = await fetchTreeInventory(this.deps, resolved.coords);
    if (fromTree) {
      return withInventoryNote(fromTree, needs);
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
   * Read any file in the indexed repo: local clone when the user has one,
   * otherwise fetched from the code host. Indexed does not mean mirrored.
   */
  public async readFile(target: RepoTarget, path: string): Promise<RepoFileEvidence | undefined> {
    const cleanPath = path.trim().replace(/^\/+/, "");
    if (!cleanPath) {
      return undefined;
    }
    const repoId = target.repoId?.trim();

    try {
      const { readWorkspaceFileFromDisk } = await import("../context/localFileResolver");
      const local = readWorkspaceFileFromDisk(cleanPath);
      const localContent = local?.files[0]?.content;
      if (localContent?.trim()) {
        return {
          path: cleanPath,
          repoId: repoId ?? "",
          content: localContent,
          origin: "local"
        };
      }
    } catch {
      /* fall through to remote */
    }

    if (!repoId) {
      return undefined;
    }

    try {
      const remote = await this.deps.api
        .getBackendClient()
        .fetchRepoFile(this.deps.apiBaseUrl, repoId, cleanPath, target.branch);
      if (!remote.content?.trim()) {
        return undefined;
      }
      return {
        path: remote.path || cleanPath,
        repoId,
        content: remote.content,
        origin: "remote",
        truncated: remote.truncated
      };
    } catch {
      return undefined;
    }
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

/** Attach workspace evidence to the chat context bundle. */
export function mergeRepoInventoryContext(
  result: ContextFetchResult,
  inventory: RepoInventoryEvidence | undefined,
  treeOverview?: RepoTreeEvidence
): ContextFetchResult {
  if (!inventory && !treeOverview) {
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
      ...(treeOverview ? { treeOverview } : {})
    }
  };
}
