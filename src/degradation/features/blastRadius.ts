import { degradationCacheKey } from "../../cache/degradationCache";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function blastRadius(context: FeatureExecutionContext) {
  const params = context.request.params;
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
        "GitHub offline; showing cached impact analysis.",
        true
      );
    }
    return unavailableResult(context, "GitHub is offline and no cached blast radius data is available.");
  }

  const githubHealth = context.health.find((entry) => entry.provider === "github");
  const directOnly = context.status.level === "partial" || (githubHealth?.latency ?? 0) > 5_000;
  const data = {
    file: params.file,
    dependencyGraph: {
      status: directOnly ? "direct-dependencies-only" : "full-dependency-graph-requested"
    },
    includeTransitive: !directOnly,
    fallbackLevel: directOnly ? "partial" : context.status.level
  };
  await context.cache.set(key, data, { provider: "github", feature: "blast_radius" });
  return contextResult(
    context,
    data,
    directOnly ? "GitHub is slow. Showing direct impact only." : context.status.message,
    directOnly
  );
}
