import { CandidateLedger, canonicalSearchCriterion } from "../candidateLedger";
import type { LocalSearchResult, ScipSymbol, ZoektSearchHit } from "../../../indexing/types";
import {
  contentLooksLikeAskedFieldReject,
  verifiedFieldHandlingEvidence,
  askRejectJobTokens,
  contentLooksLikeStateModelDeclaration,
  identifierSearchAliases,
  extractAgentSearchQuery,
  isActionableApiRejectHit,
  isApiRejectAsk,
  isBackendStateLocateAsk,
  isBackendStateDefinitionHit,
  lineNumberOfWriteReject,
  rankSearchHits,
  isRejectShapedSearchCriterion,
  lightningHitsSatisfySearchQuery,
  shouldFailOpenCodeHostSearch
} from "../searchQuery";
import type { AgentToolContext } from "../agentToolContext";
import { isClientUiPath, isSeedOrFixturePath, isSchemaCatalogPath, isLocaleCatalogPath, isDocOrSpecPath, isTestPath } from "../../../indexing/evidencePathNoise";
import { requireStringArg } from "./toolArgs";

const CODE_HOST_PATH_CAP = 8;
const CODE_HOST_BODY_ENRICH_CAP = 5;

/** Query-derived basename prefixes, across source languages; no repo layout guesses. */
export function filenameDiscoveryQueries(query: string): string[] {
  const words = query.replace(/([a-z])([A-Z])/g, "$1 $2").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const stop = new Set(["class", "model", "serializer", "validate", "valid", "invalid", "is", "not", "the", "for", "def", "create", "update"]);
  const ordered = [...words.filter((word) => /_id$|^validate_/i.test(word)), ...words];
  const stems = ordered.map((word) => word.replace(/^validate_/i, "").replace(/_id$/i, "").toLowerCase());
  return [...new Set(stems.filter((stem) => stem.length >= 3 && !stop.has(stem)))].slice(0, 2).map((stem) => `${stem}.`);
}

export function indexedEntityFilenameQueries(hits: Array<{ fileName: string }>): string[] {
  const structural = new Set(["app", "apps", "api", "src", "lib", "core", "component", "components", "web", "client", "server", "backend", "frontend", "package", "packages", "module", "modules", "store", "stores", "hook", "hooks", "util", "utils", "type", "types", "model", "models", "serializer", "serializers", "validator", "validators", "view", "views", "route", "routes", "page", "pages", "test", "tests", "index"]);
  const directories = hits.slice(0, 16).map((hit) => hit.fileName.split("/").slice(0, -1));
  // Drop shared package roots while retaining the last two directories as domain hints.
  let common = 0;
  const prefixLimit = Math.max(0, Math.min(...directories.map((parts) => parts.length)) - 2);
  while (common < prefixLimit && directories.length > 1 && directories.every((parts) => parts.length > common + 1 && parts[common] === directories[0][common])) common++;
  const frequencies = new Map<string, number>();
  for (const hit of hits.slice(0, 16)) {
    const tokens = new Set(hit.fileName.split("/").slice(common, -1).flatMap((segment) => segment.split(/[-_.]/)).map((token) => token.toLowerCase()).filter((token) => /^[a-z]{3,}$/.test(token) && !structural.has(token)).map((token) => token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token));
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return [...frequencies].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([token]) => `${token}.`);
}

function formatCitation(repoId: string, fileName: string, lineNumber: number): string {
  return `${repoId}:${fileName}:${lineNumber}`;
}

function mergeSearchResults(parts: LocalSearchResult[]): LocalSearchResult {
  const hits: ZoektSearchHit[] = [];
  const symbols: ScipSymbol[] = [];
  for (const part of parts) {
    for (const hit of part.hits) {
      if (!hits.some((seen) => seen.fileName === hit.fileName && seen.lineNumber === hit.lineNumber)) {
        hits.push(hit);
      }
    }
    for (const symbol of part.symbols) {
      if (!symbols.some((seen) => seen.file === symbol.file && seen.line === symbol.line && seen.symbol === symbol.symbol)) {
        symbols.push(symbol);
      }
    }
  }
  const first = parts[0];
  return {
    source: first?.source ?? "zoekt",
    stale: parts.some((part) => part.stale),
    hits,
    symbols
  };
}

/** Strip outer quotes so code-host APIs search the error phrase. */
export function normalizeCodeHostSearchQuery(query: string): string {
  return query.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
}

/** Phrase-shaped queries get quotes for GitHub/GitLab exact-ish match. */
export function formatCodeHostSearchQuery(query: string): string {
  const normalized = normalizeCodeHostSearchQuery(query);
  if (!normalized) {
    return normalized;
  }
  if (/\s/.test(normalized)) {
    return `"${normalized.replace(/"/g, "")}"`;
  }
  return normalized;
}

/**
 * Prefer a line that contains the full needle; otherwise the longest ≥12-char
 * contiguous fragment from the query that appears in a line.
 */
export function findQueryMatchLine(
  content: string,
  query: string
): { lineNumber: number; content: string } | undefined {
  const needle = normalizeCodeHostSearchQuery(query).toLowerCase();
  if (needle.length < 8) {
    return undefined;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      return { lineNumber: i + 1, content: lines[i].replace(/\s+$/g, "") };
    }
  }
  // Long quoted errors sometimes get tokenized by the host; try a mid-length slice.
  if (needle.length >= 16) {
    const slice = needle.slice(0, Math.min(40, needle.length));
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(slice)) {
        return { lineNumber: i + 1, content: lines[i].replace(/\s+$/g, "") };
      }
    }
  }
  return undefined;
}

async function enrichCodeHostPaths(
  ctx: AgentToolContext,
  repoId: string,
  query: string,
  paths: string[]
): Promise<ZoektSearchHit[]> {
  const hits: ZoektSearchHit[] = [];
  const seen = new Set<string>();
  let enriched = 0;
  for (const path of paths.slice(0, CODE_HOST_PATH_CAP)) {
    const normalized = path.trim().replace(/^\/+/, "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (enriched < CODE_HOST_BODY_ENRICH_CAP && ctx.readRemoteFile) {
      try {
        const file = await ctx.readRemoteFile({ path: normalized, repoId });
        if (file?.content?.trim()) {
          const match = findQueryMatchLine(file.content, query);
          if (match) {
            hits.push({
              fileName: normalized,
              lineNumber: match.lineNumber,
              content: match.content,
              score: 1,
              source: "fallback"
            });
            enriched += 1;
            continue;
          }
        }
      } catch {
        // Path-only hit below.
      }
      enriched += 1;
    }
    // Path-only: rails / auto-read can still open serializers on reject.
    hits.push({
      fileName: normalized,
      lineNumber: 1,
      content: "",
      score: 0.4,
      source: "fallback"
    });
  }
  return hits;
}

async function runSearchCode(
  ctx: AgentToolContext,
  args: Record<string, unknown>,
  ledger: CandidateLedger
): Promise<string> {
  const query = requireStringArg(args, "query");
  const repoId =
    typeof args.repoId === "string" && args.repoId.trim() ? args.repoId.trim() : undefined;
  if (!repoId) {
    return JSON.stringify({ error: "Missing repoId for search_code" });
  }

  const enabled = await ctx.indexBackend.isEnabledForRepo(repoId);
  if (!enabled) {
    return JSON.stringify({
      error: `Lightning index is not enabled for ${repoId}`,
      query,
      repoId
    });
  }

  const queries = [query, ...identifierSearchAliases(query)].filter(
    (candidate, index, all) => all.findIndex((seen) => seen.toLowerCase() === candidate.toLowerCase()) === index
  );
  const parts: LocalSearchResult[] = [];
  const taskQuery = ctx.researchQuery ?? query;
  const verifyBody = (path: string, body: string) => ledger.once("verify", repoId, JSON.stringify([path, taskQuery]), async () =>
    isApiRejectAsk(taskQuery) || isRejectShapedSearchCriterion(query)
      ? contentLooksLikeAskedFieldReject(body, taskQuery, path) || Boolean(verifiedFieldHandlingEvidence({ path, content: body, evidenceSource: "remote-read" }, taskQuery))
      : isBackendStateDefinitionHit({ fileName: path, content: body }) && contentLooksLikeStateModelDeclaration(body));

  const rejectShapedQuery = isRejectShapedSearchCriterion(query) &&
    (!ctx.researchQuery || isApiRejectAsk(taskQuery));
  // Native content search is unavailable in cloud-authenticated sessions. Use
  // the same filename service as Remote Workspace and verify selected-ref bodies.
  const needsReject = isApiRejectAsk(taskQuery) || rejectShapedQuery;
  const needsStateDefinition = isBackendStateLocateAsk(taskQuery) && !needsReject;
  const satisfiesTask = (hit: ZoektSearchHit) => needsReject
    ? isActionableApiRejectHit(hit) && contentLooksLikeAskedFieldReject(hit.content ?? "", taskQuery, hit.fileName)
    : isBackendStateDefinitionHit(hit) && contentLooksLikeStateModelDeclaration(hit.content ?? "");
  const discoverFilenames = async (result: LocalSearchResult) => {
    let filenameFallbackStatus: "not_attempted" | "empty" | "paths" | "verified" | "error" = "not_attempted";
    const verifiedFileOutlines: Array<{ path: string; declarations: Array<{ name: string; line: number }> }> = [];
    if (ctx.findFiles && (needsReject || needsStateDefinition) && !result.hits.some(satisfiesTask)) {
      const discovered: string[] = [];
      filenameFallbackStatus = "empty";
      const basenameHints = (hits: ZoektSearchHit[]) => hits.flatMap((hit) => {
        const base = hit.fileName.split("/").pop()?.split(".")[0] ?? "";
        if (!/^[a-z][a-z0-9_]{2,}$/i.test(base) || base === "index") return [];
        return [base.endsWith("s") ? `${base.slice(0, -1)}.` : `${base}.`];
      });
      const indexedNames = basenameHints(result.hits.slice(0, 5));
      // A backend model/data hit can identify the entity when the user's noun
      // differs from its source name. Locale/UI frequency must not bury it.
      const entityNames = needsReject ? basenameHints(result.hits.filter((hit) =>
        !isClientUiPath(hit.fileName) && !isLocaleCatalogPath(hit.fileName) && !isDocOrSpecPath(hit.fileName) && !isTestPath(hit.fileName) &&
        (isSchemaCatalogPath(hit.fileName) || isSeedOrFixturePath(hit.fileName)))).slice(0, 2) : [];
      const discoveryQuery = needsStateDefinition ? extractAgentSearchQuery(taskQuery) : query;
      const operationNames = needsReject ? askRejectJobTokens(taskQuery) : [];
      // Generic CRUD verbs match unrelated setup commands across a repository.
      // Prefer the asked entity and specific operation before those broad names.
      const specificOperations = operationNames.filter((name) => !/^(?:create|update|delete|read)$/i.test(name));
      const broadOperations = operationNames.filter((name) => /^(?:create|update|delete|read)$/i.test(name));
      const filenameQueries = [...new Set([...specificOperations, ...entityNames, ...filenameDiscoveryQueries(discoveryQuery), ...indexedEntityFilenameQueries(result.hits), ...indexedNames, ...broadOperations])].slice(0, 4);
      ctx.onDiagnostic?.({ stage: "filename-criteria", query, criteria: filenameQueries });
      let verifiedOperationPath: string | undefined;
      for (const filenameQuery of filenameQueries) {
        try {
          const paths = await ctx.findFiles({ query: filenameQuery, taskQuery, repoId, excludeClientUi: true });
          for (const path of paths) ledger.record(repoId, path, taskQuery, "untested");
          discovered.push(...paths.filter((path) => !discovered.includes(path)));
          // Verify operation candidates before spending another remote tree walk.
          // A filename alone never establishes a match.
          if (paths.length) {
            const operationCandidates = rankSearchHits(paths.filter((fileName) => !isClientUiPath(fileName)).map((fileName) => ({ fileName, lineNumber: 1, content: "", score: 0.4 })), taskQuery);
            for (const candidate of operationCandidates.slice(0, CODE_HOST_BODY_ENRICH_CAP)) {
              const file = await ctx.readRemoteFile?.({ path: candidate.fileName, repoId }).catch(() => undefined);
              const accepted = file?.content ? await verifyBody(candidate.fileName, file.content) : false;
              ledger.record(repoId, candidate.fileName, taskQuery, !file?.content ? "unavailable" : accepted ? "verified" : "ruled_out");
              ctx.onDiagnostic?.({ stage: "candidate", path: candidate.fileName, status: !file?.content ? "unavailable" : accepted ? "verified" : "ruled-out", reason: "remote body verification" });
              if (accepted) {
                verifiedOperationPath = candidate.fileName;
                break;
              }
            }
            if (verifiedOperationPath) break;
          }
        } catch {
          filenameFallbackStatus = "error";
        }
      }
      if (discovered.length) {
        filenameFallbackStatus = "paths";
        const candidates = rankSearchHits((verifiedOperationPath ? [verifiedOperationPath] : discovered).filter((fileName) => !isClientUiPath(fileName)).map((fileName) => ({ fileName, lineNumber: 1, content: "", score: 0.4 })), taskQuery);
        const verified: ZoektSearchHit[] = [];
        const unavailable: ZoektSearchHit[] = [];
        for (const candidate of candidates.slice(0, CODE_HOST_BODY_ENRICH_CAP)) {
          try {
            const file = await ctx.readRemoteFile?.({ path: candidate.fileName, repoId });
            if (!file?.content?.trim()) {
              ctx.onDiagnostic?.({ stage: "candidate", path: candidate.fileName, status: "unavailable", reason: "no remote body" });
              ledger.record(repoId, candidate.fileName, taskQuery, "unavailable");
              unavailable.push(candidate);
              continue;
            }
            const body = file.content;
            const accepted = await verifyBody(candidate.fileName, body);
            ctx.onDiagnostic?.({ stage: "candidate", path: candidate.fileName, status: accepted ? "verified" : "ruled-out", reason: accepted ? "requested behavior found in remote body" : "remote body does not establish requested behavior" });
            ledger.record(repoId, candidate.fileName, taskQuery, accepted ? "verified" : "ruled_out");
            if (!accepted) continue;
            const rows = body.split(/\r?\n/);
            verifiedFileOutlines.push({
              path: candidate.fileName,
              declarations: rows.flatMap((row, index) => {
                const match = row.match(/^\s*(?:async\s+)?(?:def|class|func|function)\s+([A-Za-z_]\w*)/);
                return match ? [{ name: match[1], line: index + 1 }] : [];
              }).slice(0, 60)
            });
            const line = needsReject ? lineNumberOfWriteReject(body, taskQuery, candidate.fileName) ?? 1
              : rows.findIndex((row) => /\b(?:class|struct|type)\s+State\b/.test(row)) + 1;
            verified.push({ fileName: candidate.fileName, lineNumber: Math.max(1, line), content: verifiedFieldHandlingEvidence({ path: candidate.fileName, content: body, evidenceSource: "remote-read" }, taskQuery) ? body : rows.slice(Math.max(0, line - 8), line + 20).join("\n"), score: 1, source: "fallback" });
            break;
          } catch {
            // A discovered filename is still only a candidate when its body is unavailable.
            ledger.record(repoId, candidate.fileName, taskQuery, "unavailable");
            unavailable.push(candidate);
          }
        }
        if (verified.length) {
          filenameFallbackStatus = "verified";
          result = { ...result, source: "fallback", hits: [...verified, ...result.hits] };
        } else {
          result = { ...result, hits: [...result.hits, ...unavailable] };
        }
      }
    }
    return { result, filenameFallbackStatus, verifiedFileOutlines };
  };
  // Remote filename/body verification gets a chance even when index search is slow.
  const filenameSearch = discoverFilenames({ source: "fallback", stale: false, hits: [], symbols: [] });
  for (const pattern of queries) {
    // Casing aliases add lexical coverage, but duplicate a vector query.
    if (parts[0]?.source === "embedding" && pattern !== query) continue;
    const startedAt = Date.now();
    ctx.onDiagnostic?.({ stage: "index-search-start", query: pattern });
    try {
      const part = await ctx.indexBackend.search(repoId, pattern);
      ctx.onDiagnostic?.({ stage: "index-search", query: pattern, source: part.source, stale: part.stale, elapsedMs: Date.now() - startedAt, hitCount: part.hits.length, symbolCount: part.symbols.length, hits: part.hits.slice(0, 24).map((hit) => ({ path: hit.fileName, line: hit.lineNumber, score: hit.score })), symbols: part.symbols.slice(0, 24).map((symbol) => ({ path: symbol.file, line: symbol.line, symbol: symbol.symbol })) });
      parts.push(part);
    } catch (error) {
      ctx.onDiagnostic?.({ stage: "index-search", query: pattern, outcome: "error", elapsedMs: Date.now() - startedAt });
      throw error;
    }
  }
  if (parts[0]?.source === "embedding" && isApiRejectAsk(taskQuery) && taskQuery !== query) {
    const startedAt = Date.now();
    ctx.onDiagnostic?.({ stage: "index-search-start", query: taskQuery });
    try {
      const part = await ctx.indexBackend.search(repoId, taskQuery);
      parts.push(part);
      ctx.onDiagnostic?.({ stage: "index-search", query: taskQuery, source: part.source, stale: part.stale, elapsedMs: Date.now() - startedAt, hitCount: part.hits.length, symbolCount: part.symbols.length, hits: part.hits.slice(0, 24).map((hit) => ({ path: hit.fileName, line: hit.lineNumber, score: hit.score })) });
    } catch {
      ctx.onDiagnostic?.({ stage: "index-search", query: taskQuery, outcome: "error", elapsedMs: Date.now() - startedAt });
    }
  }
  let result = mergeSearchResults(parts);
  let codeHostFallback = false;
  for (const hit of result.hits) ledger.record(repoId, hit.fileName, taskQuery, "untested");
  for (const symbol of result.symbols) ledger.record(repoId, symbol.file, taskQuery, "untested");
  const hasActionableRejectBody = result.hits.some(
    (hit) =>
      isActionableApiRejectHit(hit) &&
      contentLooksLikeAskedFieldReject(hit.content ?? "", query, hit.fileName)
  );
  const shouldUseCodeHostFallback = rejectShapedQuery
    ? !hasActionableRejectBody
    : shouldFailOpenCodeHostSearch(query) && !lightningHitsSatisfySearchQuery(result.hits, query);
  const codeHostFallbackAttempted = Boolean(ctx.searchCodeHost && shouldUseCodeHostFallback);
  let codeHostFallbackStatus: "not_attempted" | "no_paths" | "paths_no_match" | "results" | "error" =
    codeHostFallbackAttempted ? "no_paths" : "not_attempted";
  // Filename discovery must not wait behind a slow or unavailable content search.
  // Both paths use the same run-scoped target and shared gather budget.
  const hostSearch = (async (): Promise<LocalSearchResult | undefined> => {
    if (!codeHostFallbackAttempted || !ctx.searchCodeHost) return undefined;
    const matchNeedle = normalizeCodeHostSearchQuery(query);
    const fieldTokens = matchNeedle.match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi) ?? [];
    const hostQueries = [formatCodeHostSearchQuery(query), matchNeedle, ...fieldTokens].filter(
      (candidate, index, all) => Boolean(candidate) && all.indexOf(candidate) === index
    );
    for (const hostQuery of hostQueries) {
      try {
        const hostHits = await ctx.searchCodeHost({
          query: hostQuery,
          repoId,
          limit: CODE_HOST_PATH_CAP
        });
        const paths = (hostHits ?? [])
          .map((hit) => hit.path?.trim())
          .filter((path): path is string => Boolean(path));
        if (paths.length === 0) {
          continue;
        }
        codeHostFallbackStatus = "paths_no_match";
        const enriched = await enrichCodeHostPaths(ctx, repoId, matchNeedle, paths);
        if (enriched.length > 0) {
          // Prefer host hits that carry the phrase; keep Lightning only as leftovers if host empty.
          codeHostFallback = true;
          codeHostFallbackStatus = "results";
          return { source: "fallback", stale: false, hits: enriched, symbols: result.symbols };
        }
      } catch (error) {
        codeHostFallbackStatus = "error";
        if ((error as { code?: string }).code === "unsupported") break;
        // A phrase-query miss/error must not prevent the simpler literal query.
      }
    }
    return undefined;
  })();

  const filenameResult = await filenameSearch;
  const discovery = filenameResult.filenameFallbackStatus === "verified"
    ? { ...filenameResult, result: mergeSearchResults([filenameResult.result, result]) }
    : await discoverFilenames(result);
  result = discovery.result;
  const { filenameFallbackStatus, verifiedFileOutlines } = discovery;

  const hostResult = await hostSearch;
  if (hostResult) {
    result = filenameFallbackStatus === "verified"
      ? mergeSearchResults([result, hostResult])
      : hostResult;
  }

  return JSON.stringify({
    repoId,
    query,
    queriesTried: queries,
    source: result.source,
    stale: result.stale,
    ...(codeHostFallback ? { codeHostFallback: true } : {}),
    sampleNote:
      "search_code returns ranked hits from the index — not a complete file inventory or exhaustive match list.",
    hitCount: result.hits.length,
    codeHostFallbackAttempted,
    codeHostFallbackStatus,
    filenameFallbackStatus,
    verifiedFileOutlines,
    candidateLedger: ledger.snapshot(repoId),
    hits: result.hits.map((hit) => ({
      citation: formatCitation(repoId, hit.fileName, hit.lineNumber),
      fileName: hit.fileName,
      lineNumber: hit.lineNumber,
      content: hit.content,
      score: hit.score
    })),
    symbols: result.symbols.map((symbol) => ({
      citation: formatCitation(repoId, symbol.file, symbol.line),
      symbol: symbol.symbol,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      displayName: symbol.displayName
    }))
  });
}


// AgentToolContext is owned by a frozen run. Weak ownership prevents cross-turn reuse.
const turnLedgers = new WeakMap<AgentToolContext, CandidateLedger>();
export async function handleSearchCode(ctx: AgentToolContext, args: Record<string, unknown>): Promise<string> {
  const query = requireStringArg(args, "query");
  const repoId = typeof args.repoId === "string" ? args.repoId.trim() : "";
  let ledger = ctx.candidateLedger ?? turnLedgers.get(ctx);
  if (!ledger) {
    ledger = new CandidateLedger();
    turnLedgers.set(ctx, ledger);
  }
  const memory = ledger;
  const scoped: AgentToolContext = {
    ...ctx,
    indexBackend: new Proxy(ctx.indexBackend, {
      get(target, property) {
        if (property === "search") return (repo: string, pattern: string, options?: Parameters<typeof target.search>[2]) =>
          memory.once("index-literal", repo, JSON.stringify([pattern.trim(), options ?? null]), () => target.search(repo, pattern, options));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }),
    ...(ctx.readRemoteFile ? { readRemoteFile: (options: Parameters<NonNullable<AgentToolContext["readRemoteFile"]>>[0]) =>
      memory.once("body", options.repoId ?? repoId, options.path, () => ctx.readRemoteFile!(options)) } : {}),
    ...(ctx.findFiles ? { findFiles: (options: Parameters<NonNullable<AgentToolContext["findFiles"]>>[0]) =>
      memory.once("filename-literal", options.repoId ?? repoId, JSON.stringify([options.query, options.taskQuery ?? null, options.excludeClientUi ?? false]), () => ctx.findFiles!(options)) } : {}),
    ...(ctx.searchCodeHost ? { searchCodeHost: (options: Parameters<NonNullable<AgentToolContext["searchCodeHost"]>>[0]) =>
      memory.once("host-literal", options.repoId ?? repoId, JSON.stringify([options.query, options.limit ?? null]), () => ctx.searchCodeHost!(options)) } : {})
  };
  const criterion = JSON.stringify([canonicalSearchCriterion(query), canonicalSearchCriterion(ctx.researchQuery ?? query)]);
  return memory.once("result", repoId, criterion, () => runSearchCode(scoped, args, memory));
}
