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
   * Read any file in the indexed repo: matching local clone when present,
   * otherwise fetched from the code host. Indexed does not mean mirrored.
   *
   * Never prefer an unrelated workspace file (e.g. Coop-AI's package.json while
   * the active remote repo is documenso) — that silently fed the wrong evidence.
   */
  public async readFile(target: RepoTarget, path: string): Promise<RepoFileEvidence | undefined> {
    const cleanPath = path.trim().replace(/^\/+/, "");
    if (!cleanPath) {
      return undefined;
    }
    const repoId = target.repoId?.trim();
    const identity = this.getIdentity(target);

    if (await localDiskMatchesTargetRepo(identity)) {
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
    }

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

/** True when an open workspace folder is actually this repo (local clone or VFS). */
async function localDiskMatchesTargetRepo(
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
