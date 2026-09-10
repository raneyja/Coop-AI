import { degradationCacheKey } from "../../cache/degradationCache";
import { resolveCodeHostProvider } from "../../api/codeHosts/types";
import { evidenceCodeHostDisplayName } from "../../api/codeHosts/codeHostLabels";
import { looksLikeAbsoluteDiskPath } from "../../context/outsideWorkspaceFile";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

const DOC_PROVIDERS = ["confluence", "notion", "google-docs"] as const;

function hasOnlineDocProvider(health: FeatureExecutionContext["health"]): boolean {
  return health.some(
    (entry) =>
      (DOC_PROVIDERS as readonly string[]).includes(entry.provider) &&
      (entry.status === "healthy" || entry.status === "degraded")
  );
}

export async function knowledgeGaps(context: FeatureExecutionContext) {
  const params = context.request.params;
  const provider = resolveCodeHostProvider(params);
  const key = degradationCacheKey("knowledge", [params.repoId, params.file]);

  if (params.fileSource === "external" || looksLikeAbsoluteDiskPath(params.file)) {
    return contextResult(
      context,
      {
        file: params.file,
        error: "Active file is not in the workspace or a git repo.",
        fallbackLevel: context.status.level
      },
      "Open the project with File → Open Folder (the repo root), or use the remote file tree in chat.",
      false
    );
  }

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
        `${evidenceCodeHostDisplayName(provider)} offline. Showing cached knowledge-gap analysis.`,
        true
      );
    }
    return unavailableResult(
      context,
      `${evidenceCodeHostDisplayName(provider)} is offline and file structure is required for knowledge-gap analysis.`
    );
  }

  const docsOffline =
    !hasOnlineDocProvider(context.health) &&
    context.status.unavailableProviders.some((entry) =>
      (DOC_PROVIDERS as readonly string[]).includes(entry)
    );
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
    docsOffline
  );
}
