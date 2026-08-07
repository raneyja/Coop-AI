import fs from "node:fs";
import path from "node:path";

export type ImportEdgeKind = "import" | "require" | "export-from";

export type ImportEdge = {
  from: string;
  to: string;
  kind: ImportEdgeKind;
  line?: number;
  symbol?: string;
};

const DEFAULT_MAX_EDGES = 50_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  "vendor",
]);

const TS_JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_SUFFIXES = [
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
  "/index.cjs",
];

const IMPORT_FROM_RE =
  /\bimport\s+(?:type\s+)?(?:(?:[\w*\s{},$]+\s+from\s+)|(?:[\w*\s{},$]+\s*,\s*)?[\w*\s{},$]+\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+(?:type\s+)?(?:(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+)['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const PYTHON_FROM_RE = /^\s*from\s+(\.+[\w.]*|\w[\w.]*)\s+import\b/gm;
const PYTHON_IMPORT_RE = /^\s*import\s+(\w[\w.]*)\b/gm;

function normalizeRepoPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

function isTsJsFile(filePath: string): boolean {
  const ext = path.posix.extname(normalizeRepoPath(filePath)).toLowerCase();
  return TS_JS_EXTENSIONS.has(ext);
}

function isPythonFile(filePath: string): boolean {
  return normalizeRepoPath(filePath).toLowerCase().endsWith(".py");
}

function isParseableSourceFile(filePath: string): boolean {
  return isTsJsFile(filePath) || isPythonFile(filePath);
}

function resolveTsJsSpec(fromFile: string, spec: string, fileSet: Set<string>): string | undefined {
  if (!spec.startsWith(".")) {
    return undefined;
  }

  const fromDir = path.posix.dirname(normalizeRepoPath(fromFile));
  const candidate = normalizeRepoPath(path.posix.normalize(path.posix.join(fromDir, spec)));

  for (const ext of RESOLVE_EXTENSIONS) {
    const resolved = candidate + ext;
    if (fileSet.has(resolved)) {
      return resolved;
    }
  }

  for (const suffix of INDEX_SUFFIXES) {
    const resolved = candidate + suffix;
    if (fileSet.has(resolved)) {
      return resolved;
    }
  }

  return undefined;
}

function resolvePythonModule(fromFile: string, moduleSpec: string, fileSet: Set<string>): string | undefined {
  const fromDir = path.posix.dirname(normalizeRepoPath(fromFile));

  if (moduleSpec.startsWith(".")) {
    const dotMatch = /^(\.+)(.*)$/.exec(moduleSpec);
    if (!dotMatch) {
      return undefined;
    }
    const dotCount = dotMatch[1].length;
    const remainder = dotMatch[2].replace(/^\./, "");
    const segments = fromDir.split("/").filter(Boolean);
    const upLevels = dotCount - 1;
    if (upLevels > segments.length) {
      return undefined;
    }
    const baseSegments = segments.slice(0, segments.length - upLevels);
    if (remainder.length > 0) {
      baseSegments.push(...remainder.split(".").filter(Boolean));
    }
    const modulePath = baseSegments.join("/");
    const candidates = [`${modulePath}.py`, `${modulePath}/__init__.py`];
    for (const candidate of candidates) {
      if (fileSet.has(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  const modulePath = moduleSpec.split(".").join("/");
  const candidates = [`${modulePath}.py`, `${modulePath}/__init__.py`];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function extractSymbolFromImportStatement(source: string, matchIndex: number): string | undefined {
  const lineStart = source.lastIndexOf("\n", matchIndex - 1) + 1;
  const lineEnd = source.indexOf("\n", matchIndex);
  const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const named = /\{([^}]+)\}/.exec(line);
  if (named) {
    const first = named[1]
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);
    if (first) {
      const aliasSplit = first.split(/\s+as\s+/);
      return aliasSplit[0]?.trim();
    }
  }
  const defaultImport = /\bimport\s+(?!type\b)([\w$]+)/.exec(line);
  return defaultImport?.[1];
}

function pushTsJsEdge(
  edges: ImportEdge[],
  fromFile: string,
  spec: string,
  kind: ImportEdgeKind,
  fileSet: Set<string>,
  source: string,
  matchIndex: number
): void {
  const to = resolveTsJsSpec(fromFile, spec, fileSet);
  if (!to) {
    return;
  }
  edges.push({
    from: normalizeRepoPath(fromFile),
    to,
    kind,
    line: lineNumberAt(source, matchIndex),
    symbol: extractSymbolFromImportStatement(source, matchIndex),
  });
}

function extractTsJsEdges(filePath: string, source: string, fileSet: Set<string>): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const normalizedFrom = normalizeRepoPath(filePath);

  for (const [re, kind] of [
    [IMPORT_FROM_RE, "import"],
    [EXPORT_FROM_RE, "export-from"],
    [REQUIRE_RE, "require"],
    [DYNAMIC_IMPORT_RE, "import"],
  ] as const) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      pushTsJsEdge(edges, normalizedFrom, match[1], kind, fileSet, source, match.index);
    }
  }

  return edges;
}

function extractPythonEdges(filePath: string, source: string, fileSet: Set<string>): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const normalizedFrom = normalizeRepoPath(filePath);

  PYTHON_FROM_RE.lastIndex = 0;
  let fromMatch: RegExpExecArray | null;
  while ((fromMatch = PYTHON_FROM_RE.exec(source)) !== null) {
    const moduleSpec = fromMatch[1];
    const to = resolvePythonModule(normalizedFrom, moduleSpec, fileSet);
    if (!to) {
      continue;
    }
    const importClause = /^\s*from\s+[\w.]+\s+import\s+(.+)$/m.exec(
      source.slice(fromMatch.index, source.indexOf("\n", fromMatch.index) + 1 || undefined)
    );
    const symbol = importClause?.[1]
      ?.split(",")[0]
      ?.trim()
      .split(/\s+as\s+/)[0]
      ?.trim();
    edges.push({
      from: normalizedFrom,
      to,
      kind: "import",
      line: lineNumberAt(source, fromMatch.index),
      symbol,
    });
  }

  PYTHON_IMPORT_RE.lastIndex = 0;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = PYTHON_IMPORT_RE.exec(source)) !== null) {
    const moduleSpec = importMatch[1];
    const to = resolvePythonModule(normalizedFrom, moduleSpec, fileSet);
    if (!to) {
      continue;
    }
    edges.push({
      from: normalizedFrom,
      to,
      kind: "import",
      line: lineNumberAt(source, importMatch.index),
      symbol: moduleSpec.split(".")[0],
    });
  }

  return edges;
}

export function extractImportEdgesFromSource(
  filePath: string,
  source: string,
  ctx: { fileSet: Set<string> }
): ImportEdge[] {
  const normalizedPath = normalizeRepoPath(filePath);
  if (isTsJsFile(normalizedPath)) {
    return extractTsJsEdges(normalizedPath, source, ctx.fileSet);
  }
  if (isPythonFile(normalizedPath)) {
    return extractPythonEdges(normalizedPath, source, ctx.fileSet);
  }
  return [];
}

function walkCloneOnce(root: string): { fileSet: Set<string>; files: string[] } {
  const fileSet = new Set<string>();
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizeRepoPath(path.relative(root, fullPath));
      fileSet.add(relativePath);
      if (isParseableSourceFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  return { fileSet, files };
}

export function extractImportEdges(
  localPath: string,
  options?: { maxEdges?: number; maxFileBytes?: number }
): ImportEdge[] {
  const maxEdges = options?.maxEdges ?? DEFAULT_MAX_EDGES;
  const maxFileBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const root = path.resolve(localPath);
  const { fileSet, files } = walkCloneOnce(root);
  const edges: ImportEdge[] = [];

  for (const relativePath of files) {
    if (edges.length >= maxEdges) {
      break;
    }

    const absolutePath = path.join(root, relativePath);
    let source: string;
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.size > maxFileBytes) {
        continue;
      }
      source = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }

    const fileEdges = extractImportEdgesFromSource(relativePath, source, { fileSet });
    for (const edge of fileEdges) {
      edges.push(edge);
      if (edges.length >= maxEdges) {
        break;
      }
    }
  }

  return edges;
}
