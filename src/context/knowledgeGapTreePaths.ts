import type { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import { isKnowledgeGapToolingPath, rankKnowledgeGapChildDirs } from "../jobs/knowledgeGapPathRank";

export const MAX_GAPS_TREE_LISTINGS = 18;
export const MAX_GAPS_TREE_PATHS = 400;

const ROOT_WALK_DIRS = ["src", "admin", "docs", "website", "apps", "packages", "services"];
const SKIP_DIR = /^(node_modules|dist|build|coverage|\.git|\.next|out|vendor|fixtures?|__pycache__)$/i;
const KEEP_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|md)$/i;

/**
 * Bounded remote tree listing for Knowledge Gaps when the structure manifest
 * is empty. Zero-clone: IndexedRepoWorkspace.listDirectory only.
 */
export async function collectKnowledgeGapTreePaths(options: {
  workspace: IndexedRepoWorkspace;
  target: RepoTarget;
  deadlineAt?: number;
  maxListings?: number;
}): Promise<string[]> {
  const maxListings = options.maxListings ?? MAX_GAPS_TREE_LISTINGS;
  const paths: string[] = [];
  const seen = new Set<string>();
  let listings = 0;

  const list = async (dir: string): Promise<Array<{ name: string; type: "dir" | "file" }>> => {
    if (listings >= maxListings) {
      return [];
    }
    if (options.deadlineAt && Date.now() >= options.deadlineAt) {
      return [];
    }
    listings += 1;
    const entries = await options.workspace.listDirectory(options.target, dir);
    return entries ?? [];
  };

  const addFile = (dir: string, name: string): void => {
    if (!KEEP_FILE.test(name)) {
      return;
    }
    const path = dir ? `${dir.replace(/\/$/, "")}/${name}` : name;
    if (isKnowledgeGapToolingPath(path) || seen.has(path)) {
      return;
    }
    seen.add(path);
    if (paths.length < MAX_GAPS_TREE_PATHS) {
      paths.push(path);
    }
  };

  const root = await list("");
  const rootDirs: string[] = [];
  for (const entry of root) {
    if (entry.type === "file") {
      addFile("", entry.name);
    } else if (!SKIP_DIR.test(entry.name)) {
      rootDirs.push(entry.name.replace(/\/$/, ""));
    }
  }

  const parents = ROOT_WALK_DIRS.filter((dir) =>
    rootDirs.some((name) => name.toLowerCase() === dir.toLowerCase())
  );
  const childDirs: string[] = [];
  for (const parent of parents) {
    const entries = await list(parent);
    for (const entry of entries) {
      if (entry.type === "file") {
        addFile(parent, entry.name);
      } else if (!SKIP_DIR.test(entry.name) && childDirs.length < 16) {
        childDirs.push(`${parent}/${entry.name.replace(/\/$/, "")}`);
      }
    }
  }

  for (const dir of rankKnowledgeGapChildDirs(childDirs).slice(0, 12)) {
    const entries = await list(dir);
    for (const entry of entries) {
      if (entry.type === "file") {
        addFile(dir, entry.name);
      }
    }
  }

  return paths;
}
