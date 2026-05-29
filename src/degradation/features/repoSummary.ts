import { degradationCacheKey } from "../../cache/degradationCache";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function repoSummary(context: FeatureExecutionContext) {
  const params = context.request.params;
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
        "GitHub offline. Showing cached repository summary.",
        true
      );
    }
    return unavailableResult(context, "GitHub is offline and no cached repository summary is available.");
  }

  const data = {
    repoId: params.repoId,
    branch: params.branch,
    activeFile: params.file,
    treeStructure: { status: "tree-structure-requested", provider: "github" },
    ownership: { status: "ownership-summary-requested" },
    architecture: { status: "architecture-summary-requested" },
    fallbackLevel: context.status.level
  };
  await context.cache.set(key, data, { provider: "github", feature: "repo_summary" });
  return contextResult(context, data, context.status.message, context.status.level !== "full");
}
