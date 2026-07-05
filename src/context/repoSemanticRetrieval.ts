import type { SecureApiClient } from "../chat/SecureApiClient";
import type { IndexBackend } from "../indexing/indexBackend";
import type { LocalSearchResult } from "../indexing/types";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";

export const MAX_SEMANTIC_FILES = 3;
export const MAX_SEMANTIC_BYTES = 80 * 1024;

export type RepoSemanticSnippet = {
  path: string;
  repoId: string;
  content: string;
  truncated?: boolean;
};

export type RepoSemanticSearchContext = {
  source: "repo-semantic-search";
  query: string;
  searchSource?: LocalSearchResult["source"];
  files: RepoSemanticSnippet[];
};

export type RepoSemanticRetrievalGateOptions = {
  queryText?: string;
  quickAction?: string;
  intentIsPlainChat?: boolean;
  inScopeMentionCount?: number;
  enabled?: boolean;
};

export function shouldRunRepoSemanticRetrieval(options: RepoSemanticRetrievalGateOptions): boolean {
  if (options.enabled === false) {
    return false;
  }
  if (options.quickAction) {
    return false;
  }
  if (options.intentIsPlainChat === false) {
    return false;
  }
  const query = options.queryText?.trim() ?? "";
  if (query.length < 12) {
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
  extras: { inScopeMentionCount?: number; enabled?: boolean } = {}
): RepoSemanticRetrievalGateOptions {
  return {
    queryText: request.intent.context.queryText,
    quickAction: request.params.quickAction,
    intentIsPlainChat: isPlainChatIntentEvent(request.intent),
    inScopeMentionCount: extras.inScopeMentionCount,
    enabled: extras.enabled
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
  inScopeMentionCount?: number;
  enabled?: boolean;
};

export async function searchRepoForChat(
  options: SearchRepoForChatOptions
): Promise<RepoSemanticSearchContext | undefined> {
  const enabled =
    options.enabled ??
    (await import("../config/semanticRetrievalConfig")).readSemanticRetrievalEnabled();
  if (!shouldRunRepoSemanticRetrieval(gateOptionsFromRequest(options.request, { ...options, enabled }))) {
    return undefined;
  }

  const repoId = options.request.params.repoId?.trim();
  const query = options.request.intent.context.queryText?.trim();
  if (!repoId || !query) {
    return undefined;
  }

  const searchResult = await runRepoSearch(options, repoId, query);
  const rankedPaths = rankSearchPaths(searchResult);
  if (rankedPaths.length === 0) {
    return undefined;
  }

  const resolved: Array<{ path: string; repoId: string; content: string }> = [];
  for (const candidate of rankedPaths) {
    if (resolved.length >= MAX_SEMANTIC_FILES) {
      break;
    }
    const content = await resolveSemanticFileContent(candidate.path, repoId, options);
    if (!content?.trim()) {
      continue;
    }
    resolved.push({ path: candidate.path, repoId, content });
  }

  const files = applySemanticByteBudget(resolved);
  if (files.length === 0) {
    return undefined;
  }

  return {
    source: "repo-semantic-search",
    query,
    searchSource: searchResult.source,
    files
  };
}

async function runRepoSearch(
  options: SearchRepoForChatOptions,
  repoId: string,
  query: string
): Promise<LocalSearchResult> {
  const fromIndex = await options.indexBackend.search(repoId, query);
  if (fromIndex.hits.length > 0 || fromIndex.symbols.length > 0) {
    return fromIndex;
  }

  try {
    const remote = (await options.api.graphSearch(options.apiBaseUrl, repoId, query)) as {
      data?: Array<{ path?: string; score?: number }>;
      symbols?: Array<{ file?: string }>;
      freshness?: LocalSearchResult["source"];
      stale?: boolean;
    };
    const hits = (remote.data ?? [])
      .filter((entry) => entry.path?.trim())
      .map((entry, index) => ({
        fileName: entry.path!.trim(),
        lineNumber: index + 1,
        content: entry.path!.trim(),
        score: entry.score ?? 1 - index * 0.01
      }));
    const symbols = (remote.symbols ?? [])
      .filter((entry) => entry.file?.trim())
      .map((entry) => ({
        symbol: "",
        kind: "",
        file: entry.file!.trim(),
        line: 1,
        character: 0,
        displayName: ""
      }));
    return {
      source: remote.freshness ?? (hits.length > 0 ? "zoekt" : "fallback"),
      hits,
      symbols,
      stale: Boolean(remote.stale)
    };
  } catch {
    return fromIndex;
  }
}

async function resolveSemanticFileContent(
  filePath: string,
  repoId: string,
  options: SearchRepoForChatOptions
): Promise<string | undefined> {
  const { readWorkspaceFileFromDisk } = await import("./localFileResolver");
  const local = readWorkspaceFileFromDisk(filePath);
  const localContent = local?.files[0]?.content?.trim();
  if (localContent) {
    return localContent;
  }

  try {
    const remote = await options.api
      .getBackendClient()
      .fetchRepoFile(options.apiBaseUrl, repoId, filePath, options.branch);
    return remote.content?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function mergeRepoSemanticContext(
  result: ContextFetchResult,
  semantic?: RepoSemanticSearchContext
): ContextFetchResult {
  if (!semantic?.files.length) {
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
