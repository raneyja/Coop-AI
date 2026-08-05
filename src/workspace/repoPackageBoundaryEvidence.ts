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

/**
 * Concrete top-level apps/packages from the live tree listing.
 * Prefer these names over workspace globs like `apps/*` / `packages/*`.
 */
export type TopLevelPackageStructureEvidence = {
  /** e.g. apps/remix, packages/signing, packages/prisma — tree dirs only, never invented. */
  packages: string[];
  /** Parent dirs that were listed (apps, packages, …). */
  parents: string[];
  /** Raw workspace globs from root package.json when present (informational). */
  workspaceGlobs?: string[];
};

export type PackageBoundaryEvidence = {
  treeOverview?: RepoTreeEvidence;
  entryFiles: Array<{ path: string; content: string; truncated?: boolean; repoId: string }>;
  /** Concrete package/app paths from tree child listings under apps/packages/…. */
  packageStructure?: TopLevelPackageStructureEvidence;
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
 * Concrete package/app paths from one-level listings under apps/packages/….
 * Tree dirs only — never invents names from workspace globs or training data.
 * Exported for tests.
 */
export function buildTopLevelPackageStructure(
  tree: RepoTreeEvidence,
  childListings: Map<string, Array<{ name: string; type: "dir" | "file" }>>,
  options?: { workspaceGlobs?: string[] }
): TopLevelPackageStructureEvidence {
  const parents = tree.topLevelDirs
    .map((dir) => dir.replace(/\/$/, ""))
    .filter(isPackageParentDir);
  const packages: string[] = [];
  for (const parent of parents) {
    const entries = childListings.get(parent);
    if (!entries?.length) {
      continue;
    }
    for (const entry of entries) {
      if (entry.type !== "dir") {
        continue;
      }
      const name = entry.name.replace(/\/$/, "");
      if (!name || name.startsWith(".")) {
        continue;
      }
      const path = `${parent}/${name}`;
      if (!isForeignStructureEvidencePath(path) && !packages.includes(path)) {
        packages.push(path);
      }
    }
  }
  packages.sort();
  const globs = options?.workspaceGlobs?.filter((g) => typeof g === "string" && g.trim());
  return {
    packages,
    parents,
    ...(globs?.length ? { workspaceGlobs: globs } : {})
  };
}

/** Parse npm/pnpm/yarn workspaces globs from root package.json content. */
export function extractWorkspaceGlobs(packageJsonContent: string): string[] | undefined {
  try {
    const parsed = JSON.parse(packageJsonContent) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const raw = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
      : parsed.workspaces && Array.isArray(parsed.workspaces.packages)
        ? parsed.workspaces.packages
        : undefined;
    if (!raw?.length) {
      return undefined;
    }
    const globs = raw.filter((g): g is string => typeof g === "string" && Boolean(g.trim()));
    return globs.length ? globs : undefined;
  } catch {
    return undefined;
  }
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
  const parentDirs = tree.topLevelDirs
    .map((dir) => dir.replace(/\/$/, ""))
    .filter(isPackageParentDir)
    .slice(0, 4);

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
 * Also builds concrete apps/ and packages/ child names from directory listings
 * (not workspace globs alone).
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

  const parentDirs = treeOverview.topLevelDirs
    .map((dir) => dir.replace(/\/$/, ""))
    .filter(isPackageParentDir)
    .slice(0, 4);
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

  const rootManifest = entryFiles.find((file) => file.path.replace(/^\/+/, "") === "package.json");
  const workspaceGlobs = rootManifest ? extractWorkspaceGlobs(rootManifest.content) : undefined;
  const packageStructure = mergePackagesFromLoadedManifests(
    buildTopLevelPackageStructure(treeOverview, childListings, {
      workspaceGlobs
    }),
    entryFiles
  );

  if (entryFiles.length === 0 && paths.length > 0) {
    return {
      treeOverview,
      entryFiles: [],
      packageStructure,
      note:
        "Package manifests under the active Use-repo could not be loaded. " +
        "Use the tree-listed package paths when present; do not invent package boundaries or cite another repository."
    };
  }

  return { treeOverview, entryFiles, packageStructure };
}

/**
 * When directory listings are empty but child package.json files loaded, fold
 * `apps/web/package.json` → `apps/web` into packageStructure.packages.
 */
export function mergePackagesFromLoadedManifests(
  structure: TopLevelPackageStructureEvidence,
  entryFiles: Array<{ path: string }>
): TopLevelPackageStructureEvidence {
  const packages = [...structure.packages];
  for (const file of entryFiles) {
    const path = file.path.replace(/^\/+/, "");
    const match = path.match(/^(apps|packages|services|libs|modules)\/([^/]+)\/package\.json$/i);
    // Also accept apps/<name>/package.json already covered; skip root package.json.
    if (!match) {
      continue;
    }
    const pkg = `${match[1]}/${match[2]}`;
    if (!isForeignStructureEvidencePath(pkg) && !packages.includes(pkg)) {
      packages.push(pkg);
    }
  }
  packages.sort();
  return { ...structure, packages };
}

/** True when the answer only restates workspace globs with no concrete package names. */
export function answerLacksConcretePackageNames(
  content: string,
  packages: string[]
): boolean {
  if (!packages.length) {
    return false;
  }
  const lower = content.toLowerCase();
  const citesConcrete = packages.some((pkg) => {
    const bare = pkg.includes("/") ? pkg.split("/")[1] : pkg;
    return (
      lower.includes(pkg.toLowerCase()) ||
      (bare.length > 2 && new RegExp(`\\b${escapeRegExp(bare)}\\b`, "i").test(content))
    );
  });
  if (citesConcrete) {
    return false;
  }
  // Glob-only / vague monorepo advice without naming children.
  return (
    /apps\/\*|packages\/\*/i.test(content) ||
    /\blook for (?:folders|directories|next\.config)/i.test(content) ||
    (/\bworkspaces?\b/i.test(content) && /\bapps\/?\b/i.test(content) && !/\bapps\/[a-z0-9_-]+\b/i.test(content))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Inject concrete package paths when the model only restated apps/* / packages/*. */
export function enrichPackageStructureResponse(
  content: string,
  packages: string[],
  options?: { workspaceGlobs?: string[] }
): string {
  if (!packages.length || !answerLacksConcretePackageNames(content, packages)) {
    return content;
  }
  const listed = packages.slice(0, 24).map((pkg) => `- \`${pkg}\``).join("\n");
  const globs = options?.workspaceGlobs?.length
    ? `\nWorkspace globs (informational only): ${options.workspaceGlobs.join(", ")}.`
    : "";
  const lead = [
    "**Concrete packages (from repository tree / manifests)**",
    "",
    listed,
    globs,
    "",
    "Prefer these names over `apps/*` / `packages/*` workspace globs alone.",
    ""
  ].join("\n");
  const trimmed = content.trim();
  return trimmed ? `${lead}${trimmed}` : lead.trim();
}
