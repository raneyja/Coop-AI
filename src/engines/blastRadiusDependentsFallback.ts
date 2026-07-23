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
export function buildImportSearchPatterns(file: string): string[] {
  const basename = file.split("/").pop() ?? file;
  const stem = basename.replace(/\.[^.]+$/, "");
  const patterns = new Set<string>();

  for (const quote of ["'", '"']) {
    patterns.add(`require(${quote}${basename}${quote})`);
    patterns.add(`require(${quote}./${basename}${quote})`);
    patterns.add(`from ${quote}${basename}${quote}`);
    patterns.add(`from ${quote}./${basename}${quote}`);
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

  return [...patterns];
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

/** Search index for files that import/reference the target when SCIP dependents are empty. */
export async function searchDependentsFallback(
  indexBackend: IndexBackend,
  repoId: string,
  file: string
): Promise<{ dependents: BlastRadiusDependentDetail[]; source: GraphEdgeSource; warnings: string[] }> {
  const warnings: string[] = [];
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  const enabled = await indexBackend.isEnabledForRepo(normalizedRepoId);

  if (!enabled) {
    return { dependents: [], source: "remote", warnings };
  }

  const patterns = buildImportSearchPatterns(file);
  const seen = new Set<string>([file]);
  const dependents: BlastRadiusDependentDetail[] = [];
  let bestSource: GraphEdgeSource = "heuristic";

  // Parallel, capped — serial ×8 search was a multi-minute trap when SCIP was empty.
  const settled = await Promise.all(
    patterns.slice(0, 3).map(async (pattern) => {
      try {
        return await indexBackend.search(normalizedRepoId, pattern);
      } catch (error) {
        warnings.push(`Import-pattern search failed for "${pattern}": ${errorMessage(error)}`);
        return undefined;
      }
    })
  );

  for (const result of settled) {
    if (!result) {
      continue;
    }
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
  }

  return {
    dependents: dependents.slice(0, 30),
    source: dependents.length > 0 ? bestSource : "remote",
    warnings
  };
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

/** tsconfig / jsconfig build graph noise — never elevate as blast-radius risk. */
export function isBuildConfigPath(path: string): boolean {
  const base = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return /^(tsconfig|jsconfig)(\..+)?\.json$/.test(base);
}

export function splitBlastRadiusDependents(details: BlastRadiusDependentDetail[]): {
  codeDependentDetails: BlastRadiusDependentDetail[];
  docsReferences: BlastRadiusDependentDetail[];
} {
  const codeDependentDetails: BlastRadiusDependentDetail[] = [];
  const docsReferences: BlastRadiusDependentDetail[] = [];
  for (const entry of details) {
    if (isBuildConfigPath(entry.path)) {
      continue;
    }
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

/** Rank code dependents for summary narrative — integration/examples/tests first. */
export function rankCodeDependentsByRisk(
  details: BlastRadiusDependentDetail[],
  limit = 5
): BlastRadiusRiskRankedDependent[] {
  return details
    .filter((entry) => !isDocsReferencePath(entry.path))
    .map((entry) => {
      const scored = scoreDependentRisk(entry.path, entry.depth);
      return { ...entry, riskScore: scored.score, riskReason: scored.reason };
    })
    .sort((left, right) => right.riskScore - left.riskScore || left.path.localeCompare(right.path))
    .slice(0, limit);
}

function scoreDependentRisk(path: string, depth: number): { score: number; reason: string } {
  const lower = path.toLowerCase();
  let score = 40;
  let reason = "Code importer";

  if (lower.startsWith("integration/") || /\/integration\//.test(lower)) {
    score = 90;
    reason = "Integration / runtime surface";
  } else if (lower.startsWith("examples/") || /\/examples\//.test(lower)) {
    score = 85;
    reason = "Public example / API usage";
  } else if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) || /\/test\//.test(lower) || /\/__tests__\//.test(lower)) {
    score = 80;
    reason = "Test / regression surface";
  } else if (/^src\//.test(lower) || /^lib\//.test(lower) || /^packages\//.test(lower)) {
    score = 70;
    reason = "Application or library code";
  } else if (/\/bundler\//.test(lower) || /webpack|esbuild/.test(lower)) {
    score = 55;
    reason = "Build / bundler tooling";
  }

  if (depth > 1) {
    score -= 8;
    reason = `Transitive — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }

  return { score, reason };
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

function looksLikeTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) ||
    /\/__(tests|mocks)__\//i.test(path) ||
    /\/test\//i.test(path)
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
