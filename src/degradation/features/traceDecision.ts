import { toRepositoryRelativePath } from "../../context/repoFilePath";
import { degradationCacheKey } from "../../cache/degradationCache";
import type { DecisionTimeline } from "../../types/decisionTimeline";
import { getDecisionArchaeologyEngine } from "../../engines/decisionArchaeologyRegistry";
import type { CodeHostProvider } from "../../api/codeHosts/types";
import { coordinatesFromRepoId } from "../../api/codeHosts/types";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function traceDecision(context: FeatureExecutionContext) {
  const params = context.request.params;
  const codeHost = resolveCodeHostContext(params);
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
        `${codeHostLabel(codeHost?.provider)} offline. Showing cached decision history.`,
        true
      );
    }
    return unavailableResult(
      context,
      `${codeHostLabel(codeHost?.provider)} is offline and no cached decision history is available.`
    );
  }

  const engine = getDecisionArchaeologyEngine();
  const file = params.file ? toRepositoryRelativePath(params.file) : undefined;
  const fileSource = params.fileSource as string | undefined;

  if (fileSource === "external" || (!file && params.file)) {
    return contextResult(
      context,
      placeholderDecisionData(params, codeHost?.provider, context.status.level, "Active file is not in the workspace or a git repo."),
      "Open the project with File → Open Folder (the repo root), or use the remote file tree in chat.",
      false
    );
  }

  if (engine && codeHost && file) {
    try {
      const timeline = await engine.traceDecision({
        provider: codeHost.provider,
        owner: codeHost.owner,
        repo: codeHost.repo,
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
        targetLabel: timeline.targetLabel,
        commitHistory: timeline.originalCommit ?? null,
        introducingDiffSummary: timeline.introducingDiffSummary,
        evolution: timeline.evolution,
        rationaleRanking: timeline.rationaleRanking ?? [],
        linkedPR: timeline.linkedPR ?? null,
        slackContext: timeline.slackThread ?? null,
        jiraContext: timeline.jiraTickets?.[0] ?? null,
        teamsContext: timeline.teamsThread ?? null,
        alternatives: timeline.alternatives,
        chronology: timeline.chronology,
        warnings: timeline.warnings,
        completeness: timeline.completeness,
        fallbackLevel: context.status.level,
        partial: context.status.level !== "full" || timeline.completeness !== "full",
        slackDecision: timeline.slackThread?.messages[0]?.text,
        slackLastUpdated: timeline.slackThread?.messages[0]?.ts
          ? new Date(Number(timeline.slackThread.messages[0].ts) * 1000)
          : undefined,
        teamsDecision: timeline.teamsThread?.messages[0]?.text,
        teamsLastUpdated: timeline.teamsThread?.messages[0]?.createdAt
          ? new Date(timeline.teamsThread.messages[0].createdAt)
          : undefined,
        prDecision: timeline.linkedPR?.title,
        prLastUpdated: timeline.linkedPR?.updatedAt ? new Date(timeline.linkedPR.updatedAt) : undefined,
        codePattern: timeline.codeSnippet?.slice(0, 240) ?? timeline.originalCommit?.message,
        codeLastModified: timeline.originalCommit?.date ? new Date(timeline.originalCommit.date) : undefined
      };

      await context.cache.set(key, data, { provider: codeHost.provider, feature: "trace_why" });
      return contextResult(context, data, timelineSummaryMessage(timeline), false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Decision trace failed.";
      return contextResult(
        context,
        placeholderDecisionData(params, codeHost.provider, context.status.level, message),
        message,
        false
      );
    }
  }

  const slackOffline = context.status.unavailableProviders.includes("slack");
  const jiraOffline = context.status.unavailableProviders.includes("jira");
  const data = placeholderDecisionData(params, codeHost?.provider, context.status.level);
  data.slackContext = slackOffline ? null : { status: "slack-thread-search-requested" };
  data.jiraContext = jiraOffline ? null : { status: "ticket-lookup-requested" };

  await context.cache.set(key, data, { provider: codeHost?.provider ?? "github", feature: "trace_why" });
  const skipped = [
    !engine ? "Decision engine not initialized" : undefined,
    !codeHost ? "Repository not configured" : undefined,
    !file ? "No file in context" : undefined,
    slackOffline ? "Slack offline" : undefined,
    jiraOffline ? "Jira offline" : undefined
  ]
    .filter(Boolean)
    .join(". ");

  return contextResult(context, data, skipped || context.status.message, false);
}

function resolveCodeHostContext(params: {
  owner?: string;
  repo?: string;
  repoId?: string;
  provider?: string;
}): { owner: string; repo: string; provider: CodeHostProvider } | undefined {
  if (params.repoId) {
    const fromId = coordinatesFromRepoId(
      params.repoId.includes(":") ? params.repoId : `github:${params.repoId}`
    );
    if (fromId) {
      return { owner: fromId.owner, repo: fromId.repo, provider: fromId.provider };
    }
    const slash = params.repoId.split("/");
    if (slash.length === 2) {
      return { owner: slash[0], repo: slash[1], provider: "github" };
    }
  }
  if (params.owner && params.repo) {
    const provider = normalizeCodeHostProvider(params.provider);
    return { owner: params.owner, repo: params.repo, provider };
  }
  return undefined;
}

function normalizeCodeHostProvider(value?: string): CodeHostProvider {
  if (value === "gitlab" || value === "bitbucket" || value === "github") {
    return value;
  }
  return "github";
}

function codeHostLabel(provider?: CodeHostProvider): string {
  if (provider === "gitlab") {
    return "GitLab";
  }
  if (provider === "bitbucket") {
    return "Bitbucket";
  }
  return "GitHub";
}

function placeholderDecisionData(
  params: { file?: string; lines?: { start: number; end: number } },
  provider: CodeHostProvider | undefined,
  level: string,
  error?: string
): Record<string, unknown> {
  return {
    file: params.file,
    lines: params.lines,
    commitHistory: { status: "decision-history-requested", provider: provider ?? "github" },
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
  for (const ticket of timeline.jiraTickets ?? []) {
    parts.push(ticket.key);
  }
  if (timeline.slackThread) {
    parts.push("Slack thread linked");
  }
  if (timeline.warnings.length > 0) {
    parts.push(`${timeline.warnings.length} warning(s)`);
  }
  return parts.length > 0 ? `Traced decision: ${parts.join(" · ")}` : "Decision trace complete with limited evidence.";
}
