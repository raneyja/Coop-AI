import { degradationCacheKey } from "../../cache/degradationCache";
import type { CodeHostProvider } from "../../api/codeHosts/types";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function blastRadius(context: FeatureExecutionContext) {
  const params = context.request.params;
  const provider = resolveCodeHostProvider(params);
  const key = degradationCacheKey("blast", [params.repoId, params.file]);

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
        `${codeHostLabel(provider)} offline; showing cached impact analysis.`,
        true
      );
    }
    return unavailableResult(
      context,
      `${codeHostLabel(provider)} is offline and no cached blast radius data is available.`
    );
  }

  const codeHostHealth = context.health.find((entry) => entry.provider === provider);
  const directOnly = context.status.level === "partial" || (codeHostHealth?.latency ?? 0) > 5_000;
  const data = {
    file: params.file,
    dependencyGraph: {
      status: directOnly ? "direct-dependencies-only" : "full-dependency-graph-requested"
    },
    includeTransitive: !directOnly,
    fallbackLevel: directOnly ? "partial" : context.status.level
  };
  await context.cache.set(key, data, { provider, feature: "blast_radius" });
  return contextResult(
    context,
    data,
    directOnly ? `${codeHostLabel(provider)} is slow. Showing direct impact only.` : context.status.message,
    directOnly
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
