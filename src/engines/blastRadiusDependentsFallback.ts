import type { Dirent } from "node:fs";
import type { IndexBackend } from "../indexing/indexBackend";
import type { LocalSearchResult } from "../indexing/types";

/** Lazy Node builtins — keeps the webview bundle free of top-level node: imports. */
function nodeFs(): typeof import("node:fs") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs") as typeof import("node:fs");
}

function nodePath(): typeof import("node:path") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:path") as typeof import("node:path");
}

export type GraphEdgeSource =
  | "scip"
  | "zoekt"
  | "heuristic"
  | "remote"
  | "workspace"
  | "import-parse";

export function asGraphEdgeSource(source: string | undefined): GraphEdgeSource {
  if (
    source === "scip" ||
    source === "zoekt" ||
    source === "heuristic" ||
    source === "remote" ||
    source === "workspace" ||
    source === "import-parse"
  ) {
    return source;
  }
  return "remote";
}

/** Durable / lexical sources that establish real callers (not embedding lookalikes). */
export function isTrustedBlastGraphSource(source: string | undefined): boolean {
  return (
    source === "import-parse" ||
    source === "scip" ||
    source === "zoekt" ||
    source === "workspace"
  );
}

/**
 * Remote Zero-Clone sources that should not be undercut with “partial index”
 * caveats when callers are present (excludes local workspace scans).
 */
export function isRemoteTrustedBlastGraphSource(source: string | undefined): boolean {
  return source === "import-parse" || source === "scip" || source === "zoekt";
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
  const stem = (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
  const withoutExt = file.replace(/\.[^.]+$/, "");
  const pathParts = withoutExt.split("/").filter(Boolean);
  const patterns: string[] = [];
  const seen = new Set<string>();

  const add = (pattern: string): void => {
    const trimmed = pattern.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    patterns.push(trimmed);
  };

  // 1) Bare path suffixes first — Zoekt substring match for
  // `from "../config/responseDeadline"` via `config/responseDeadline`.
  const suffixes = pathParts
    .map((_, index) => pathParts.slice(index).join("/"))
    .filter((suffix) => suffix.length >= 3);
  for (const suffix of suffixes) {
    add(suffix);
  }

  // 2) A few relative-import shapes for the last 2 suffixes only (avoid burning maxPatterns).
  for (const suffix of suffixes.slice(-2)) {
    for (const quote of ["'", '"']) {
      add(`from ${quote}../${suffix}${quote}`);
      add(`from ${quote}../../${suffix}${quote}`);
      add(`from ${quote}./${suffix}${quote}`);
      add(`from ${quote}${suffix}${quote}`);
    }
  }

  // 3) Basename / alias forms.
  for (const quote of ["'", '"']) {
    add(`from ${quote}${stem}${quote}`);
    add(`from ${quote}./${stem}${quote}`);
    add(`require(${quote}./${stem}${quote})`);
    add(`from ${quote}@/${stem}${quote}`);
    if (file.includes("/")) {
      add(`from ${quote}${withoutExt}${quote}`);
      add(`from ${quote}${file}${quote}`);
    }
  }

  // 3b) packages/<pkg>/… → prefer the workspace-relative suffix (matches
  // `@scope/pkg/...` import strings via Zoekt substring).
  if (pathParts[0] === "packages" && pathParts.length >= 3) {
    const pkgAndRest = pathParts.slice(1).join("/");
    add(pkgAndRest);
    for (const quote of ["'", '"']) {
      add(`/${pkgAndRest}${quote}`);
    }
  }

  // 4) Python-style imports of the module stem.
  if (/\.py$/i.test(file)) {
    add(`from ${stem} import`);
    add(`import ${stem}`);
  }

  // 5) Exported / ask symbols last (MAX_USER_FACING_RESPONSE_MS, StateGroup, …).
  for (const symbol of symbols) {
    const trimmed = symbol.trim();
    if (trimmed.length < 3) {
      continue;
    }
    add(trimmed);
    add(`import { ${trimmed}`);
    add(`import ${trimmed}`);
    add(`from ${quoteSafe(stem)} import ${trimmed}`);
  }

  return patterns;
}

/**
 * Exported names from source text — used as verified Zoekt queries when the
 * default Blast ask has no domain symbols (e.g. MAX_USER_FACING_RESPONSE_MS).
 */
export function extractExportNamesFromSource(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|type|enum|interface|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_]*)\s*[\(:]/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+\{\s*([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*$/i, "")
        .trim();
      if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        names.add(name);
      }
    }
  }
  // Prefer distinctive identifiers (SCREAMING_SNAKE / long names).
  return [...names]
    .filter((name) => name.length >= 4)
    .sort((a, b) => {
      const score = (s: string): number =>
        (/^[A-Z][A-Z0-9_]+$/.test(s) ? 0 : 2) + (s.length >= 12 ? 0 : 1);
      return score(a) - score(b) || b.length - a.length;
    })
    .slice(0, 8);
}

function quoteSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.]/g, "_");
}

/** Default Blast chip ask — no domain symbols; searching "Estimate" only adds noise. */
export function isGenericBlastImpactAsk(ask: string | undefined): boolean {
  const text = ask?.trim() ?? "";
  if (!text) {
    return true;
  }
  return /^estimate the impact of changing this code\.?$/i.test(text);
}

/**
 * Only zoekt/scip text hits count as verified callers. Embedding similarity is
 * labeled "heuristic" in the UI and routinely returns unrelated files.
 * Aggregate "hybrid" (zoekt+…) is treated as verified at the client via
 * mapSearchSourceToGraphSource / isVerifiedCallerSearchSource on remapped zoekt.
 */
export function isVerifiedCallerSearchSource(source: LocalSearchResult["source"]): boolean {
  return source === "zoekt" || source === "scip";
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

/** When hit content is real line text, require the module stem, path suffix, or symbol. */
export function hitLooksLikeReferenceToTarget(
  hit: { fileName: string; content?: string },
  file: string,
  symbols: string[] = []
): boolean {
  const content = (hit.content ?? "").trim();
  const pathOnly = !content || content === hit.fileName || content === normalizeHitPath(hit.fileName);
  if (pathOnly) {
    // Remote graphSearch often returns path-only rows; trust zoekt/scip source filter only.
    return true;
  }
  const basename = file.split("/").pop() ?? file;
  const stem = basename.replace(/\.[^.]+$/, "");
  const withoutExt = file.replace(/\.[^.]+$/, "");
  const pathParts = withoutExt.split("/").filter(Boolean);
  if (content.includes(stem) || content.includes(basename) || content.includes(file)) {
    return true;
  }
  for (let i = 0; i < pathParts.length; i++) {
    const suffix = pathParts.slice(i).join("/");
    if (suffix.length >= 3 && content.includes(suffix)) {
      return true;
    }
  }
  return symbols.some((symbol) => symbol.length >= 3 && content.includes(symbol));
}

/** PascalCase / CamelCase symbols from the blast ask (e.g. StateGroup, DocumentStatus). */
export function extractBlastSearchSymbols(ask: string | undefined, file?: string): string[] {
  if (isGenericBlastImpactAsk(ask)) {
    return [];
  }
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
    "Changing",
    "Rename",
    "Values",
    "Break",
    "Breaks",
    "Draft",
    "Pending",
    "Completed",
    "Rejected",
    "Estimate",
    "Impact",
    "Code",
    "File",
    "Files",
    "Radius",
    "Blast",
    "Summary",
    "Direct",
    "None",
    "Related",
    "Testing",
    "Sources",
    "Medium",
    "High",
    "Low",
    "Partial",
    "Index",
    "Coverage",
    "Analysis",
    "Identify",
    "Surfaces",
    "Risk",
    "Risks",
    "Operational",
    "Transitive",
    "Dependents",
    "Caller",
    "Callers"
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
  /**
   * Absolute filesystem roots for offline/dev-only scans.
   * Must stay empty for Zero-Clone / remote indexed repos — never pass open
   * VS Code folders on the Blast hot path or we fake a local-repo success.
   */
  localRoots?: string[];
  /**
   * When true (default), ignore localRoots so Blast cannot claim callers from
   * a downloaded folder. Set false only for explicit offline tooling/tests.
   */
  remoteOnly?: boolean;
};

/** High-signal substrings for a single local filesystem walk. */
export function buildLocalCallerNeedles(file: string, symbols: string[] = []): string[] {
  const withoutExt = file.replace(/\.[^.]+$/, "");
  const parts = withoutExt.split("/").filter(Boolean);
  const needles: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 3 || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    needles.push(trimmed);
  };
  for (let i = 0; i < parts.length; i++) {
    add(parts.slice(i).join("/"));
  }
  for (const symbol of symbols.slice(0, 6)) {
    add(symbol);
  }
  return needles;
}

/**
 * Scan local workspace/clone roots for import/symbol references when the remote
 * index cannot verify callers (no Zoekt / embedding-only).
 */
export function searchDependentsInLocalRoots(
  roots: string[],
  file: string,
  options: { symbols?: string[]; maxHits?: number } = {}
): { dependents: BlastRadiusDependentDetail[]; source: GraphEdgeSource; warnings: string[] } {
  const warnings: string[] = [];
  const needles = buildLocalCallerNeedles(file, options.symbols ?? []);
  if (!roots.length || !needles.length) {
    return { dependents: [], source: "remote", warnings };
  }

  const maxHits = Math.max(1, Math.min(options.maxHits ?? 30, 40));
  const seen = new Set<string>([file.replace(/\\/g, "/")]);
  const dependents: BlastRadiusDependentDetail[] = [];
  const needleLower = needles.map((needle) => needle.toLowerCase());

  for (const root of roots) {
    if (!root || !fsExists(root)) {
      continue;
    }
    walkLocalTextFiles(root, (absolutePath, relativePath) => {
      if (dependents.length >= maxHits) {
        return false;
      }
      const depPath = relativePath.replace(/\\/g, "/");
      if (!depPath || seen.has(depPath) || depPath === file) {
        return true;
      }
      let content: string;
      try {
        content = fsReadFile(absolutePath);
      } catch {
        return true;
      }
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const lower = line.toLowerCase();
        if (!needleLower.some((needle) => lower.includes(needle))) {
          continue;
        }
        if (
          !hitLooksLikeReferenceToTarget(
            { fileName: depPath, content: line },
            file,
            options.symbols ?? []
          )
        ) {
          continue;
        }
        seen.add(depPath);
        dependents.push({ path: depPath, depth: 1, source: "workspace" });
        break;
      }
      return dependents.length < maxHits;
    });
    if (dependents.length >= maxHits) {
      break;
    }
  }

  if (dependents.length === 0) {
    warnings.push("Workspace text search found no import/symbol callers for this file.");
    return { dependents: [], source: "remote", warnings };
  }

  warnings.push(
    `Dependents verified via workspace text search (${dependents.length} file(s)) — index Zoekt unavailable or empty.`
  );
  return {
    dependents: sortDependentsProductionFirst(dependents).slice(0, maxHits),
    source: "workspace",
    warnings
  };
}

/**
 * Durable remote dependents for Blast and plain-chat caller asks.
 * Prefer indexBackend.dependents (import-parse / scip / zoekt); fall back to
 * remote import-pattern search. Never scans localRoots (Zero-Clone).
 */
export async function resolveTrustedRemoteDependents(
  indexBackend: IndexBackend,
  repoId: string,
  file: string,
  options: {
    maxPatterns?: number;
    symbols?: string[];
    /** When false, skip Zoekt/SCIP search if durable API already returned trusted hits. */
    enrichWithSearch?: boolean;
  } = {}
): Promise<{ dependents: BlastRadiusDependentDetail[]; source: GraphEdgeSource; warnings: string[] }> {
  const warnings: string[] = [];
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  let fallback: {
    dependents: BlastRadiusDependentDetail[];
    source: GraphEdgeSource;
    warnings: string[];
  } = { dependents: [], source: "remote", warnings: [] };

  try {
    const apiDeps = await indexBackend.dependents(normalizedRepoId, file);
    if (apiDeps.dependents.length > 0 && isTrustedBlastGraphSource(apiDeps.source)) {
      fallback = {
        dependents: apiDeps.dependents.map((path) => ({
          path,
          depth: 1,
          source: asGraphEdgeSource(apiDeps.source)
        })),
        source: asGraphEdgeSource(apiDeps.source),
        warnings: [
          `Dependents from durable ${apiDeps.source} graph — ${apiDeps.dependents.length} direct caller(s).`
        ]
      };
    }
  } catch {
    // Soft gather — continue with remote search.
  }

  const shouldSearch =
    fallback.dependents.length === 0 || options.enrichWithSearch === true;
  if (!shouldSearch) {
    return fallback;
  }

  try {
    const search = await searchDependentsFallback(indexBackend, normalizedRepoId, file, {
      maxPatterns: options.maxPatterns,
      symbols: options.symbols,
      remoteOnly: true
    });
    warnings.push(...fallback.warnings, ...search.warnings);
    if (fallback.dependents.length === 0) {
      return {
        dependents: search.dependents,
        source: search.source,
        warnings: [...new Set(warnings)]
      };
    }
    if (search.dependents.length > 0 && search.source !== "workspace") {
      const seen = new Set(fallback.dependents.map((entry) => entry.path));
      for (const entry of search.dependents) {
        if (!seen.has(entry.path)) {
          seen.add(entry.path);
          fallback.dependents.push({
            ...entry,
            // Keep durable provenance on the bundle source; per-path may be zoekt.
            source: entry.source
          });
        }
      }
      fallback.dependents = sortDependentsProductionFirst(fallback.dependents).slice(0, 30);
    }
    return { ...fallback, warnings: [...new Set(warnings)] };
  } catch {
    return { ...fallback, warnings: [...new Set([...fallback.warnings, ...warnings])] };
  }
}

/**
 * Promote trusted remote dependents onto a dependencies / chat context data object
 * for prompt serialization and blastRadiusFromBundle.
 */
export function mergeDurableDependentsIntoContextData(
  data: Record<string, unknown>,
  resolved: {
    dependents: BlastRadiusDependentDetail[];
    source: GraphEdgeSource;
    warnings: string[];
  }
): Record<string, unknown> {
  if (resolved.dependents.length === 0) {
    return data;
  }
  const ranked = sortDependentsProductionFirst(resolved.dependents);
  const priorWarnings = Array.isArray(data.warnings)
    ? (data.warnings as unknown[]).filter((w): w is string => typeof w === "string")
    : [];
  return {
    ...data,
    directDependents: ranked.map((entry) => entry.path),
    dependentDetails: ranked,
    warnings: [...new Set([...priorWarnings, ...resolved.warnings])],
    graphMeta: {
      ...(typeof data.graphMeta === "object" && data.graphMeta !== null
        ? (data.graphMeta as Record<string, unknown>)
        : {}),
      source: resolved.source
    }
  };
}

/** Search index for files that import/reference the target when SCIP dependents are empty. */
export async function searchDependentsFallback(
  indexBackend: IndexBackend,
  repoId: string,
  file: string,
  options: SearchDependentsFallbackOptions = {}
): Promise<{ dependents: BlastRadiusDependentDetail[]; source: GraphEdgeSource; warnings: string[] }> {
  const warnings: string[] = [];
  const normalizedRepoId = normalizeGraphRepoId(repoId);
  const symbols = options.symbols ?? [];
  // Zero-Clone default: never scan open folders for Blast callers.
  const remoteOnly = options.remoteOnly !== false;
  const localRoots = remoteOnly
    ? []
    : (options.localRoots ?? []).filter((root) => Boolean(root?.trim()));

  let enabled = false;
  try {
    enabled = await indexBackend.isEnabledForRepo(normalizedRepoId);
  } catch {
    enabled = false;
  }

  const patterns = buildImportSearchPatterns(file, symbols);
  // Prefer import-path patterns first; symbol patterns second (enums/classes).
  // Never let bare English tokens from the ask crowd out real import queries.
  const importPatterns = patterns.filter(
    (pattern) => !symbols.some((symbol) => pattern === symbol || pattern.startsWith(`${symbol}.`) || pattern.startsWith(`${symbol}(`))
  );
  const symbolPatterns = patterns.filter((pattern) => !importPatterns.includes(pattern));
  const ordered = [...symbolPatterns, ...importPatterns];
  const maxPatterns = Math.max(1, Math.min(options.maxPatterns ?? 10, ordered.length));
  const seen = new Set<string>([file]);
  const dependents: BlastRadiusDependentDetail[] = [];
  let bestSource: GraphEdgeSource = "remote";
  let skippedUnverified = 0;

  if (enabled) {
    for (const pattern of ordered.slice(0, maxPatterns)) {
      try {
        const result = await indexBackend.search(normalizedRepoId, pattern);
        const verifiedHits = result.hits.filter((hit) => {
          const hitSource = hit.source ?? result.source;
          return isVerifiedCallerSearchSource(hitSource);
        });
        if (verifiedHits.length === 0) {
          if (result.hits.length > 0) {
            skippedUnverified += result.hits.length;
          }
          continue;
        }
        const resultSource = isVerifiedCallerSearchSource(result.source)
          ? result.source
          : (verifiedHits[0]?.source ?? "zoekt");
        const source = mapSearchSourceToGraphSource(resultSource);
        if (source === "zoekt" || source === "scip") {
          bestSource = source;
        }
        for (const hit of verifiedHits) {
          const depPath = normalizeHitPath(hit.fileName);
          if (!depPath || seen.has(depPath) || depPath === file) {
            continue;
          }
          if (!hitLooksLikeReferenceToTarget(hit, file, symbols)) {
            continue;
          }
          const hitGraphSource = mapSearchSourceToGraphSource(hit.source ?? resultSource);
          seen.add(depPath);
          dependents.push({ path: depPath, depth: 1, source: hitGraphSource });
        }
      } catch (error) {
        warnings.push(`Import-pattern search failed for "${pattern}": ${errorMessage(error)}`);
      }
    }
  }

  if (skippedUnverified > 0 && dependents.length === 0) {
    warnings.push(
      `Skipped ${skippedUnverified} embedding/fallback hit(s) — not import-verified callers.`
    );
  }

  if (dependents.length === 0 && localRoots.length > 0) {
    const local = searchDependentsInLocalRoots(localRoots, file, {
      symbols,
      maxHits: 30
    });
    warnings.push(...local.warnings);
    if (local.dependents.length > 0) {
      return {
        dependents: local.dependents,
        source: local.source,
        warnings: [...new Set(warnings)]
      };
    }
  }

  const ranked = sortDependentsProductionFirst(dependents);
  return {
    dependents: ranked.slice(0, 30),
    source: ranked.length > 0 ? bestSource : "remote",
    warnings: [...new Set(warnings)]
  };
}

/**
 * Merge verified import/symbol search into the blast dependencies bundle entry.
 *
 * Prefer search hits over any prior job sample. When search is empty, clear
 * unverified directDependents so junk remote edges cannot survive as "callers."
 * Optional `keepIfSearchEmpty` preserves already-filtered job edges (to===file).
 */
export function mergeSearchDependentsFallbackIntoDependenciesData(
  data: Record<string, unknown>,
  fallback: {
    dependents: BlastRadiusDependentDetail[];
    source: GraphEdgeSource;
    warnings: string[];
  },
  options?: { keepFilteredJobDependentsIfSearchEmpty?: boolean }
): Record<string, unknown> {
  const priorWarnings = Array.isArray(data.warnings)
    ? (data.warnings as unknown[]).filter((w): w is string => typeof w === "string")
    : [];
  const warnings = [...priorWarnings, ...fallback.warnings];
  const priorDirect = Array.isArray(data.directDependents)
    ? (data.directDependents as unknown[]).filter((p): p is string => typeof p === "string")
    : [];

  if (fallback.dependents.length > 0) {
    const ranked = sortDependentsProductionFirst(fallback.dependents);
    warnings.push(
      `Dependents verified via ${fallback.source} import/symbol search — prefer these over unfiltered graph samples.`
    );
    return {
      ...data,
      directDependents: ranked.map((entry) => entry.path),
      dependentDetails: ranked,
      warnings: [...new Set(warnings)],
      graphMeta: {
        ...(typeof data.graphMeta === "object" && data.graphMeta !== null
          ? (data.graphMeta as Record<string, unknown>)
          : {}),
        source: fallback.source
      }
    };
  }

  if (options?.keepFilteredJobDependentsIfSearchEmpty && priorDirect.length > 0) {
    warnings.push(
      "Import/symbol search found no additional callers — keeping dependency edges that target this file only."
    );
    return {
      ...data,
      warnings: [...new Set(warnings)]
    };
  }

  warnings.push(
    "No dependents verified in import/symbol search for this file. Impact unverified — do not claim zero impact."
  );
  const { directDependents: _dropDirect, dependentDetails: _dropDetails, ...rest } = data;
  return {
    ...rest,
    directDependents: [],
    dependentDetails: [],
    warnings: [...new Set(warnings)],
    graphMeta: {
      ...(typeof data.graphMeta === "object" && data.graphMeta !== null
        ? (data.graphMeta as Record<string, unknown>)
        : {}),
      source: fallback.source
    }
  };
}

export function buildTestSearchPatterns(file: string): string[] {
  const basename = file.split("/").pop() ?? file;
  const stem = basename.replace(/\.[^.]+$/, "");
  return uniqueStrings([basename, stem, file]);
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

function fsExists(root: string): boolean {
  try {
    return nodeFs().existsSync(root);
  } catch {
    return false;
  }
}

function fsReadFile(absolutePath: string): string {
  return nodeFs().readFileSync(absolutePath, "utf8");
}

const LOCAL_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "vendor"
]);

function isLocalTextCandidate(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (
    !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rs|cs|rb|php|swift)$/i.test(lower) &&
    !lower.endsWith(".vue") &&
    !lower.endsWith(".svelte")
  ) {
    return false;
  }
  if (lower.endsWith(".d.ts") || lower.includes(".min.")) {
    return false;
  }
  return true;
}

/** Depth-first walk; visitor returns false to stop. */
function walkLocalTextFiles(
  root: string,
  visitor: (absolutePath: string, relativePath: string) => boolean
): void {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Dirent[];
    try {
      entries = nodeFs().readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        if (LOCAL_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (entry.isDirectory() && entry.name !== ".github") {
          continue;
        }
      }
      if (LOCAL_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = nodePath().join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !isLocalTextCandidate(fullPath)) {
        continue;
      }
      const relativePath = nodePath().relative(root, fullPath);
      if (!visitor(fullPath, relativePath)) {
        return;
      }
    }
  }
}
