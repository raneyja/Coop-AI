import type {
  CrossRepoReference,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  FileImportRef,
  FileImportsResult,
  RepoCoordinates
} from "./types";
import { repoIdFromCoordinates } from "./types";

const IMPORT_PATTERNS = [
  /^\s*import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/gm,
  /^\s*import\s*\(\s*["']([^"']+)["']\s*\)/gm,
  /^\s*export\s+.*\s+from\s+["']([^"']+)["']/gm,
  /require\s*\(\s*["']([^"']+)["']\s*\)/gm
];

export function parseFileImports(path: string, content: string): FileImportsResult {
  const imports: FileImportRef[] = [];
  const seen = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1];
      if (!specifier || seen.has(specifier)) {
        continue;
      }
      seen.add(specifier);
      imports.push({
        specifier,
        kind: classifySpecifier(specifier),
        resolvedPath: resolveRelativeImport(path, specifier),
        external: !specifier.startsWith(".") && !specifier.startsWith("/")
      });
    }
  }
  return {
    path,
    imports,
    circularHints: detectCircularHints(path, imports)
  };
}

export function buildDependencyGraph(
  coords: RepoCoordinates,
  rootPaths: string[],
  fetchImports: (path: string) => Promise<FileImportRef[]>,
  maxNodes = 80
): Promise<DependencyGraph> {
  const repoId = repoIdFromCoordinates(coords);
  const nodes = new Map<string, DependencyGraphNode>();
  const edges: DependencyGraphEdge[] = [];
  const queue = [...rootPaths];
  const visited = new Set<string>();

  const ensureNode = (id: string, nodePath: string, kind: DependencyGraphNode["kind"]) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, path: nodePath, kind });
    }
  };

  ensureNode(repoId, "", "service");

  const walk = async (): Promise<DependencyGraph> => {
    while (queue.length > 0 && nodes.size < maxNodes) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const nodeId = `${repoId}:${current}`;
      ensureNode(nodeId, current, "file");
      edges.push({ from: repoId, to: nodeId, kind: "import" });
      const imports = await fetchImports(current).catch(() => []);
      for (const entry of imports) {
        if (entry.resolvedPath && !visited.has(entry.resolvedPath)) {
          queue.push(entry.resolvedPath);
          const targetId = `${repoId}:${entry.resolvedPath}`;
          ensureNode(targetId, entry.resolvedPath, "file");
          edges.push({ from: nodeId, to: targetId, kind: "import" });
        } else if (entry.external) {
          const pkgId = `pkg:${entry.specifier}`;
          ensureNode(pkgId, entry.specifier, "package");
          edges.push({ from: nodeId, to: pkgId, kind: "manifest" });
        }
      }
    }
    return { nodes: [...nodes.values()], edges };
  };

  return walk();
}

export function findCrossRepoReferences(
  coords: RepoCoordinates,
  path: string,
  searchHits: Array<{ repoId: string; path: string; snippet?: string }>
): CrossRepoReference[] {
  const sourceRepoId = repoIdFromCoordinates(coords);
  const moduleStem = path.replace(/\.[^.]+$/, "").split("/").pop() ?? path;
  const seen = new Set<string>();
  const references: CrossRepoReference[] = [];
  for (const hit of searchHits) {
    if (hit.repoId === sourceRepoId) {
      continue;
    }
    const key = `${hit.repoId}:${hit.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      repoId: hit.repoId,
      path: hit.path,
      specifier: hit.snippet ?? moduleStem
    });
  }
  return references;
}

function classifySpecifier(specifier: string): FileImportRef["kind"] {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return "relative";
  }
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return "alias";
  }
  return "package";
}

function resolveRelativeImport(filePath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  const segments = `${dir}/${specifier}`.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  let resolved = stack.join("/");
  if (!resolved.includes(".") && !resolved.endsWith("/")) {
    resolved = `${resolved}.ts`;
  }
  return resolved;
}

function detectCircularHints(path: string, imports: FileImportRef[]): string[] {
  return imports
    .filter((entry) => entry.resolvedPath === path)
    .map((entry) => entry.specifier);
}
