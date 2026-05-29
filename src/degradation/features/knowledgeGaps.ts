import { degradationCacheKey } from "../../cache/degradationCache";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

const DOC_PROVIDERS = ["confluence", "notion", "google-docs"];

export async function knowledgeGaps(context: FeatureExecutionContext) {
  const params = context.request.params;
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
        "GitHub offline. Showing cached knowledge-gap analysis.",
        true
      );
    }
    return unavailableResult(context, "GitHub is offline and file structure is required for knowledge-gap analysis.");
  }

  const docsOffline = context.status.unavailableProviders.some((provider) => DOC_PROVIDERS.includes(provider));
  const data = {
    file: params.file,
    fileStructure: { status: "file-structure-requested", provider: "github" },
    documentationCoverage: docsOffline ? null : { status: "documentation-search-requested" },
    orphanedFilesOnly: docsOffline,
    fallbackLevel: docsOffline ? "partial" : context.status.level
  };
  await context.cache.set(key, data, { provider: "github", feature: "knowledge_gaps" });
  return contextResult(
    context,
    data,
    docsOffline ? "Documentation systems offline. Showing orphaned files only." : context.status.message,
    docsOffline || context.status.level !== "full"
  );
}
