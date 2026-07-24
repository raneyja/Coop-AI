import type { SecureApiClient } from "../chat/SecureApiClient";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider, RepoCoordinates } from "../api/codeHosts/types";
import { coordinatesFromRepoId, repoIdFromCoordinates } from "../api/codeHosts/types";
import { normalizeGraphRepoId } from "../engines/blastRadiusDependentsFallback";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";

/**
 * Detects questions that need a real repository inventory (file count / structure),
 * not a semantic-search sample. Keep narrow — "which files use auth?" and
 * "how many files import X?" must still run semantic retrieval.
 */
export function isRepoInventoryQuery(queryText: string | undefined): boolean {
  const q = queryText?.trim().toLowerCase() ?? "";
  if (!q) {
    return false;
  }

  if (/\bfile count\b/.test(q) || /\btotal (number of )?files\b/.test(q) || /\bnumber of files\b/.test(q)) {
    return true;
  }

  if (/\bcount (all |the )?files\b/.test(q) && !/\bcount (all |the )?files that\b/.test(q)) {
    return true;
  }

  if (/\bhow many files\b/.test(q)) {
    // Implementation questions: "how many files import/call/use X"
    if (
      /\bhow many files\b\s+(import|export|call|use|reference|contain|include|mention|match|define|implement)\b/.test(
        q
      )
    ) {
      return false;
    }
    if (
      /\b(in|inside|within)\b/.test(q) ||
      /\b(this|the)\s+(repo|repository|project|codebase)\b/.test(q) ||
      /\bhow many files\s*(are there)?\s*\??\s*$/.test(q) ||
      /\bdoes (this|the)\s+(repo|repository|project|codebase)\s+have\b/.test(q)
    ) {
      return true;
    }
    return false;
  }

  if (/\b(list|show|dump) (all |every )?files\b/.test(q) && /\b(repo|repository|project|codebase)\b/.test(q)) {
    return true;
  }

  if (/\bhow (big|large) is (this |the )?(repo|repository|project|codebase)\b/.test(q)) {
    return true;
  }

  return false;
}

/** Broader structure questions that need a live top-level tree, not semantic snippets. */
export function isRepoStructureQuery(queryText: string | undefined): boolean {
  if (isRepoInventoryQuery(queryText)) {
    return true;
  }
  const q = queryText?.trim().toLowerCase() ?? "";
  if (!q) {
    return false;
  }
  if (/\b(is this|is it) (a )?monorepo\b/.test(q)) {
    return true;
  }
  if (/\b(repo|repository|project|codebase)\s+structure\b/.test(q) || /\bstructure of (this |the )?(repo|repository|project|codebase)\b/.test(q)) {
    return true;
  }
  if (/\b(top[- ]level|root) (dirs|directories|folders|files)\b/.test(q)) {
    return true;
  }
  if (/\b(list|show) (the )?(top[- ]level |root )?(dirs|directories|folders)\b/.test(q)) {
    return true;
  }
  return false;
}

export type RepoInventoryStats = {
  source: "manifest" | "tree" | "unavailable";
  fileCount?: number;
  truncated?: boolean;
  lastCrawledAt?: string;
  note?: string;
};

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

export type RepoTreeOverviewStats = {
  topLevelDirs: string[];
  topLevelFiles: string[];
  branch?: string;
};

export type FetchRepoInventoryOptions = {
  request: ContextFetchRequest;
  api: SecureApiClient;
  apiBaseUrl: string;
  codeHostRouter: CodeHostRouter;
  branch?: string;
  owner?: string;
  repo?: string;
  /** Code-host provider for normalizing bare owner/repo intent ids. */
  provider?: CodeHostProvider | string;
};

/**
 * Intent events often carry bare `owner/repo`, while manifests / workspace rows
 * are stored as `github:owner/repo`. Prefer the provider-prefixed form.
 */
export function resolveInventoryRepoIds(
  repoId: string,
  options: Pick<FetchRepoInventoryOptions, "provider" | "owner" | "repo" | "branch">
): { preferred: string; candidates: string[]; coords?: RepoCoordinates } {
  const provider =
    options.provider === "gitlab" || options.provider === "bitbucket" || options.provider === "github"
      ? options.provider
      : "github";
  const preferred = normalizeGraphRepoId(repoId, provider);
  const candidates = [preferred];
  if (repoId.trim() !== preferred) {
    candidates.push(repoId.trim());
  }

  const coords =
    coordinatesFromRepoId(preferred, options.branch) ??
    (options.owner && options.repo
      ? {
          provider,
          owner: options.owner,
          repo: options.repo,
          branch: options.branch
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

export async function fetchRepoInventoryStats(
  options: FetchRepoInventoryOptions
): Promise<RepoInventoryStats | undefined> {
  const query = options.request.intent.context?.queryText;
  if (!isRepoInventoryQuery(query)) {
    return undefined;
  }

  const repoId = options.request.params.repoId?.trim();
  if (!repoId) {
    return {
      source: "unavailable",
      note: "No repository is selected, so Coop cannot count files."
    };
  }

  const resolved = resolveInventoryRepoIds(repoId, options);
  // Race manifest vs live tree — cold manifests often miss while recursive count is cached later.
  return await firstResolvedInventory([
    tryManifestCount(options, resolved.candidates),
    tryTreeCount(options, resolved.coords)
  ]);
}

/** True when we need a live top-level listing (monorepo / structure), not only a file total. */
export function needsRepoTreeOverview(queryText: string | undefined): boolean {
  return isRepoStructureQuery(queryText) && !isRepoInventoryQuery(queryText);
}

async function firstResolvedInventory(
  attempts: Array<Promise<RepoInventoryStats | undefined>>
): Promise<RepoInventoryStats | undefined> {
  return new Promise((resolve) => {
    let pending = attempts.length;
    let settled = false;
    if (pending === 0) {
      resolve(undefined);
      return;
    }
    for (const attempt of attempts) {
      void attempt.then(
        (stats) => {
          if (stats && !settled) {
            settled = true;
            resolve(stats);
            return;
          }
          pending -= 1;
          if (pending === 0 && !settled) {
            resolve(undefined);
          }
        },
        () => {
          pending -= 1;
          if (pending === 0 && !settled) {
            resolve(undefined);
          }
        }
      );
    }
  });
}

export async function fetchRepoTreeOverview(
  options: FetchRepoInventoryOptions
): Promise<RepoTreeOverviewStats | undefined> {
  const query = options.request.intent.context?.queryText;
  if (!isRepoStructureQuery(query)) {
    return undefined;
  }

  const repoId = options.request.params.repoId?.trim();
  const resolved = repoId
    ? resolveInventoryRepoIds(repoId, options)
    : options.owner && options.repo
      ? resolveInventoryRepoIds(`${options.owner}/${options.repo}`, options)
      : undefined;
  if (!resolved?.coords) {
    return undefined;
  }

  try {
    const tree = await options.codeHostRouter.getRepositoryTree("", resolved.coords);
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
    return {
      topLevelDirs,
      topLevelFiles,
      branch: tree.branch
    };
  } catch {
    return undefined;
  }
}

async function tryManifestCount(
  options: FetchRepoInventoryOptions,
  candidateRepoIds: string[]
): Promise<RepoInventoryStats | undefined> {
  const hits = await Promise.all(
    candidateRepoIds.map(async (candidate) => {
      try {
        const manifest = await options.api.fetchRepoManifest(options.apiBaseUrl, candidate);
        const usable = isUsableManifestInventory(manifest);
        if (!usable) {
          return undefined;
        }
        return {
          source: "manifest" as const,
          fileCount: usable.fileCount,
          lastCrawledAt: usable.lastCrawledAt
        };
      } catch {
        return undefined;
      }
    })
  );
  return hits.find((hit) => hit !== undefined);
}

async function tryTreeCount(
  options: FetchRepoInventoryOptions,
  coords: RepoCoordinates | undefined
): Promise<RepoInventoryStats | undefined> {
  if (!coords) {
    return undefined;
  }

  try {
    const counted = await options.codeHostRouter.countRepositoryFiles(coords);
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

export function mergeRepoInventoryContext(
  result: ContextFetchResult,
  inventory: RepoInventoryStats | undefined,
  treeOverview?: RepoTreeOverviewStats
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
