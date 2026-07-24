import type { SecureApiClient } from "../chat/SecureApiClient";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider, RepoCoordinates } from "../api/codeHosts/types";
import { coordinatesFromRepoId, repoIdFromCoordinates } from "../api/codeHosts/types";
import { normalizeGraphRepoId } from "../engines/blastRadiusDependentsFallback";
import type { RepoInventoryEvidence, RepoTarget, RepoTreeEvidence } from "./indexedRepoWorkspaceTypes";

/**
 * Adapters that resolve repository facts from a single backing source.
 * Internal to {@link IndexedRepoWorkspace} — call the facade, not these.
 */

export type RepoInventoryDeps = {
  api: SecureApiClient;
  apiBaseUrl: string;
  codeHostRouter: CodeHostRouter;
};

/**
 * Intent events often carry bare `owner/repo`, while stats rows / workspace rows
 * are stored as `github:owner/repo`. Prefer the provider-prefixed form.
 */
export function resolveInventoryRepoIds(
  repoId: string,
  target: Pick<RepoTarget, "provider" | "owner" | "repo" | "branch">
): { preferred: string; candidates: string[]; coords?: RepoCoordinates } {
  const provider: CodeHostProvider =
    target.provider === "gitlab" || target.provider === "bitbucket" || target.provider === "github"
      ? target.provider
      : "github";
  const preferred = normalizeGraphRepoId(repoId, provider);
  const candidates = [preferred];
  if (repoId.trim() !== preferred) {
    candidates.push(repoId.trim());
  }

  const coords =
    coordinatesFromRepoId(preferred, target.branch) ??
    (target.owner && target.repo
      ? {
          provider,
          owner: target.owner,
          repo: target.repo,
          branch: target.branch
        }
      : undefined);

  if (coords) {
    const fromCoords = repoIdFromCoordinates(coords);
    if (fromCoords && !candidates.includes(fromCoords)) {
      candidates.unshift(fromCoords);
    }
  }

  return { preferred, candidates: [...new Set(candidates)], coords };
}

/** Reject never-crawled empty manifests so we don't report "0 files". */
export function isUsableManifestInventory(manifest: {
  fileCount?: number;
  files?: unknown[];
  lastCrawledAt?: string;
}): { fileCount: number; lastCrawledAt?: string } | undefined {
  const fileCount = manifest.fileCount ?? manifest.files?.length;
  if (typeof fileCount !== "number" || fileCount < 0) {
    return undefined;
  }
  if (!manifest.lastCrawledAt && fileCount === 0) {
    return undefined;
  }
  return { fileCount, lastCrawledAt: manifest.lastCrawledAt };
}

/** Durable stats recorded by INDEX_REPOSITORY — the only source with line counts. */
export async function fetchIndexStatsInventory(
  deps: RepoInventoryDeps,
  candidateRepoIds: string[],
  branch?: string
): Promise<RepoInventoryEvidence | undefined> {
  for (const candidate of candidateRepoIds) {
    try {
      const stats = await deps.api.fetchRepoInventoryViaCloud(deps.apiBaseUrl, candidate, branch);
      if (!stats || typeof stats.fileCount !== "number") {
        continue;
      }
      return {
        source: "index-stats",
        fileCount: stats.fileCount,
        lineCount: typeof stats.lineCount === "number" ? stats.lineCount : undefined,
        byteCount: typeof stats.byteCount === "number" ? stats.byteCount : undefined,
        languages: stats.languages,
        indexedAt: stats.indexedAt
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Legacy structure manifest rows. Files only — no line counts. */
export async function fetchManifestInventory(
  deps: RepoInventoryDeps,
  candidateRepoIds: string[]
): Promise<RepoInventoryEvidence | undefined> {
  for (const candidate of candidateRepoIds) {
    try {
      const manifest = await deps.api.fetchRepoManifest(deps.apiBaseUrl, candidate);
      const usable = isUsableManifestInventory(manifest);
      if (!usable) {
        continue;
      }
      return {
        source: "manifest",
        fileCount: usable.fileCount,
        lastCrawledAt: usable.lastCrawledAt
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Live recursive code-host tree count. Files only — no line counts. */
export async function fetchTreeInventory(
  deps: RepoInventoryDeps,
  coords: RepoCoordinates | undefined
): Promise<RepoInventoryEvidence | undefined> {
  if (!coords) {
    return undefined;
  }
  try {
    const counted = await deps.codeHostRouter.countRepositoryFiles(coords);
    if (typeof counted.fileCount !== "number") {
      return undefined;
    }
    return {
      source: "tree",
      fileCount: counted.fileCount,
      truncated: counted.truncated
    };
  } catch {
    return undefined;
  }
}

export async function fetchTreeOverview(
  deps: RepoInventoryDeps,
  coords: RepoCoordinates | undefined
): Promise<RepoTreeEvidence | undefined> {
  if (!coords) {
    return undefined;
  }
  try {
    const tree = await deps.codeHostRouter.getRepositoryTree("", coords);
    const topLevelDirs: string[] = [];
    const topLevelFiles: string[] = [];
    for (const entry of tree.entries ?? []) {
      if (entry.type === "dir") {
        topLevelDirs.push(entry.name);
      } else {
        topLevelFiles.push(entry.name);
      }
    }
    topLevelDirs.sort();
    topLevelFiles.sort();
    return { topLevelDirs, topLevelFiles, branch: tree.branch };
  } catch {
    return undefined;
  }
}
