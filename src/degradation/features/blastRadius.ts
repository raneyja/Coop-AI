import { toRepositoryRelativePath } from "../../context/repoFilePath";
import { looksLikeAbsoluteDiskPath } from "../../context/outsideWorkspaceFile";
import { degradationCacheKey } from "../../cache/degradationCache";
import type { CodeHostProvider } from "../../api/codeHosts/types";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { remainingContextGatherBudgetMs } from "../../config/responseDeadline";
import { getBlastRadiusAnalysisEngine } from "../../engines/blastRadiusAnalysisRegistry";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

/** Soft gather is silent — partial evidence only; never a user-facing banner message. */
function softGatherPartialBlastResult(
  context: FeatureExecutionContext,
  params: FeatureExecutionContext["request"]["params"],
  directOnly: boolean
) {
  return contextResult(
    context,
    placeholderBlastRadiusData(params, directOnly),
    undefined,
    false
  );
}

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
    // Zero-Clone: never fall back to local workspace disk.
    return unavailableResult(
      context,
      `${codeHostLabel(provider)} is offline and no cached blast radius data is available.`
    );
  }

  const codeHost = resolveCodeHostContext(params);
  const file = params.file ? toRepositoryRelativePath(params.file) : undefined;
  const fileSource = params.fileSource as string | undefined;
  const directOnly = context.status.level === "partial";
  const engine = getBlastRadiusAnalysisEngine();

  if (
    fileSource === "external" ||
    looksLikeAbsoluteDiskPath(params.file) ||
    looksLikeAbsoluteDiskPath(file) ||
    (!file && params.file)
  ) {
    return contextResult(
      context,
      placeholderBlastRadiusData(
        params,
        directOnly,
        "Active file is not in the workspace or a git repo."
      ),
      "Open the project with File → Open Folder (the repo root), or use the remote file tree in chat.",
      false
    );
  }

  if (engine && codeHost && file) {
    // Soft gather only (responseDeadline.ts): cap analyzeImpact to remaining budget,
    // then return partial evidence so synthesis still runs — never hang / never timeout bubble.
    const gatherStartedAt =
      typeof params.gatherStartedAt === "number" && Number.isFinite(params.gatherStartedAt)
        ? params.gatherStartedAt
        : Date.now();
    const budgetMs = remainingContextGatherBudgetMs(gatherStartedAt);
    if (budgetMs <= 0) {
      return softGatherPartialBlastResult(context, params, directOnly);
    }

    try {
      const report = await Promise.race([
        engine.analyzeImpact({
          provider: codeHost.provider,
          owner: codeHost.owner,
          repo: codeHost.repo,
          file,
          branch: params.branch,
          includeTransitive: !directOnly,
          gatherStartedAt,
          askText: context.request.intent?.context?.queryText,
          selectedSymbol: context.request.intent?.context?.selectedSymbol
        }),
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), budgetMs);
        })
      ]);

      if (!report) {
        return softGatherPartialBlastResult(context, params, directOnly);
      }

      const data = {
        file,
        report,
        directDependents: report.directDependents,
        transitiveDependents: report.transitiveDependents,
        dependentDetails: report.dependentDetails,
        docsReferences: report.docsReferences,
        openPullRequests: report.openPullRequests,
        recentChanges: report.recentChanges,
        testFiles: report.testFiles,
        publicExports: report.publicExports,
        ciWorkflows: report.ciWorkflows,
        crossRepoConsumers: report.crossRepoConsumers,
        ownersByFile: report.ownersByFile,
        slackSearch: report.slackSearch,
        graphMeta: report.graphMeta,
        includeTransitive: report.includeTransitive,
        warnings: report.warnings,
        completeness: report.completeness,
        namedAskSymbols: report.namedAskSymbols,
        fallbackLevel: directOnly ? "partial" : context.status.level,
        partial: directOnly || report.completeness !== "full"
      };

      await context.cache.set(key, data, { provider: codeHost.provider, feature: "blast_radius" });
      return contextResult(
        context,
        data,
        blastRadiusSummaryMessage(report),
        directOnly || report.completeness === "minimal"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blast radius analysis failed.";
      return contextResult(
        context,
        placeholderBlastRadiusData(params, directOnly, message),
        message,
        false
      );
    }
  }

  const data = placeholderBlastRadiusData(params, directOnly);
  await context.cache.set(key, data, { provider, feature: "blast_radius" });
  return contextResult(
    context,
    data,
    directOnly ? `${codeHostLabel(provider)} is slow. Showing direct impact only.` : context.status.message,
    directOnly
  );
}

function blastRadiusSummaryMessage(report: {
  directDependents: string[];
  transitiveDependents: string[];
  openPullRequests: unknown[];
}): string {
  const parts = [`${report.directDependents.length} direct dependent(s)`];
  if (report.transitiveDependents.length > 0) {
    parts.push(`${report.transitiveDependents.length} transitive`);
  }
  if (report.openPullRequests.length > 0) {
    parts.push(`${report.openPullRequests.length} open PR(s)`);
  }
  return parts.join(" · ");
}

function placeholderBlastRadiusData(
  params: FeatureExecutionContext["request"]["params"],
  directOnly: boolean,
  error?: string
): Record<string, unknown> {
  return {
    file: params.file,
    directDependents: [],
    transitiveDependents: [],
    openPullRequests: [],
    ownersByFile: [],
    includeTransitive: !directOnly,
    warnings: error ? [error] : ["Blast radius engine unavailable."],
    completeness: "minimal",
    fallbackLevel: directOnly ? "partial" : "minimal"
  };
}

function resolveCodeHostContext(params: { repoId?: string; provider?: string }):
  | { provider: CodeHostProvider; owner: string; repo: string }
  | undefined {
  if (params.repoId) {
    const coords = coordinatesFromRepoId(
      params.repoId.includes(":") ? params.repoId : `github:${params.repoId}`
    );
    if (coords) {
      return coords;
    }
  }
  const slash = params.repoId?.split("/");
  if (slash && slash.length === 2) {
    return {
      provider: (params.provider as CodeHostProvider) ?? "github",
      owner: slash[0],
      repo: slash[1]
    };
  }
  return undefined;
}

function resolveCodeHostProvider(params: { repoId?: string; provider?: string }): CodeHostProvider {
  return resolveCodeHostContext(params)?.provider ?? "github";
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

