import { degradationCacheKey } from "../../cache/degradationCache";
import type { CodeHostProvider } from "../../api/codeHosts/types";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

const DOC_PROVIDERS = ["confluence", "notion", "google-docs"];

export async function knowledgeGaps(context: FeatureExecutionContext) {
  const params = context.request.params;
  const provider = resolveCodeHostProvider(params);
  const key = degradationCacheKey("knowledge", [params.repoId, params.file]);

  if (context.status.level === "cached" || context.status.level === "unavailable") {
    const cached = await context.cache.get(key);
    if (cached) {
      return contextResult(
        context,
        {
          ...(cached.data as Record<string, unknown>),
          cached: true,
          cacheAge: cached.cacheAge,
          fallbackLevel: "cached"
        },
        `${codeHostLabel(provider)} offline. Showing cached knowledge-gap analysis.`,
        true
      );
    }
    return unavailableResult(
      context,
      `${codeHostLabel(provider)} is offline and file structure is required for knowledge-gap analysis.`
    );
  }

  const docsOffline = context.status.unavailableProviders.some((entry) => DOC_PROVIDERS.includes(entry));
  const data = {
    file: params.file,
    fileStructure: { status: "file-structure-requested", provider },
    documentationCoverage: docsOffline ? null : { status: "documentation-search-requested" },
    orphanedFilesOnly: docsOffline,
    fallbackLevel: docsOffline ? "partial" : context.status.level
  };
  await context.cache.set(key, data, { provider, feature: "knowledge_gaps" });
  return contextResult(
    context,
    data,
    docsOffline ? "Documentation systems offline. Showing orphaned files only." : context.status.message,
    docsOffline || context.status.level !== "full"
  );
}

function resolveCodeHostProvider(params: { repoId?: string; provider?: string }): CodeHostProvider {
  if (params.repoId) {
    const fromId = coordinatesFromRepoId(
      params.repoId.includes(":") ? params.repoId : `github:${params.repoId}`
    );
    if (fromId) {
      return fromId.provider;
    }
  }
  if (params.provider === "gitlab" || params.provider === "bitbucket" || params.provider === "github") {
    return params.provider;
  }
  return "github";
}

function codeHostLabel(provider: CodeHostProvider): string {
  if (provider === "gitlab") {
    return "GitLab";
  }
  if (provider === "bitbucket") {
    return "Bitbucket";
  }
  return "GitHub";
}
