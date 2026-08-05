import type { IndexBackend } from "../indexing/indexBackend";
import type { LocalSearchResult } from "../indexing/types";

export type GraphEdgeSource = "scip" | "zoekt" | "heuristic" | "remote";

export function asGraphEdgeSource(source: string | undefined): GraphEdgeSource {
  if (source === "scip" || source === "zoekt" || source === "heuristic" || source === "remote") {
    return source;
  }
  return "remote";
}

export type BlastRadiusDependentDetail = {
  path: string;
  depth: number;
  source: GraphEdgeSource;
};

/** Normalize owner/repo or github:owner/repo to github:owner/repo for graph API calls. */
export function normalizeGraphRepoId(repoId: string, provider = "github"): string {
  const trimmed = repoId.trim();
  if (/^(github|gitlab|bitbucket):/.test(trimmed)) {
    return trimmed;
  }
  return `${provider}:${trimmed}`;
}

/** Build Zoekt/import search patterns that find files referencing the target. */
export function buildImportSearchPatterns(file: string, symbols: string[] = []): string[] {
  const basename = file.split("/").pop() ?? file;
  const stem = basename.replace(/\.[^.]+$/, "");
  const patterns = new Set<string>();

  for (const quote of ["'", '"']) {
    patterns.add(`require(${quote}${basename}${quote})`);
    patterns.add(`require(${quote}./${basename}${quote})`);
    patterns.add(`from ${quote}${basename}${quote}`);
    patterns.add(`from ${quote}./${basename}${quote}`);
    patterns.add(`from ${quote}@/${stem}${quote}`);
    patterns.add(`from ${quote}@/${basename}${quote}`);
    if (stem !== basename) {
      patterns.add(`require(${quote}${stem}${quote})`);
      patterns.add(`require(${quote}./${stem}${quote})`);
      patterns.add(`from ${quote}${stem}${quote}`);
      patterns.add(`from ${quote}./${stem}${quote}`);
    }
    if (file.includes("/")) {
      patterns.add(`from ${quote}${file}${quote}`);
      patterns.add(`require(${quote}${file}${quote})`);
    }
  }

  // Python-style imports of the module stem.
  if (/\.py$/i.test(file)) {
    patterns.add(`from ${stem} import`);
    patterns.add(`import ${stem}`);
  }

  for (const symbol of symbols) {
    const trimmed = symbol.trim();
    if (trimmed.length < 3) {
      continue;
    }
    patterns.add(trimmed);
    patterns.add(`${trimmed}.`);
    patterns.add(`${trimmed}(`);
    patterns.add(`import ${trimmed}`);
    patterns.add(`from ${quoteSafe(stem)} import ${trimmed}`);
  }

  return [...patterns];
}

function quoteSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.]/g, "_");
}

/** PascalCase / CamelCase symbols from the blast ask (e.g. StateGroup, DocumentStatus). */
export function extractBlastSearchSymbols(ask: string | undefined, file?: string): string[] {
  const symbols = new Set<string>();
  const stop = new Set([
    "What",
    "When",
    "Where",
    "Which",
    "This",
    "That",
    "With",
    "From",
    "Change",
    "Rename",
    "Values",
    "Break",
    "Breaks",
    "Draft",
    "Pending",
    "Completed",
    "Rejected"
  ]);
  const text = ask?.trim() ?? "";
  for (const match of text.matchAll(/\b([A-Z][a-zA-Z0-9]{2,})\b/g)) {
    const token = match[1];
    if (!stop.has(token)) {
      symbols.add(token);
    }
  }
  // Prefer class-like names ending in Group/Status/Type/Enum.
  const ranked = [...symbols].sort((a, b) => {
    const score = (s: string) =>
      /(Group|Status|Type|Enum|Kind|Mode)$/.test(s) ? 0 : 1;
    return score(a) - score(b) || b.length - a.length;
  });
  if (file?.endsWith(".py") && ranked.length === 0) {
    // Fall back to TitleCase stem for Python models (state → State is weak; skip).
  }
  return ranked.slice(0, 6);
}

export type SearchDependentsFallbackOptions = {
  /** Cap patterns when soft gather budget is thin. */
  maxPatterns?: number;
  /** Extra symbols from the user ask (StateGroup, DocumentStatus, …). */
  symbols?: string[];
};

/** Search index for files that import/reference the target when SCIP dependents are empty. */
export async function searchDependentsFallback(
  indexBackend: IndexBackend,
  repoId: string,
  file: string,
  options: SearchDependentsFallbackOptions = {}
): Promise<{ dependents: BlastRadiusDependentDetail[]; source: GraphEdgeSource; warnings: string[] }> {
  const warnings: string[] = [];
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  const enabled = await indexBackend.isEnabledForRepo(normalizedRepoId);

  if (!enabled) {
    return { dependents: [], source: "remote", warnings };
  }

  const symbols = options.symbols ?? [];
  const patterns = buildImportSearchPatterns(file, symbols);
  // Prefer symbol patterns first — they find enum/class usages when imports miss.
  const ordered = [
    ...patterns.filter((pattern) => symbols.some((symbol) => pattern.includes(symbol))),
    ...patterns.filter((pattern) => !symbols.some((symbol) => pattern.includes(symbol)))
  ];
  const maxPatterns = Math.max(1, Math.min(options.maxPatterns ?? 10, ordered.length));
  const seen = new Set<string>([file]);
  const dependents: BlastRadiusDependentDetail[] = [];
  let bestSource: GraphEdgeSource = "heuristic";

  for (const pattern of ordered.slice(0, maxPatterns)) {
    try {
      const result = await indexBackend.search(normalizedRepoId, pattern);
      const source = mapSearchSourceToGraphSource(result.source);
      if (source === "zoekt" || source === "scip") {
        bestSource = source;
      }
      for (const hit of result.hits) {
        const depPath = normalizeHitPath(hit.fileName);
        if (!depPath || seen.has(depPath)) {
          continue;
        }
        seen.add(depPath);
        dependents.push({ path: depPath, depth: 1, source });
      }
    } catch (error) {
      warnings.push(`Import-pattern search failed for "${pattern}": ${errorMessage(error)}`);
    }
  }

  const ranked = sortDependentsProductionFirst(dependents);
  return {
    dependents: ranked.slice(0, 30),
    source: ranked.length > 0 ? bestSource : "remote",
    warnings
  };
}

export function buildTestSearchPatterns(file: string): string[] {
  const basename = file.split("/").pop() ?? file;
  const stem = basename.replace(/\.[^.]+$/, "");
  return uniqueStrings([basename, stem, file]);
}

export function mapSearchSourceToGraphSource(source: LocalSearchResult["source"]): GraphEdgeSource {
  if (source === "scip") {
    return "scip";
  }
  if (source === "zoekt") {
    return "zoekt";
  }
  return "heuristic";
}

function normalizeHitPath(fileName: string): string | undefined {
  const trimmed = fileName.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === ".") {
    return undefined;
  }
  return trimmed.replace(/^\/+/, "");
}

/** Find test/spec files that reference the target via index search. */
export async function searchTestFilesReferencingTarget(
  indexBackend: IndexBackend,
  repoId: string,
  file: string
): Promise<Array<{ path: string; source: GraphEdgeSource }>> {
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  if (!(await indexBackend.isEnabledForRepo(normalizedRepoId))) {
    return [];
  }

  const patterns = buildTestSearchPatterns(file);
  const seen = new Set<string>();
  const results: Array<{ path: string; source: GraphEdgeSource }> = [];

  for (const pattern of patterns) {
    try {
      const search = await indexBackend.search(normalizedRepoId, pattern);
      for (const hit of search.hits) {
        const path = normalizeHitPath(hit.fileName);
        if (!path || seen.has(path) || !looksLikeTestFile(path)) {
          continue;
        }
        seen.add(path);
        results.push({ path, source: mapSearchSourceToGraphSource(search.source) });
      }
    } catch {
      // try next pattern
    }
  }

  return results.slice(0, 15);
}

/** Heuristic public API / export surface from SCIP symbols on the target file. */
export async function searchPublicExports(
  indexBackend: IndexBackend,
  repoId: string,
  file: string
): Promise<Array<{ symbol: string; kind: string; line: number }>> {
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  if (!(await indexBackend.isEnabledForRepo(normalizedRepoId))) {
    return [];
  }

  const basename = (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
  try {
    const search = await indexBackend.search(normalizedRepoId, basename);
    return search.symbols
      .filter((symbol) => symbol.file === file || symbol.file.endsWith(`/${file}`))
      .filter((symbol) => isExportKind(symbol.kind))
      .slice(0, 20)
      .map((symbol) => ({
        symbol: symbol.displayName || symbol.symbol,
        kind: symbol.kind,
        line: symbol.line
      }));
  } catch {
    return [];
  }
}

/** Search for CI/workflow files referencing impacted paths. */
export async function searchCiWorkflowReferences(
  indexBackend: IndexBackend,
  repoId: string,
  paths: string[]
): Promise<Array<{ path: string; matchedPath: string }>> {
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  if (!(await indexBackend.isEnabledForRepo(normalizedRepoId)) || paths.length === 0) {
    return [];
  }

  const results: Array<{ path: string; matchedPath: string }> = [];
  const seen = new Set<string>();

  for (const targetPath of paths.slice(0, 5)) {
    const stem = (targetPath.split("/").pop() ?? targetPath).replace(/\.[^.]+$/, "");
    try {
      const search = await indexBackend.search(normalizedRepoId, stem);
      for (const hit of search.hits) {
        const path = normalizeHitPath(hit.fileName);
        if (!path || seen.has(path) || !looksLikeCiWorkflow(path)) {
          continue;
        }
        seen.add(path);
        results.push({ path, matchedPath: targetPath });
      }
    } catch {
      // try next path
    }
  }

  return results.slice(0, 10);
}

/** Cross-repo package-name search for library entry files (heuristic, limited). */
export async function searchCrossRepoConsumers(
  indexBackend: IndexBackend,
  repoId: string,
  file: string
): Promise<Array<{ repoId: string; path: string; source: GraphEdgeSource }>> {
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  if (!(await indexBackend.isEnabledForRepo(normalizedRepoId))) {
    return [];
  }

  const basename = file.split("/").pop() ?? file;
  if (!isLikelyLibraryEntry(file)) {
    return [];
  }

  const packageStem = basename.replace(/\.[^.]+$/, "");
  try {
    const search = await indexBackend.search(normalizedRepoId, packageStem, { scope: "org" });
    return search.hits
      .map((hit) => ({
        repoId: normalizedRepoId,
        path: normalizeHitPath(hit.fileName) ?? "",
        source: mapSearchSourceToGraphSource(search.source)
      }))
      .filter((entry) => entry.path && entry.path !== file)
      .slice(0, 8);
  } catch {
    return [];
  }
}

/** Markdown, docs trees, README, and .d.ts type surfaces — references, not runtime importers. */
export function isDocsReferencePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (/\.(md|mdx|rst)$/i.test(lower)) {
    return true;
  }
  if (/(^|\/)readme\.md$/i.test(lower)) {
    return true;
  }
  if (/^docs(?:\/|$)/i.test(lower) || /\/docs\//i.test(lower)) {
    return true;
  }
  if (/\.d\.ts$/i.test(lower)) {
    return true;
  }
  return false;
}

export function splitBlastRadiusDependents(details: BlastRadiusDependentDetail[]): {
  codeDependentDetails: BlastRadiusDependentDetail[];
  docsReferences: BlastRadiusDependentDetail[];
} {
  const codeDependentDetails: BlastRadiusDependentDetail[] = [];
  const docsReferences: BlastRadiusDependentDetail[] = [];
  for (const entry of details) {
    if (isDocsReferencePath(entry.path)) {
      docsReferences.push(entry);
    } else {
      codeDependentDetails.push(entry);
    }
  }
  return { codeDependentDetails, docsReferences };
}

export function codePathsFromDependentDetails(details: BlastRadiusDependentDetail[]): {
  directDependents: string[];
  transitiveDependents: string[];
} {
  const directDependents: string[] = [];
  const transitiveDependents: string[] = [];
  for (const entry of details) {
    if (entry.depth > 1) {
      transitiveDependents.push(entry.path);
    } else {
      directDependents.push(entry.path);
    }
  }
  return { directDependents: uniqueStrings(directDependents), transitiveDependents: uniqueStrings(transitiveDependents) };
}

export function groupDependentsByTopLevelFolder(
  details: BlastRadiusDependentDetail[]
): Array<{ label: string; entries: BlastRadiusDependentDetail[] }> {
  const groups = new Map<string, BlastRadiusDependentDetail[]>();
  for (const entry of details) {
    const slash = entry.path.indexOf("/");
    const label = slash > 0 ? `${entry.path.slice(0, slash + 1)}` : "(repo root)";
    const bucket = groups.get(label) ?? [];
    bucket.push(entry);
    groups.set(label, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, entries]) => ({
      label,
      entries: entries.sort((left, right) => left.path.localeCompare(right.path))
    }));
}

export type BlastRadiusRiskRankedDependent = BlastRadiusDependentDetail & {
  riskScore: number;
  riskReason: string;
};

export type DependentSurfaceKind = "production" | "integration" | "example" | "build" | "test" | "other";

/** Classify a dependent path for ranking / labeling (stories & e2e count as tests). */
export function classifyDependentSurface(path: string): DependentSurfaceKind {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (isStoryOrDemoPath(lower) || isE2ePath(lower) || looksLikeTestFile(path)) {
    return "test";
  }
  if (lower.startsWith("integration/") || /\/integration\//.test(lower)) {
    return "integration";
  }
  if (lower.startsWith("examples/") || /\/examples\//.test(lower)) {
    return "example";
  }
  if (/\/bundler\//.test(lower) || /webpack|esbuild|rollup|vite\.config/.test(lower)) {
    return "build";
  }
  if (isProductionCallerPath(lower)) {
    return "production";
  }
  return "other";
}

/**
 * Rank code dependents for summary narrative — production / app callers first.
 * Stories, e2e, and unit tests rank below and are labeled as test surfaces.
 */
export function rankCodeDependentsByRisk(
  details: BlastRadiusDependentDetail[],
  limit = 5
): BlastRadiusRiskRankedDependent[] {
  return sortDependentsProductionFirst(details)
    .filter((entry) => !isDocsReferencePath(entry.path))
    .map((entry) => {
      const scored = scoreDependentRisk(entry.path, entry.depth);
      return { ...entry, riskScore: scored.score, riskReason: scored.reason };
    })
    .slice(0, limit);
}

/** Stable production-first order for dependent lists shown in cards / prompts. */
export function sortDependentsProductionFirst(
  details: BlastRadiusDependentDetail[]
): BlastRadiusDependentDetail[] {
  return [...details].sort((left, right) => {
    const leftScore = scoreDependentRisk(left.path, left.depth).score;
    const rightScore = scoreDependentRisk(right.path, right.depth).score;
    return rightScore - leftScore || left.path.localeCompare(right.path);
  });
}

export function scoreDependentRisk(path: string, depth: number): { score: number; reason: string } {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  let score = 55;
  let reason = "Code importer";

  if (isStoryOrDemoPath(lower)) {
    score = 22;
    reason = "Test surface (Storybook / demo)";
  } else if (isE2ePath(lower)) {
    score = 20;
    reason = "Test surface (e2e)";
  } else if (looksLikeTestFile(path)) {
    score = 28;
    reason = "Test surface (unit / regression)";
  } else if (isProductionCallerPath(lower)) {
    score = 95;
    reason = "Production / application caller";
  } else if (lower.startsWith("integration/") || /\/integration\//.test(lower)) {
    score = 88;
    reason = "Integration / runtime surface";
  } else if (lower.startsWith("examples/") || /\/examples\//.test(lower)) {
    score = 72;
    reason = "Public example / API usage";
  } else if (/\/bundler\//.test(lower) || /webpack|esbuild|rollup|vite\.config/.test(lower)) {
    score = 48;
    reason = "Build / bundler tooling";
  }

  if (depth > 1) {
    score -= 8;
    reason = `Transitive — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }

  return { score, reason };
}

function isProductionCallerPath(lower: string): boolean {
  return (
    /^(src|lib|app|apps|packages|server|services|core|web|backend|frontend)\//.test(lower) ||
    /\/(src|lib|app|packages|server|services|core)\//.test(lower)
  );
}

function isStoryOrDemoPath(lower: string): boolean {
  return (
    /\.stories\.[cm]?[jt]sx?$/.test(lower) ||
    /\.story\.[cm]?[jt]sx?$/.test(lower) ||
    /(^|\/)stories\//.test(lower) ||
    /(^|\/)storybook\//.test(lower) ||
    /\.storybook\//.test(lower)
  );
}

function isE2ePath(lower: string): boolean {
  return (
    /(^|\/)e2e\//.test(lower) ||
    /(^|\/)(cypress|playwright)\//.test(lower) ||
    /\.e2e\.[cm]?[jt]sx?$/.test(lower) ||
    /\/__e2e__\//.test(lower)
  );
}

export function filterJobDependentsForFile(
  sample: Array<{ from?: string; to?: string }> | undefined,
  targetFile: string
): string[] {
  if (!Array.isArray(sample) || !targetFile) {
    return [];
  }
  const normalizedTarget = targetFile.replace(/\\/g, "/").replace(/^\/+/, "");
  return uniqueStrings(
    sample
      .filter((edge) => {
        const to = edge.to?.replace(/\\/g, "/").replace(/^\/+/, "");
        return to === normalizedTarget;
      })
      .map((edge) => edge.from)
      .filter(Boolean) as string[]
  );
}

export function looksLikeTestFile(path: string): boolean {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (isStoryOrDemoPath(lower) || isE2ePath(lower)) {
    return true;
  }
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) ||
    /\/__(tests|mocks)__\//i.test(path) ||
    /\/tests?\//i.test(lower)
  );
}

function looksLikeCiWorkflow(path: string): boolean {
  return (
    path.includes(".github/workflows/") ||
    path.includes(".gitlab-ci") ||
    path.endsWith("Jenkinsfile") ||
    path.includes("azure-pipelines")
  );
}

function isLikelyLibraryEntry(file: string): boolean {
  return (
    file.endsWith("index.js") ||
    file.endsWith("index.ts") ||
    file.endsWith("package.json") ||
    /^lib\//.test(file) ||
    /^src\/index/.test(file)
  );
}

function isExportKind(kind: string): boolean {
  return /function|method|class|interface|type|constant|variable|export/i.test(kind);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
