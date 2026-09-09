/**
 * Understand Repo: attach first-read source files by listing the remote tree.
 * Search/manifest samples miss apps/api internals; compose at repo root is not architecture.
 */

import { isOnboardingNoisePath, selectOnboardingEvidencePaths } from "./onboardingSearchQueries";
import { isReadmeAnchorPath } from "./userFocusQuery";

export const MAX_UNDERSTAND_WALK_LISTINGS = 16;
export const MAX_UNDERSTAND_WALK_DEPTH = 4;
export const MAX_UNDERSTAND_DOMAIN_FILES = 6;

const PARENT_DIRS = ["apps", "packages", "services", "src"];
const PREFERRED_CHILDREN = new Set([
  "api",
  "web",
  "live",
  "admin",
  "space",
  "server",
  "backend",
  "frontend",
  "app",
  "core"
]);
const CODE_CHILD_DIR =
  /^(plane|src|app|db|api|server|middleware|models|views|handlers|routers?|auth|core|lib)$/i;
const SKIP_CHILD_DIR = /^(tests?|migrations?|node_modules|dist|build|bin|fixtures?|seeds?|locales?|\.)/i;
const DOMAIN_RANK_QUERY = "authentication issue models views router middleware";

export type UnderstandTreeEntry = { name: string; type: "dir" | "file" };
export type UnderstandDirListing = { dir: string; entries: UnderstandTreeEntry[] };

export function pickUnderstandParentDirs(topLevelDirs: string[]): string[] {
  const present = new Set(topLevelDirs.map((dir) => dir.replace(/\/$/, "").toLowerCase()));
  return PARENT_DIRS.filter((dir) => present.has(dir));
}

export function isUnderstandArchitectureNoisePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  const base = normalized.split("/").pop() ?? normalized;
  if (
    /^docker-compose/.test(base) ||
    /^dockerfile/.test(base) ||
    /^docker-entrypoint/.test(base) ||
    base === "agents.md" ||
    base === "pnpm-lock.yaml" ||
    base === "package-lock.json" ||
    base === "yarn.lock"
  ) {
    return true;
  }
  return isOnboardingNoisePath(path);
}

export function isUnderstandDomainSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (isUnderstandArchitectureNoisePath(normalized)) {
    return false;
  }
  if (!/\.(py|ts|tsx|js|jsx|go|rb|java|rs)$/i.test(normalized)) {
    return false;
  }
  return /^(apps|packages|services|src)\//i.test(normalized);
}

export function nextUnderstandWalkDirs(
  dir: string,
  entries: UnderstandTreeEntry[],
  depth: number
): string[] {
  const parent = dir.replace(/\/$/, "");
  const dirs = entries
    .filter((entry) => entry.type === "dir")
    .map((entry) => entry.name.replace(/\/$/, ""))
    .filter((name) => name && !SKIP_CHILD_DIR.test(name));
  if (depth === 0) {
    const preferred = dirs.filter((name) => PREFERRED_CHILDREN.has(name.toLowerCase()));
    const rest = dirs.filter((name) => !PREFERRED_CHILDREN.has(name.toLowerCase()));
    return [...preferred, ...rest].slice(0, 4).map((name) => `${parent}/${name}`);
  }
  return dirs
    .filter((name) => CODE_CHILD_DIR.test(name))
    .slice(0, 4)
    .map((name) => `${parent}/${name}`);
}

export function selectUnderstandDomainPathsFromListings(listings: UnderstandDirListing[]): string[] {
  const files: string[] = [];
  for (const listing of listings) {
    const prefix = listing.dir.replace(/\/$/, "");
    for (const entry of listing.entries) {
      if (entry.type !== "file") {
        continue;
      }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isUnderstandDomainSourcePath(path) || /(^|\/)(manage|urls|wsgi|asgi|settings)\.py$/i.test(path)) {
        files.push(path);
      }
    }
  }
  if (files.length === 0) {
    return [];
  }
  return selectOnboardingEvidencePaths(files, DOMAIN_RANK_QUERY, MAX_UNDERSTAND_DOMAIN_FILES);
}

export function filterComposeArchitectureFiles<T extends { path: string }>(
  files: T[],
  treeHasApps: boolean
): T[] {
  if (!treeHasApps && !files.some((file) => isUnderstandDomainSourcePath(file.path))) {
    return files;
  }
  const kept = files.filter(
    (file) =>
      !isUnderstandArchitectureNoisePath(file.path) &&
      (isUnderstandDomainSourcePath(file.path) || isReadmeAnchorPath(file.path))
  );
  return kept.length > 0 ? kept : files.filter((file) => !isUnderstandArchitectureNoisePath(file.path));
}

export function treeHasAppsLayout(topLevelDirs: string[] | undefined): boolean {
  return (topLevelDirs ?? []).some((dir) => {
    const name = dir.replace(/\/$/, "").toLowerCase();
    return name === "apps" || name === "packages" || name === "services";
  });
}

export function isolateUnderstandRepoSummary<T extends {
  entryFiles?: Array<{ path: string; content?: string; truncated?: boolean }>;
  treeOverview?: unknown;
  confluence?: unknown;
  jira?: unknown;
  slack?: unknown;
  teams?: unknown;
  notion?: unknown;
  googleDocs?: unknown;
}>(summary: T): T {
  const tree = summary.treeOverview as { topLevelDirs?: string[] } | undefined;
  const next = { ...summary };
  delete next.confluence;
  delete next.jira;
  delete next.slack;
  delete next.teams;
  delete next.notion;
  delete next.googleDocs;
  next.entryFiles = filterComposeArchitectureFiles(
    summary.entryFiles ?? [],
    treeHasAppsLayout(tree?.topLevelDirs)
  );
  return next;
}

/**
 * BFS remote directory walk — Zero-Clone (code host / org tree API only).
 */
export async function collectUnderstandDomainPaths(options: {
  topLevelDirs: string[];
  listDirectory: (path: string) => Promise<UnderstandTreeEntry[] | undefined>;
  deadlineAt?: number;
}): Promise<string[]> {
  const parents = pickUnderstandParentDirs(options.topLevelDirs);
  if (parents.length === 0) {
    return [];
  }

  const listings: UnderstandDirListing[] = [];
  const queue: Array<{ path: string; depth: number }> = parents.map((path) => ({ path, depth: 0 }));
  const seen = new Set<string>();
  let listed = 0;

  while (queue.length > 0 && listed < MAX_UNDERSTAND_WALK_LISTINGS) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt) {
      break;
    }
    const batch = queue.splice(0, 6);
    const resolved = await Promise.all(
      batch.map(async (item) => {
        const key = item.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
        if (seen.has(key)) {
          return undefined;
        }
        seen.add(key);
        const entries = await options.listDirectory(item.path);
        if (!entries?.length) {
          return undefined;
        }
        return { ...item, entries };
      })
    );

    for (const item of resolved) {
      if (!item) {
        continue;
      }
      listed += 1;
      listings.push({ dir: item.path, entries: item.entries });
      if (item.depth >= MAX_UNDERSTAND_WALK_DEPTH || listed >= MAX_UNDERSTAND_WALK_LISTINGS) {
        continue;
      }
      for (const next of nextUnderstandWalkDirs(item.path, item.entries, item.depth)) {
        const key = next.replace(/\\/g, "/").toLowerCase();
        if (!seen.has(key)) {
          queue.push({ path: next, depth: item.depth + 1 });
        }
      }
    }
  }

  return selectUnderstandDomainPathsFromListings(listings);
}
