import { toRepositoryRelativePath } from "../../context/repoFilePath";
import { degradationCacheKey } from "../../cache/degradationCache";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { getOwnershipGraphEngine } from "../../engines/ownershipGraphRegistry";
import type { OwnershipReport } from "../../types/ownership";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function ownershipMap(context: FeatureExecutionContext) {
  const params = context.request.params;
  const key = degradationCacheKey("ownership", [params.repoId, params.file]);

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
        "GitHub offline. Showing cached ownership.",
        true
      );
    }
    return unavailableResult(context, "GitHub is offline and no cached ownership data is available.");
  }

  const engine = getOwnershipGraphEngine();
  const ownerRepo = resolveOwnerRepo(params);
  const file = params.file ? toRepositoryRelativePath(params.file) : undefined;

  if (engine && ownerRepo && file) {
    try {
      const report = await engine.mapOwnership({
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        path: file,
        branch: params.branch,
        isDirectory: file.endsWith("/")
      });

      const primary = report.scores.find((s) => s.tier === "primary") ?? report.scores[0];
      const data = {
        file,
        report,
        owner: primary?.owner ?? "unknown",
        likelyOwner: primary?.owner ?? "unknown",
        githubOwner: primary?.owner,
        confidence: primary ? primary.score / 100 : 0.25,
        recentCommits: primary?.commitCount ?? 0,
        reviewApprovals: primary?.reviewApprovals ?? 0,
        slackStatus: primary?.presence ?? null,
        risk: report.risk,
        teamGraph: report.teamGraph,
        orgContext: report.orgContext,
        history: report.history,
        messageDraft: report.messageDraft,
        warnings: report.warnings,
        completeness: report.completeness,
        fallbackLevel: context.status.level,
        partial: context.status.level !== "full" || report.completeness !== "full"
      };

      await context.cache.set(key, data, { provider: "github", feature: "ownership_map" });
      return contextResult(context, data, ownershipSummaryMessage(report), context.status.level !== "full");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ownership analysis failed.";
      return contextResult(context, placeholderOwnershipData(params, context.status.level, message), message, false);
    }
  }

  const slackOffline = context.status.unavailableProviders.includes("slack");
  const data = placeholderOwnershipData(params, context.status.level);
  data.slackStatus = slackOffline ? null : { status: "availability-requested" };
  await context.cache.set(key, data, { provider: "github", feature: "ownership_map" });
  const skipped = [
    !engine ? "Ownership engine not initialized" : undefined,
    !ownerRepo ? "Repository not configured" : undefined,
    !file ? "No file in context" : undefined,
    slackOffline ? "Slack offline" : undefined
  ]
    .filter(Boolean)
    .join(". ");

  return contextResult(
    context,
    data,
    skipped || (slackOffline ? "Slack offline. Showing ownership without availability." : context.status.message),
    context.status.level !== "full"
  );
}

function resolveOwnerRepo(params: {
  owner?: string;
  repo?: string;
  repoId?: string;
}): { owner: string; repo: string } | undefined {
  if (params.owner && params.repo) {
    return { owner: params.owner, repo: params.repo };
  }
  if (!params.repoId) {
    return undefined;
  }
  const fromId = coordinatesFromRepoId(
    params.repoId.includes(":") ? params.repoId : `github:${params.repoId}`
  );
  if (fromId) {
    return { owner: fromId.owner, repo: fromId.repo };
  }
  const slash = params.repoId.split("/");
  if (slash.length === 2) {
    return { owner: slash[0], repo: slash[1] };
  }
  return undefined;
}

function placeholderOwnershipData(
  params: { file?: string; owner?: string },
  level: string,
  error?: string
): Record<string, unknown> {
  return {
    file: params.file,
    owner: params.owner || "unknown",
    likelyOwner: params.owner || "unknown",
    confidence: params.owner ? 0.7 : 0.25,
    error,
    fallbackLevel: level
  };
}

function ownershipSummaryMessage(report: OwnershipReport): string {
  const primary = report.scores.find((s) => s.tier === "primary") ?? report.scores[0];
  if (!primary) {
    return "Ownership analysis complete; no clear expert identified.";
  }
  const parts = [`Primary: @${primary.owner} (${primary.score} pts)`];
  if (primary.presence) {
    parts.push(primary.presence.label);
  }
  const risks = Object.entries(report.risk).filter(([, v]) => v).length;
  if (risks > 0) {
    parts.push(`${risks} risk flag(s)`);
  }
  return parts.join(" · ");
}
