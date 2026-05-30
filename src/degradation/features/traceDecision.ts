import { toRepositoryRelativePath } from "../../context/repoFilePath";
import { degradationCacheKey } from "../../cache/degradationCache";
import type { DecisionTimeline } from "../../types/decisionTimeline";
import { getDecisionArchaeologyEngine } from "../../engines/decisionArchaeologyRegistry";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function traceDecision(context: FeatureExecutionContext) {
  const params = context.request.params;
  const key = degradationCacheKey("decision", [
    params.repoId,
    params.file,
    params.lines?.start,
    params.lines?.end
  ]);

  if (context.status.level === "cached" || context.status.level === "unavailable") {
    const cached = await context.cache.get(key);
    if (cached) {
      return contextResult(
        context,
        {
          ...(cached.data as Record<string, unknown>),
          fallbackLevel: "cached",
          cached: true,
          cacheAge: cached.cacheAge
        },
        "GitHub offline. Showing cached decision history.",
        true
      );
    }
    return unavailableResult(context, "GitHub is offline and no cached decision history is available.");
  }

  const engine = getDecisionArchaeologyEngine();
  const ownerRepo = resolveOwnerRepo(params);
  const file = params.file ? toRepositoryRelativePath(params.file) : undefined;
  const fileSource = params.fileSource as string | undefined;

  if (fileSource === "external" || (!file && params.file)) {
    return contextResult(
      context,
      placeholderDecisionData(params, context.status.level, "Active file is not in the workspace or a git repo."),
      "Open the project with File → Open Folder (the repo root), or use the remote file tree in chat.",
      false
    );
  }

  if (engine && ownerRepo && file) {
    try {
      const timeline = await engine.traceDecision({
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        file,
        lineRange: params.lines
          ? { start: params.lines.start, end: params.lines.end }
          : undefined,
        branch: params.branch
      });

      const data = {
        file,
        lines: params.lines,
        timeline,
        commitHistory: timeline.originalCommit ?? null,
        linkedPR: timeline.linkedPR ?? null,
        slackContext: timeline.slackThread ?? null,
        jiraContext: timeline.jiraTicket ?? null,
        teamsContext: timeline.teamsThread ?? null,
        alternatives: timeline.alternatives,
        chronology: timeline.chronology,
        warnings: timeline.warnings,
        completeness: timeline.completeness,
        fallbackLevel: context.status.level,
        partial: context.status.level !== "full" || timeline.completeness !== "full"
      };

      await context.cache.set(key, data, { provider: "github", feature: "trace_why" });
      return contextResult(context, data, timelineSummaryMessage(timeline), false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Decision trace failed.";
      return contextResult(
        context,
        placeholderDecisionData(params, context.status.level, message),
        message,
        false
      );
    }
  }

  const slackOffline = context.status.unavailableProviders.includes("slack");
  const jiraOffline = context.status.unavailableProviders.includes("jira");
  const data = placeholderDecisionData(params, context.status.level);
  data.slackContext = slackOffline ? null : { status: "slack-thread-search-requested" };
  data.jiraContext = jiraOffline ? null : { status: "ticket-lookup-requested" };

  await context.cache.set(key, data, { provider: "github", feature: "trace_why" });
  const skipped = [
    !engine ? "Decision engine not initialized" : undefined,
    !ownerRepo ? "Repository not configured" : undefined,
    !file ? "No file in context" : undefined,
    slackOffline ? "Slack offline" : undefined,
    jiraOffline ? "Jira offline" : undefined
  ]
    .filter(Boolean)
    .join(". ");

  return contextResult(context, data, skipped || context.status.message, false);
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

function placeholderDecisionData(
  params: { file?: string; lines?: { start: number; end: number } },
  level: string,
  error?: string
): Record<string, unknown> {
  return {
    file: params.file,
    lines: params.lines,
    commitHistory: { status: "decision-history-requested", provider: "github" },
    error,
    fallbackLevel: level
  };
}

function timelineSummaryMessage(timeline: DecisionTimeline): string {
  const parts: string[] = [];
  if (timeline.originalCommit) {
    parts.push(`introduced in ${timeline.originalCommit.sha.slice(0, 7)}`);
  }
  if (timeline.linkedPR) {
    parts.push(`PR #${timeline.linkedPR.number}`);
  }
  if (timeline.jiraTicket) {
    parts.push(timeline.jiraTicket.key);
  }
  if (timeline.slackThread) {
    parts.push("Slack thread linked");
  }
  if (timeline.warnings.length > 0) {
    parts.push(`${timeline.warnings.length} warning(s)`);
  }
  return parts.length > 0 ? `Traced decision: ${parts.join(" · ")}` : "Decision trace complete with limited evidence.";
}
