import { decisionTimelineFromBundle } from "../context/contextBundleEvidence";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  decisionSourceLabelCommit,
  listDecisionSourcesChecklist
} from "./decisionSourceLabels";

export function asksAboutAlternativesOrTradeoffs(question: string | undefined): boolean {
  if (!question?.trim()) {
    return false;
  }
  return /\b(trade-?offs?|alternatives?|rejected|considered options?|what else was)\b/i.test(question);
}

export function timelineHasDiscussionEvidence(timeline: DecisionTimeline): boolean {
  return (
    Boolean(timeline.linkedPR) ||
    Boolean(timeline.slackThread) ||
    Boolean(timeline.teamsThread) ||
    (timeline.jiraTickets?.length ?? 0) > 0 ||
    timeline.alternatives.length > 0
  );
}

const SPECULATIVE_TRADEOFF_PATTERNS = [
  /\bwe can infer\b/i,
  /\bcommon practices\b/i,
  /\bbased on typical\b/i,
  /\bmay have been\b/i,
  /\blikely (chosen|favored)\b/i,
  /\bperformance vs\b/i,
  /\brobustness vs\b/i,
  /\bsimplicity vs\b/i,
  /\bcomplexity vs\b/i,
  /\bcustom (code|implementation) vs\b/i,
  /\bimplementation vs\b/i,
  /\bremain speculative\b/i,
  /\bcommonly weighed\b/i,
  /\bpotential trade-?offs\b/i
];

export function responseHasSpeculativeTradeoffs(content: string): boolean {
  return SPECULATIVE_TRADEOFF_PATTERNS.some((pattern) => pattern.test(content));
}

/** Compact, evidence-honest answer when only an introducing commit is available. */
export function buildThinAlternativesTradeOffsResponse(
  timeline: DecisionTimeline,
  file: string
): string {
  const warningNote = timeline.warnings.find((warning) => /no linked pull request/i.test(warning));
  const commitLabel = timeline.originalCommit
    ? decisionSourceLabelCommit(timeline.originalCommit.sha)
    : undefined;

  const lines = [
    "**Summary**",
    `Evidence is **limited** — only the introducing commit for \`${file}\` is attached.`,
    "",
    "**Alternatives considered**",
    warningNote
      ? `Unknown — not recorded in attached sources (${warningNote})`
      : "Unknown — not recorded in attached sources.",
    "",
    "**Trade-offs**",
    "Not documented in the available sources."
  ];

  const checklist = listDecisionSourcesChecklist(timeline);
  if (checklist.length) {
    lines.push("", "**Sources**");
    for (const item of checklist) {
      if (commitLabel && item.startsWith(commitLabel)) {
        lines.push(`- ${commitLabel} — original introduction; does not record rejected alternatives or trade-offs.`);
      } else {
        lines.push(`- ${item}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Replaces speculative trade-off filler with a short evidence-bound answer when the
 * timeline lacks PR/discussion metadata.
 */
export function enrichTraceDecisionResponse(options: {
  content: string;
  userQuestion?: string;
  contextBundle?: unknown;
  activeFile?: string;
  fallbackTimeline?: DecisionTimeline;
  /** When true, user sent a chat follow-up in an inherited trace-decision thread. */
  isFollowUp?: boolean;
}): string {
  const bundle = Array.isArray(options.contextBundle) ? options.contextBundle : [];
  const timeline = decisionTimelineFromBundle(bundle) ?? options.fallbackTimeline;
  if (!timeline) {
    return options.content;
  }

  const thin = !timelineHasDiscussionEvidence(timeline);
  if (!thin) {
    return options.content;
  }

  const asksAlternatives = asksAboutAlternativesOrTradeoffs(options.userQuestion);
  const speculative = responseHasSpeculativeTradeoffs(options.content);

  if (asksAlternatives || speculative) {
    return buildThinAlternativesTradeOffsResponse(
      timeline,
      options.activeFile?.trim() || timeline.file
    );
  }

  return options.content;
}
