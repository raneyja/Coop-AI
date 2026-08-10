import type {
  DecisionRationaleRank,
  DecisionTimeline
} from "../types/decisionTimeline";
import { isHighSignalCommitMessage } from "./decisionFocusCommit";

export type RationaleRankingGrounding = {
  prRelevantToTarget: boolean;
  focusTerms: string[];
  focusCommitScore: number;
  /** Mega / drive-by focus that must not become sole rationale. */
  focusIsMegaDriveBy?: boolean;
  /** ask/file alignment quality for the selected focus commit. */
  focusDecisionQuality?: "aligned" | "weak" | "unknown";
};

/**
 * Roles: rationale > provenance > background.
 *
 * Gate (Z3 / Phase A): under a concrete ask, high-signal-only commits and mega
 * drive-bys cannot be the sole rationale. Prefer honesty (no false primary)
 * over promoting an unrelated session-auth mega-PR.
 */
export function buildRationaleRanking(
  timeline: DecisionTimeline,
  hasHighSignalFocusCommitMessage: boolean,
  grounding?: RationaleRankingGrounding
): DecisionRationaleRank[] {
  const ranking: DecisionRationaleRank[] = [];
  const prRelevant = grounding?.prRelevantToTarget ?? true;
  const focusCommitScore = grounding?.focusCommitScore ?? 0;
  const focusTerms = grounding?.focusTerms ?? [];
  const concreteAsk = focusTerms.length > 0;
  const focusIsMega = Boolean(grounding?.focusIsMegaDriveBy);
  const quality = grounding?.focusDecisionQuality ?? timeline.focusDecisionQuality;
  const qualityBlocksRationale = quality === "weak";
  const commitIsAskAligned =
    focusCommitScore > 0 && !focusIsMega && (quality === "aligned" || quality == null);

  if (timeline.linkedPR) {
    const pr = timeline.linkedPR;
    const hasDetailedPrContext =
      (pr.description?.trim().length ?? 0) >= 20 || pr.reviews.length > 0 || pr.approvers.length > 0;
    ranking.push({
      source: `pr:${pr.number}`,
      role: prRelevant && hasDetailedPrContext ? "rationale" : "provenance",
      label: prRelevant ? `PR #${pr.number}` : `PR #${pr.number} (secondary — weakly related to file)`
    });
  }

  for (const [index, ticket] of (timeline.jiraTickets ?? []).entries()) {
    ranking.push({
      source: `jira:${ticket.key}`,
      role: index === 0 ? "rationale" : "provenance",
      label: `Jira ${ticket.key}`
    });
  }

  if (timeline.slackThread) {
    const channel = timeline.slackThread.channelName ?? timeline.slackThread.channelId;
    ranking.push({
      source: `slack:${channel}`,
      role: hasSubstantiveThreadMessages(timeline.slackThread.messages.map((message) => message.text))
        ? "rationale"
        : "provenance",
      label: `Slack #${channel}`
    });
  }

  if (timeline.teamsThread) {
    ranking.push({
      source: `teams:${timeline.teamsThread.channelId}`,
      role: hasSubstantiveThreadMessages(timeline.teamsThread.messages.map((message) => message.text))
        ? "rationale"
        : "provenance",
      label: "Teams thread"
    });
  }

  const focus = timeline.focusCommit ?? timeline.originalCommit;
  const introduction = timeline.originalCommit;
  const focusIsIntroduction = Boolean(focus && introduction && focus.sha === introduction.sha);

  if (focus) {
    const existingRicherSources = ranking.some((entry) => entry.role === "rationale");
    ranking.push({
      source: `commit:${focus.sha}`,
      role: roleForFocusCommit({
        concreteAsk,
        commitIsAskAligned,
        focusCommitScore,
        focusIsMega,
        qualityBlocksRationale,
        hasHighSignalFocusCommitMessage,
        existingRicherSources
      }),
      label: focusIsIntroduction
        ? `Commit ${focus.sha.slice(0, 7)}`
        : `Recent commit ${focus.sha.slice(0, 7)}`
    });
  }

  if (introduction && !focusIsIntroduction) {
    ranking.push({
      source: `commit:${introduction.sha}`,
      role: "background",
      label: `Introduced in ${introduction.sha.slice(0, 7)}`
    });
  }

  const deduped: DecisionRationaleRank[] = [];
  const seen = new Set<string>();
  for (const entry of ranking) {
    const key = `${entry.source}|${entry.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  // Prefer file/ask-aligned commit as primary rationale when the PR was demoted.
  if (!prRelevant && focus && commitIsAskAligned) {
    const commitIdx = deduped.findIndex((entry) => entry.source === `commit:${focus.sha}`);
    const prIdx = deduped.findIndex((entry) => entry.source.startsWith("pr:"));
    if (commitIdx >= 0) {
      deduped[commitIdx] = { ...deduped[commitIdx], role: "rationale" };
    }
    if (prIdx >= 0 && deduped[prIdx].role === "rationale") {
      deduped[prIdx] = { ...deduped[prIdx], role: "provenance" };
    }
  }

  const hasRationale = deduped.some((entry) => entry.role === "rationale");
  if (!hasRationale && deduped.length > 0) {
    const first = deduped[0];
    const firstIsUnalignedFocus =
      concreteAsk &&
      focus &&
      first.source === `commit:${focus.sha}` &&
      (focusCommitScore === 0 || focusIsMega || qualityBlocksRationale);
    // Fail closed for Z3: do not invent a primary rationale from the wrong mega touch.
    if (!firstIsUnalignedFocus) {
      deduped[0] = { ...first, role: "rationale" };
    }
  }

  return deduped;
}

function roleForFocusCommit(options: {
  concreteAsk: boolean;
  commitIsAskAligned: boolean;
  focusCommitScore: number;
  focusIsMega: boolean;
  qualityBlocksRationale: boolean;
  hasHighSignalFocusCommitMessage: boolean;
  existingRicherSources: boolean;
}): DecisionRationaleRank["role"] {
  const {
    concreteAsk,
    commitIsAskAligned,
    focusCommitScore,
    focusIsMega,
    qualityBlocksRationale,
    hasHighSignalFocusCommitMessage,
    existingRicherSources
  } = options;

  if (
    focusIsMega ||
    qualityBlocksRationale ||
    (concreteAsk && (focusCommitScore === 0 || !commitIsAskAligned))
  ) {
    return existingRicherSources ? "background" : "provenance";
  }

  if (commitIsAskAligned) {
    return "rationale";
  }

  // No concrete ask: preserve prior high-signal promotion behavior.
  if (!concreteAsk && hasHighSignalFocusCommitMessage) {
    return existingRicherSources ? "provenance" : "rationale";
  }

  return existingRicherSources ? "background" : "provenance";
}

function hasSubstantiveThreadMessages(messages: string[]): boolean {
  return messages.some((message) => message.replace(/\s+/g, " ").trim().length >= 80);
}

/** Convenience for callers that still pass a boolean high-signal flag from the message. */
export function focusMessageIsHighSignal(message: string | undefined): boolean {
  return Boolean(message && isHighSignalCommitMessage(message));
}
