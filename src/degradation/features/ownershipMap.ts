import { toRepositoryRelativePath } from "../../context/repoFilePath";
import { REPO_OWNERSHIP_PATH } from "../../context/quickActionScope";
import { degradationCacheKey } from "../../cache/degradationCache";
import { resolveRepoCoordinates } from "../../api/codeHosts/types";
import { evidenceCodeHostDisplayName } from "../../api/codeHosts/codeHostLabels";
import { getOwnershipGraphEngine } from "../../engines/ownershipGraphRegistry";
import type { OwnershipReport } from "../../types/ownership";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function ownershipMap(context: FeatureExecutionContext) {
  const params = context.request.params;
  const codeHost = resolveRepoCoordinates(params);
  const repoWide = !params.file?.trim();
  const file = repoWide ? REPO_OWNERSHIP_PATH : toRepositoryRelativePath(params.file!);
  const key = degradationCacheKey("ownership", [params.repoId, repoWide ? "__repo__" : params.file]);

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
        `${evidenceCodeHostDisplayName(codeHost?.provider)} offline. Showing cached ownership.`,
        true
      );
    }
    if (context.status.level === "unavailable") {
      return unavailableResult(
        context,
        `${evidenceCodeHostDisplayName(codeHost?.provider)} is offline and no cached ownership data is available.`
      );
    }
  }

  const engine = getOwnershipGraphEngine();
  const analysisPath = repoWide ? "" : toRepositoryRelativePath(params.file!);

  if (engine && codeHost && (repoWide || analysisPath)) {
    try {
      const report = await engine.mapOwnership({
        provider: codeHost.provider,
        owner: codeHost.owner,
        repo: codeHost.repo,
        path: analysisPath,
        branch: params.branch,
        isDirectory: repoWide || analysisPath.endsWith("/")
      });

      const displayPath = repoWide ? REPO_OWNERSHIP_PATH : report.path;
      const normalizedReport = repoWide ? { ...report, path: displayPath } : report;

      const primary = normalizedReport.scores.find((s) => s.tier === "primary") ?? normalizedReport.scores[0];
      const topIssue = normalizedReport.signals?.issues?.[0];
      const data = {
        file: displayPath,
        report: normalizedReport,
        owner: primary?.owner ?? "unknown",
        likelyOwner: primary?.owner ?? "unknown",
        githubOwner: primary?.owner,
        confidence: primary ? primary.score / 100 : 0.25,
        recentCommits: primary?.commitCount ?? 0,
        reviewApprovals: primary?.reviewApprovals ?? 0,
        slackStatus: primary?.presence ?? null,
        jiraAssignee: topIssue?.author,
        jiraLastUpdated: topIssue?.lastActivityDate ? new Date(topIssue.lastActivityDate) : undefined,
        jiraTicket: topIssue ? `${normalizedReport.owner}/${normalizedReport.repo}` : undefined,
        risk: normalizedReport.risk,
        teamGraph: normalizedReport.teamGraph,
        orgContext: normalizedReport.orgContext,
        history: normalizedReport.history,
        messageDraft: normalizedReport.messageDraft,
        warnings: normalizedReport.warnings,
        completeness: normalizedReport.completeness,
        fallbackLevel: context.status.level,
        partial: context.status.level !== "full" || normalizedReport.completeness !== "full"
      };

      await context.cache.set(key, data, { provider: codeHost.provider, feature: "ownership_map" });
      return contextResult(context, data, ownershipSummaryMessage(normalizedReport), context.status.level !== "full");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ownership analysis failed.";
      return contextResult(context, placeholderOwnershipData(params, context.status.level, message), message, false);
    }
  }

  const slackOffline = context.status.unavailableProviders.includes("slack");
  const data = placeholderOwnershipData(params, context.status.level);
  data.slackStatus = slackOffline ? null : { status: "availability-requested" };
  await context.cache.set(key, data, { provider: codeHost?.provider, feature: "ownership_map" });
  const skipped = [
    !engine ? "Ownership engine not initialized" : undefined,
    !codeHost ? "Repository not configured" : undefined,
    !repoWide && !analysisPath ? "No file in context" : undefined,
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
  const parts = [`Primary: @${primary.owner}`];
  if (primary.presence) {
    parts.push(primary.presence.label);
  }
  const risks = Object.entries(report.risk).filter(([, v]) => v).length;
  if (risks > 0) {
    parts.push(`${risks} risk flag(s)`);
  }
  return parts.join(" · ");
}
