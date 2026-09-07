import type { SecureApiClient } from "../chat/SecureApiClient";
import type { CodeHostProviderPreference } from "../chat/types";
import type { IndexBackend } from "../indexing/indexBackend";
import { type GraphSearchResponse, mapGraphSearchResponse } from "../indexing/graphSearchHit";
import type { LocalSearchResult } from "../indexing/types";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import { isRepoStructureQuery } from "../workspace/repoFactIntent";
import { filterCodeEvidenceToActiveRepo } from "../workspace/repoEvidenceIsolation";
import { indexQueryForRetrieval, selectChatEvidencePaths } from "../api/agent/searchQuery";
import { FOCUS_MAX_INJECTED_PATHS, focusQueryForRetrieval } from "./userFocusQuery";
import {
  isWeakIndexQuery,
  rankOnboardingEntryFiles,
  selectOnboardingEvidencePaths
} from "./onboardingSearchQueries";
import { semanticAttachModeForChat, isOpenFileReviewAsk } from "../chat/plainChatExplain";

export const MAX_SEMANTIC_FILES = 3;
export const MAX_SEMANTIC_BYTES = 80 * 1024;
export const SEMANTIC_QUERY_MIN_LENGTH = 12;
export const SEMANTIC_QUERY_MIN_LENGTH_EDIT = 8;

export type RepoSemanticSnippet = {
  path: string;
  repoId: string;
  content: string;
  truncated?: boolean;
};

export type RepoSemanticSearchContext = {
  source: "repo-semantic-search";
  query: string;
  /** Original user ask — layer matching uses this, not the shortened index query. */
  rankQuery?: string;
  searchSource?: LocalSearchResult["source"];
  files: RepoSemanticSnippet[];
  /** Path hits when we did not attach bodies (open-file explain). */
  pathHits?: string[];
  /** Unique paths ranked from search before the attach cap — not a repo inventory. */
  matchedPathCount?: number;
  /** Hard cap used when attaching file bodies (MAX_SEMANTIC_FILES). */
  attachmentCap?: number;
};

export type RepoSemanticRetrievalGateOptions = {
  queryText?: string;
  /** Active editor selection text — supplements short slash args during /edit. */
  selectionText?: string;
  quickAction?: string;
  intentIsPlainChat?: boolean;
  /** True when composer mode is edit (/edit slash or edit composer). */
  codeEditIntent?: boolean;
  inScopeMentionCount?: number;
  enabled?: boolean;
  /** Chip / active file — open-file review must not attach estate bodies. */
  openFile?: string;
  /** Slash /docs etc. — do not attach repo search hits. */
  integrationProvider?: string;
};

export function semanticRetrievalQueryText(options: RepoSemanticRetrievalGateOptions): string {
  const query = options.queryText?.trim() ?? "";
  if (!options.codeEditIntent) {
    return query;
  }
  const selection = options.selectionText?.trim() ?? "";
  if (!selection) {
    return query;
  }
  if (!query) {
    return selection;
  }
  return `${query}\n${selection}`;
}

export function shouldRunRepoSemanticRetrieval(options: RepoSemanticRetrievalGateOptions): boolean {
  if (options.enabled === false) {
    return false;
  }
  if (options.integrationProvider) {
    return false;
  }
  if (options.quickAction) {
    return false;
  }
  if (options.intentIsPlainChat === false && !options.codeEditIntent) {
    return false;
  }
  const query = semanticRetrievalQueryText(options);
  // Repo facts (counts, structure) come from IndexedRepoWorkspace, never a 3-file sample.
  if (!options.codeEditIntent && isRepoStructureQuery(query)) {
    return false;
  }
  if (
    isOpenFileReviewAsk(query) &&
    Boolean(options.openFile?.trim()) &&
    !options.codeEditIntent
  ) {
    return false;
  }
  const minLength = options.codeEditIntent ? SEMANTIC_QUERY_MIN_LENGTH_EDIT : SEMANTIC_QUERY_MIN_LENGTH;
  if (query.length < minLength) {
    return false;
  }
  if ((options.inScopeMentionCount ?? 0) >= 2) {
    return false;
  }
  return true;
}

export function isPlainChatIntentEvent(event: {
  intent: string;
  context: { buttonClicked?: string };
}): boolean {
  return (
    !event.context.buttonClicked &&
    (event.intent === "manual_chat_submit" || event.intent === "hotkey_triggered")
  );
}

export function gateOptionsFromRequest(
  request: ContextFetchRequest,
  extras: {
    inScopeMentionCount?: number;
    enabled?: boolean;
    codeEditIntent?: boolean;
    selectionText?: string;
  } = {}
): RepoSemanticRetrievalGateOptions {
  return {
    queryText: request.intent.context.queryText,
    selectionText: extras.selectionText,
    quickAction: request.params.quickAction,
    intentIsPlainChat: isPlainChatIntentEvent(request.intent),
    codeEditIntent: extras.codeEditIntent,
    inScopeMentionCount: extras.inScopeMentionCount,
    enabled: extras.enabled,
    openFile: request.params.file,
    integrationProvider:
      typeof request.params.integrationProvider === "string"
        ? request.params.integrationProvider
        : undefined
  };
}

type RankedPath = { path: string; score: number };

export function rankSearchPaths(result: LocalSearchResult, limit = MAX_SEMANTIC_FILES * 2): RankedPath[] {
  const scores = new Map<string, number>();

  for (const hit of result.hits) {
    const path = hit.fileName?.trim();
    if (!path) {
      continue;
    }
    const score = hit.score ?? 0.5;
    scores.set(path, Math.max(scores.get(path) ?? 0, score));
  }

  for (const symbol of result.symbols) {
    const path = symbol.file?.trim();
    if (!path) {
      continue;
    }
    scores.set(path, Math.max(scores.get(path) ?? 0, 0.9));
  }

  return [...scores.entries()]
    .map(([path, score]) => ({ path, score }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function applySemanticByteBudget(
  files: Array<{ path: string; repoId: string; content: string }>,
  maxBytes = MAX_SEMANTIC_BYTES,
  maxFiles = MAX_SEMANTIC_FILES
): RepoSemanticSnippet[] {
  const snippets: RepoSemanticSnippet[] = [];
  let usedBytes = 0;

  for (const file of files) {
    if (snippets.length >= maxFiles) {
      break;
    }
    const remaining = maxBytes - usedBytes;
    if (remaining <= 0) {
      break;
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes <= remaining) {
      snippets.push({ ...file });
      usedBytes += bytes;
      continue;
    }
    const suffix = "\n… [truncated]";
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    const contentBudget = Math.max(0, remaining - suffixBytes);
    const truncated = truncateUtf8(file.content, contentBudget);
    if (!truncated.trim()) {
      break;
    }
    snippets.push({
      path: file.path,
      repoId: file.repoId,
      content: `${truncated}${suffix}`,
      truncated: true
    });
    usedBytes += Buffer.byteLength(truncated, "utf8") + suffixBytes;
    break;
  }

  return snippets;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }
  return text.slice(0, end);
}

export type SearchRepoForChatOptions = {
  request: ContextFetchRequest;
  indexBackend: IndexBackend;
  api: SecureApiClient;
  apiBaseUrl: string;
  branch?: string;
  collectionId?: string;
  searchScope?: "indexed" | "org";
  inScopeMentionCount?: number;
  enabled?: boolean;
  codeEditIntent?: boolean;
  selectionText?: string;
};

export async function searchRepoForChat(
  options: SearchRepoForChatOptions
): Promise<RepoSemanticSearchContext | undefined> {
  const enabled =
    options.enabled ??
    (await import("../config/semanticRetrievalConfig")).readSemanticRetrievalEnabled();
  const gateOptions = gateOptionsFromRequest(options.request, { ...options, enabled });
  if (!shouldRunRepoSemanticRetrieval(gateOptions)) {
    return undefined;
  }

  const repoId = options.request.params.repoId?.trim();
  const userQuery = semanticRetrievalQueryText(gateOptions);
  if (!repoId || !userQuery) {
    return undefined;
  }
  const indexQuery = indexQueryForRetrieval(userQuery);
  const openFile = options.request.params.file?.trim();
  const pathsOnly = semanticAttachModeForChat({ query: userQuery, openFile }) === "paths-only";

  return loadSemanticSearchContext({
    repoId,
    query: indexQuery,
    rankQuery: userQuery,
    indexBackend: options.indexBackend,
    api: options.api,
    apiBaseUrl: options.apiBaseUrl,
    branch: options.branch,
    owner: options.request.params.owner,
    repo: options.request.params.repo,
    provider: options.request.params.provider as CodeHostProviderPreference | undefined,
    collectionId: options.collectionId,
    searchScope: options.searchScope,
    maxFiles: pathsOnly ? 0 : MAX_SEMANTIC_FILES,
    excludePath: pathsOnly ? openFile : undefined
  });
}

export type SearchRepoForFocusOptions = {
  repoId: string;
  query: string;
  indexBackend: IndexBackend;
  api: SecureApiClient;
  apiBaseUrl: string;
  branch?: string;
  owner?: string;
  repo?: string;
  provider?: CodeHostProviderPreference;
  /** Cap on attached focus file bodies (default FOCUS_MAX_INJECTED_PATHS). */
  maxFiles?: number;
  /**
   * Topic queries for Understand Repo / Gaps. When set, these are searched in
   * parallel and hunt shortening (`indexQueryForRetrieval`) is skipped.
   */
  indexQueries?: string[];
};

/**
 * Focus-driven index search for quick actions.
 * Unlike {@link searchRepoForChat}, this is not gated off by `quickAction` —
 * callers must pass a real user focus query (never a canned prompt).
 *
 * When `indexQueries` is set (Understand / Gaps topics), those strings go to
 * the index as-is — never hunt-shortened to `"this service"` / `"Focus"`.
 */
export async function searchRepoForFocusQuery(
  options: SearchRepoForFocusOptions
): Promise<RepoSemanticSearchContext | undefined> {
  const userQuery = focusQueryForRetrieval(options.query);
  const repoId = options.repoId.trim();
  if (!userQuery || !repoId) {
    return undefined;
  }

  const maxFiles = options.maxFiles ?? FOCUS_MAX_INJECTED_PATHS;
  const topicQueries = (options.indexQueries ?? [])
    .map((query) => query.trim())
    .filter((query) => query.length >= 2 && !isWeakIndexQuery(query))
    .slice(0, 3);

  const shared = {
    repoId,
    rankQuery: userQuery,
    indexBackend: options.indexBackend,
    api: options.api,
    apiBaseUrl: options.apiBaseUrl,
    branch: options.branch,
    owner: options.owner,
    repo: options.repo,
    provider: options.provider
  };

  if (topicQueries.length === 0) {
    return loadSemanticSearchContext({
      ...shared,
      query: indexQueryForRetrieval(userQuery),
      maxFiles
    });
  }

  const perQueryCap = Math.max(2, Math.ceil(maxFiles / topicQueries.length) + 1);
  const results = await Promise.all(
    topicQueries.map((query) =>
      loadSemanticSearchContext({
        ...shared,
        query,
        rankQuery: [userQuery, ...topicQueries].filter(Boolean).join(" "),
        rankMode: "onboarding",
        maxFiles: perQueryCap
      })
    )
  );
  return mergeFocusSearchResults(results, {
    query: topicQueries.join(" | "),
    rankQuery: [userQuery, ...topicQueries].filter(Boolean).join(" "),
    maxFiles
  });
}

/** Round-robin merge of parallel topic searches — unique paths, domain files first. */
export function mergeFocusSearchResults(
  results: Array<RepoSemanticSearchContext | undefined>,
  options: { query: string; rankQuery: string; maxFiles: number }
): RepoSemanticSearchContext | undefined {
  const present = results.filter((result): result is RepoSemanticSearchContext =>
    Boolean(result && (result.files.length || result.pathHits?.length))
  );
  if (present.length === 0) {
    return undefined;
  }
  const seen = new Set<string>();
  const files: RepoSemanticSearchContext["files"] = [];
  const pathHits: string[] = [];
  let matchedPathCount = 0;
  let searchSource = present[0]?.searchSource;
  const queues = present.map((result) => [...result.files]);
  const poolCap = Math.max(options.maxFiles * 2, options.maxFiles);
  let added = true;
  while (added && files.length < poolCap) {
    added = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (!next) {
        continue;
      }
      const key = next.path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      files.push(next);
      added = true;
      if (files.length >= poolCap) {
        break;
      }
    }
  }
  const rankedFiles = rankOnboardingEntryFiles(files, options.rankQuery).slice(
    0,
    options.maxFiles
  );
  for (const result of present) {
    matchedPathCount += result.matchedPathCount ?? result.files.length;
    for (const path of result.pathHits ?? result.files.map((file) => file.path)) {
      const key = path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
      if (seen.has(`hit:${key}`)) {
        continue;
      }
      seen.add(`hit:${key}`);
      pathHits.push(path);
    }
  }
  if (rankedFiles.length === 0 && pathHits.length === 0) {
    return undefined;
  }
  return {
    source: "repo-semantic-search",
    query: options.query,
    rankQuery: options.rankQuery,
    searchSource,
    files: rankedFiles,
    pathHits: pathHits.length
      ? selectOnboardingEvidencePaths(pathHits, options.rankQuery, 12)
      : undefined,
    matchedPathCount,
    attachmentCap: options.maxFiles
  };
}

type LoadSemanticSearchOptions = {
  repoId: string;
  query: string;
  /** Original user ask — the index query is shortened, ranking needs the full words. */
  rankQuery?: string;
  indexBackend: IndexBackend;
  api: SecureApiClient;
  apiBaseUrl: string;
  branch?: string;
  owner?: string;
  repo?: string;
  provider?: CodeHostProviderPreference;
  collectionId?: string;
  searchScope?: "indexed" | "org";
  maxFiles: number;
  /** Do not attach this path (usually the already-open file). */
  excludePath?: string;
  /** Understand / Gaps: demote OpenAPI, seeds, and i18n. Hunt locate stays `selectChatEvidencePaths`. */
  rankMode?: "onboarding" | "hunt";
};

async function loadSemanticSearchContext(
  options: LoadSemanticSearchOptions
): Promise<RepoSemanticSearchContext | undefined> {
  const searchResult = await runRepoSearch(options, options.repoId, options.query);
  const pathBudget =
    options.rankMode === "onboarding"
      ? Math.max(24, options.maxFiles * 8)
      : Math.max(options.maxFiles, 1) * 4;
  const rankedPaths = rankSearchPaths(searchResult, pathBudget);
  const rankQuery = options.rankQuery ?? options.query;
  const exclude = options.excludePath?.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const candidatePaths = rankedPaths.map((entry) => entry.path);
  const selected = (
    options.rankMode === "onboarding"
      ? selectOnboardingEvidencePaths(candidatePaths, rankQuery, Math.max(options.maxFiles, 6))
      : selectChatEvidencePaths(candidatePaths, rankQuery, Math.max(options.maxFiles, 6))
  ).filter((path) => {
    if (!exclude) {
      return true;
    }
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    return normalized !== exclude && !normalized.endsWith(`/${exclude}`);
  });
  const byPath = new Map(rankedPaths.map((entry) => [entry.path, entry]));
  const filteredPaths = selected
    .map((path) => byPath.get(path))
    .filter((entry): entry is { path: string; score: number } => Boolean(entry));
  if (filteredPaths.length === 0) {
    return undefined;
  }

  if (options.maxFiles <= 0) {
    return {
      source: "repo-semantic-search",
      query: options.query,
      rankQuery: options.rankQuery,
      searchSource: searchResult.source,
      files: [],
      pathHits: filteredPaths.map((entry) => entry.path).slice(0, 6),
      matchedPathCount: rankedPaths.length,
      attachmentCap: 0
    };
  }

  const resolved: Array<{ path: string; repoId: string; content: string }> = [];
  for (const candidate of filteredPaths) {
    if (resolved.length >= options.maxFiles) {
      break;
    }
    const content = await resolveSemanticFileContent(candidate.path, options.repoId, options);
    if (!content?.trim()) {
      continue;
    }
    resolved.push({ path: candidate.path, repoId: options.repoId, content });
  }

  const files = applySemanticByteBudget(resolved, MAX_SEMANTIC_BYTES, options.maxFiles);
  const onboardingHits =
    options.rankMode === "onboarding"
      ? selectOnboardingEvidencePaths(candidatePaths, rankQuery, 12)
      : [];
  if (files.length === 0 && onboardingHits.length === 0) {
    return undefined;
  }

  // Defense in depth: never attach a snippet stamped with a foreign repoId.
  const isolated = filterSemanticFilesToRepoId(files, options.repoId);
  if (isolated.length === 0 && onboardingHits.length === 0) {
    return undefined;
  }

  return {
    source: "repo-semantic-search",
    query: options.query,
    rankQuery: options.rankQuery,
    searchSource: searchResult.source,
    files: isolated,
    pathHits: onboardingHits.length ? onboardingHits : undefined,
    matchedPathCount: rankedPaths.length,
    attachmentCap: options.maxFiles
  };
}

function searchOptionsForSemanticRetrieval(
  options: Pick<LoadSemanticSearchOptions, "collectionId" | "searchScope">
): import("../indexing/indexBackend").IndexSearchOptions | undefined {
  const collectionId = options.collectionId?.trim();
  if (collectionId) {
    return { collectionId, scope: options.searchScope };
  }
  if (options.searchScope) {
    return { scope: options.searchScope };
  }
  return undefined;
}

async function runRepoSearch(
  options: Pick<LoadSemanticSearchOptions, "indexBackend" | "api" | "apiBaseUrl" | "collectionId" | "searchScope">,
  repoId: string,
  query: string
): Promise<LocalSearchResult> {
  const searchOptions = searchOptionsForSemanticRetrieval(options);
  const fromIndex = await options.indexBackend.search(repoId, query, searchOptions);
  if (fromIndex.hits.length > 0 || fromIndex.symbols.length > 0) {
    return fromIndex;
  }

  try {
    const remote = (await options.api.graphSearch(
      options.apiBaseUrl,
      repoId,
      query,
      searchOptions
    )) as GraphSearchResponse;
    return mapGraphSearchResponse(remote);
  } catch {
    return fromIndex;
  }
}

async function resolveSemanticFileContent(
  filePath: string,
  repoId: string,
  options: Pick<LoadSemanticSearchOptions, "api" | "apiBaseUrl" | "branch" | "owner" | "repo" | "provider">
): Promise<string | undefined> {
  // Prefer indexed / code-host readers first. Never stuff Coop-AI local disk
  // bodies into plane/documenso evidence when path names collide.
  const { getIndexedRepoFileReader } = await import("./indexedRepoFileRegistry");
  const readIndexed = getIndexedRepoFileReader();
  if (readIndexed) {
    const fromIndex = await readIndexed({
      repoId,
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      provider: options.provider,
      path: filePath
    });
    if (fromIndex?.trim()) {
      return fromIndex;
    }
  }

  try {
    const remote = await options.api
      .getBackendClient()
      .fetchRepoFile(options.apiBaseUrl, repoId, filePath, options.branch);
    if (remote.content?.trim()) {
      return remote.content.trim();
    }
  } catch {
    /* Zero-Clone: no local disk hydrate */
  }

  return undefined;
}

/**
 * Drop snippets whose repoId does not match the search target.
 * Used by Gaps/chat assembly so collection-wide hits cannot become primary code evidence.
 */
export function filterSemanticFilesToRepoId<T extends { path: string; repoId: string }>(
  files: T[],
  activeRepoId: string
): T[] {
  return filterCodeEvidenceToActiveRepo(files, { repoId: activeRepoId }, { allowMissingRepoId: false });
}

export function mergeRepoSemanticContext(
  result: ContextFetchResult,
  semantic?: RepoSemanticSearchContext
): ContextFetchResult {
  if (!semantic) {
    return result;
  }
  if (!semantic.files.length && !(semantic.pathHits?.length)) {
    return result;
  }

  const baseData =
    typeof result.data === "object" && result.data !== null ? (result.data as Record<string, unknown>) : {};

  return {
    ...result,
    data: {
      ...baseData,
      repoSemanticSearch: semantic
    }
  };
}
