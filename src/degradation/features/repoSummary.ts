import { degradationCacheKey } from "../../cache/degradationCache";
import type { CodeHostProvider } from "../../api/codeHosts/types";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function repoSummary(context: FeatureExecutionContext) {
  const params = context.request.params;
  const provider = resolveCodeHostProvider(params);
  const key = degradationCacheKey("repo-summary", [params.repoId, params.branch]);

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
        `${codeHostLabel(provider)} offline. Showing cached repository summary.`,
        true
      );
    }
    return unavailableResult(
      context,
      `${codeHostLabel(provider)} is offline and no cached repository summary is available.`
    );
  }

  const data = {
    repoId: params.repoId,
    branch: params.branch,
    activeFile: params.file,
    treeStructure: { status: "tree-structure-requested", provider },
    ownership: { status: "ownership-summary-requested" },
    architecture: { status: "architecture-summary-requested" },
    fallbackLevel: context.status.level
  };
  await context.cache.set(key, data, { provider, feature: "repo_summary" });
  return contextResult(context, data, context.status.message, context.status.level !== "full");
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
