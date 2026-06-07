import { degradationCacheKey } from "../../cache/degradationCache";
import type { CodeHostProvider } from "../../api/codeHosts/types";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { getRepoSummaryLoader } from "../../context/repoSummaryRegistry";
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

  const loader = getRepoSummaryLoader();
  if (loader) {
    try {
      const live = await loader(context);
      if (live) {
        const data = {
          ...live,
          fallbackLevel: context.status.level,
          partial: context.status.level !== "full"
        };
        await context.cache.set(key, data, { provider, feature: "repo_summary" });
        return contextResult(context, data, summaryMessage(data, context.status.message), context.status.level !== "full");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repository summary failed.";
      return unavailableResult(context, message);
    }
  }

  return unavailableResult(
    context,
    `${codeHostLabel(provider)} repository summary is unavailable. Connect your code host and try again.`
  );
}

function summaryMessage(data: Record<string, unknown>, fallback: string): string {
  const fileCount = typeof data.manifest === "object" && data.manifest !== null
    ? (data.manifest as { fileCount?: number }).fileCount
    : undefined;
  const entryFiles = Array.isArray(data.entryFiles) ? data.entryFiles.length : 0;
  if (fileCount && fileCount > 0) {
    return `Live repository summary (${fileCount} indexed files, ${entryFiles} entry files).`;
  }
  if (entryFiles > 0) {
    return `Live repository summary (${entryFiles} entry files from ${String(data.source ?? "code host")}).`;
  }
  return fallback;
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
