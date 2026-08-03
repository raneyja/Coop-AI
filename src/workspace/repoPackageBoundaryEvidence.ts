import type { IndexedRepoWorkspace } from "./IndexedRepoWorkspace";
import type { RepoFileEvidence, RepoTarget, RepoTreeEvidence } from "./indexedRepoWorkspaceTypes";
import { filterCodeEvidenceToActiveRepo } from "./repoEvidenceIsolation";

/**
 * Package-boundary / monorepo-layout evidence for structure questions.
 * Tree + in-repo manifests only — never local Extension Host files from another repo.
 */

export const MAX_PACKAGE_MANIFEST_FILES = 8;
export const MAX_PACKAGE_MANIFEST_CHARS = 8_000;

const ROOT_MANIFEST_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  "turbo.json",
  "nx.json",
  "lerna.json",
  "rush.json"
]);

/** Top-level dirs that typically hold workspace packages. */
const PACKAGE_PARENT_DIRS = new Set([
  "apps",
  "packages",
  "services",
  "web",
  "api",
  "frontend",
  "backend",
  "server",
  "client"
]);

export type PackageBoundaryEvidence = {
  treeOverview?: RepoTreeEvidence;
  entryFiles: Array<{ path: string; content: string; truncated?: boolean; repoId: string }>;
  note?: string;
};

export function isPackageParentDir(name: string): boolean {
  return PACKAGE_PARENT_DIRS.has(name.replace(/\/$/, "").toLowerCase());
}

/** Root workspace manifests present in the top-level tree listing. */
export function selectRootManifestPaths(tree: RepoTreeEvidence): string[] {
  return tree.topLevelFiles.filter((file) => ROOT_MANIFEST_NAMES.has(file));
}

/**
 * From a one-level listing under apps/packages/…, pick child package.json paths.
 * Also keeps a package.json sitting directly in the parent dir.
 */
export function selectChildPackageManifestPaths(
  parentDir: string,
  entries: Array<{ name: string; type: "dir" | "file" }>
): string[] {
  const parent = parentDir.replace(/\/$/, "");
  const paths: string[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\/$/, "");
    if (entry.type === "file" && name === "package.json") {
      paths.push(`${parent}/package.json`);
      continue;
    }
    if (entry.type === "dir") {
      paths.push(`${parent}/${name}/package.json`);
    }
  }
  return paths;
}

/**
 * Prefer in-repo paths only — drop anything that looks like another repo's layout
 * (e.g. Coop-AI `src/chat/*` when Use-repo is plane).
 */
export function filterManifestPathsToActiveRepoEvidence(
  paths: string[],
  activeRepoId: string | undefined,
  files: Array<{ path: string; content: string; truncated?: boolean; repoId?: string }>
): Array<{ path: string; content: string; truncated?: boolean; repoId: string }> {
  const allowed = new Set(paths.map((p) => p.replace(/^\/+/, "")));
  const scoped = filterCodeEvidenceToActiveRepo(
    files.map((file) => ({
      ...file,
      repoId: file.repoId ?? activeRepoId
    })),
    { repoId: activeRepoId },
    { allowMissingRepoId: false }
  );
  return scoped
    .filter((file) => allowed.has(file.path.replace(/^\/+/, "")))
    .filter((file) => Boolean(file.repoId))
    .map((file) => ({
      path: file.path,
      content: file.content,
      truncated: file.truncated,
      repoId: file.repoId as string
    }));
}

/** Paths that must never be treated as Use-repo package-boundary evidence. */
export function isForeignStructureEvidencePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  // Coop-AI extension surfaces that leaked into plane structure answers.
  if (normalized.startsWith("src/chat/") || normalized.startsWith("src/webview/")) {
    return true;
  }
  return false;
}

function truncateManifest(content: string): { content: string; truncated?: boolean } {
  if (content.length <= MAX_PACKAGE_MANIFEST_CHARS) {
    return { content };
  }
  return {
    content: `${content.slice(0, MAX_PACKAGE_MANIFEST_CHARS)}\n… [truncated]`,
    truncated: true
  };
}

/**
 * Candidate manifest paths from tree + one-level package parent listings.
 * Exported for tests — gatherPackageBoundaryEvidence owns the live reads.
 */
export function collectPackageManifestCandidatePaths(
  tree: RepoTreeEvidence,
  childListings: Map<string, Array<{ name: string; type: "dir" | "file" }>>
): string[] {
  const candidatePaths = selectRootManifestPaths(tree);
  const parentDirs = tree.topLevelDirs.filter(isPackageParentDir).slice(0, 4);

  for (const dir of parentDirs) {
    if (candidatePaths.length >= MAX_PACKAGE_MANIFEST_FILES) {
      break;
    }
    const entries = childListings.get(dir);
    if (!entries?.length) {
      for (const guess of [`${dir}/web/package.json`, `${dir}/api/package.json`, `${dir}/package.json`]) {
        if (!candidatePaths.includes(guess) && candidatePaths.length < MAX_PACKAGE_MANIFEST_FILES) {
          candidatePaths.push(guess);
        }
      }
      continue;
    }
    for (const childPath of selectChildPackageManifestPaths(dir, entries)) {
      if (candidatePaths.length >= MAX_PACKAGE_MANIFEST_FILES) {
        break;
      }
      if (!candidatePaths.includes(childPath)) {
        candidatePaths.push(childPath);
      }
    }
  }

  return candidatePaths
    .filter((path) => !isForeignStructureEvidencePath(path))
    .slice(0, MAX_PACKAGE_MANIFEST_FILES);
}

/**
 * Load top-level tree + package manifests for the active Use-repo via IndexedRepoWorkspace.
 */
export async function gatherPackageBoundaryEvidence(
  workspace: IndexedRepoWorkspace,
  target: RepoTarget
): Promise<PackageBoundaryEvidence> {
  const treeOverview = await workspace.getTreeOverview(target);
  if (!treeOverview) {
    return {
      entryFiles: [],
      note:
        "Repository tree overview is unavailable for the active Use-repo. " +
        "Say package layout / boundaries are unavailable — do not invent apps/, packages/, or paths from another repository."
    };
  }

  const parentDirs = treeOverview.topLevelDirs.filter(isPackageParentDir).slice(0, 4);
  const childListings = new Map<string, Array<{ name: string; type: "dir" | "file" }>>();
  await Promise.all(
    parentDirs.map(async (dir) => {
      const entries = await workspace.listDirectory(target, dir);
      if (entries?.length) {
        childListings.set(dir, entries);
      }
    })
  );

  const paths = collectPackageManifestCandidatePaths(treeOverview, childListings);
  const loaded: RepoFileEvidence[] = [];
  await Promise.all(
    paths.map(async (path) => {
      const file = await workspace.readFile(target, path);
      if (file?.content?.trim() && !isForeignStructureEvidencePath(file.path)) {
        const sliced = truncateManifest(file.content);
        loaded.push({
          ...file,
          content: sliced.content,
          truncated: sliced.truncated || file.truncated
        });
      }
    })
  );

  const activeRepoId = workspace.getIdentity(target)?.repoId ?? target.repoId;
  const entryFiles = filterManifestPathsToActiveRepoEvidence(
    paths,
    activeRepoId,
    loaded.map((file) => ({
      path: file.path,
      content: file.content,
      truncated: file.truncated,
      repoId: file.repoId
    }))
  ).filter((file) => !isForeignStructureEvidencePath(file.path));

  if (entryFiles.length === 0 && paths.length > 0) {
    return {
      treeOverview,
      entryFiles: [],
      note:
        "Package manifests under the active Use-repo could not be loaded. " +
        "Use only the tree overview paths when present; do not invent package boundaries or cite another repository."
    };
  }

  return { treeOverview, entryFiles };
}
