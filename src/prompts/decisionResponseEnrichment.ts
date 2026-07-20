import { decisionTimelineFromBundle } from "../context/contextBundleEvidence";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelJira,
  decisionSourceLabelSlack,
  listDecisionSourcesChecklist
} from "./decisionSourceLabels";
import { stripDisallowedNarrativeSourceCitations } from "./evidenceSynthesis";

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

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSectionBody(content: string, heading: string): string | undefined {
  const pattern = new RegExp(
    `\\n\\*\\*${escapeRegExp(heading)}\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[^*]|$)`,
    "i"
  );
  const match = pattern.exec(content);
  return match?.[1]?.trim();
}

function replaceSectionBody(content: string, heading: string, body: string): string {
  const pattern = new RegExp(
    `(\\n\\*\\*${escapeRegExp(heading)}\\*\\*\\s*\\n)([\\s\\S]*?)(?=\\n\\*\\*[^*]|$)`,
    "i"
  );
  if (!pattern.test(content)) {
    return `${content.trimEnd()}\n\n**${heading}**\n${body}`;
  }
  return content.replace(pattern, `$1${body.trim()}\n`);
}

function discussionGroundingTokens(timeline: DecisionTimeline): string[] {
  const tokens: string[] = [];
  if (timeline.slackThread) {
    const channel = timeline.slackThread.channelName ?? timeline.slackThread.channelId;
    tokens.push(channel, `#${channel.replace(/^#/, "")}`);
    for (const message of timeline.slackThread.messages) {
      tokens.push(message.user);
    }
  }
  for (const ticket of timeline.jiraTickets ?? []) {
    tokens.push(ticket.key);
  }
  for (const alt of timeline.alternatives) {
    tokens.push(alt.option);
  }
  if (timeline.linkedPR) {
    tokens.push(`PR #${timeline.linkedPR.number}`, `#${timeline.linkedPR.number}`);
  }
  return tokens.filter(Boolean);
}

/** True when discussion exists but Alternatives / Trade-offs sections lack quotes or source anchors. */
export function alternativesSectionsLackGrounding(content: string, timeline: DecisionTimeline): boolean {
  const alternatives = extractSectionBody(content, "Alternatives considered");
  const tradeoffs = extractSectionBody(content, "Trade-offs");
  const combined = `${alternatives ?? ""}\n${tradeoffs ?? ""}`.trim();
  if (!combined) {
    return true;
  }
  if (/["“][^"”]{8,}["”]/.test(combined)) {
    return false;
  }
  const tokens = discussionGroundingTokens(timeline);
  if (tokens.some((token) => combined.includes(token))) {
    return false;
  }
  return responseHasSpeculativeTradeoffs(combined) || /\b(inferred|likely|may have|typical|common practice)\b/i.test(combined);
}

function slackDecisionExcerpts(timeline: DecisionTimeline): string[] {
  const thread = timeline.slackThread;
  if (!thread) {
    return [];
  }
  const label = decisionSourceLabelSlack(thread.channelName ?? thread.channelId);
  return thread.messages
    .filter((message) =>
      /\b(alternative|rejected|trade-?off|instead|chose|decided|vs\.?|rather than|went with)\b/i.test(
        message.text
      )
    )
    .slice(0, 3)
    .map((message) => `- @${message.user}: "${truncate(message.text, 220)}" (${label})`);
}

function jiraDecisionExcerpts(timeline: DecisionTimeline): string[] {
  const lines: string[] = [];
  for (const ticket of timeline.jiraTickets ?? []) {
    const label = decisionSourceLabelJira(ticket.key);
    const haystack = `${ticket.summary}\n${ticket.description}\n${ticket.acceptanceCriteria.join("\n")}`;
    if (!/\b(alternative|rejected|trade-?off|decision|chose|instead)\b/i.test(haystack)) {
      continue;
    }
    const excerpt = truncate(ticket.description || ticket.summary, 220);
    lines.push(`- ${ticket.key}: "${excerpt}" (${label})`);
  }
  return lines.slice(0, 3);
}

/** Quote-grounded Alternatives / Trade-offs built only from attached discussion sources. */
export function buildGroundedAlternativesTradeOffsSections(timeline: DecisionTimeline): {
  alternatives: string;
  tradeoffs: string;
} {
  const alternativeLines: string[] = [];
  for (const alt of timeline.alternatives) {
    alternativeLines.push(
      `- **${alt.option}** — rejected because ${alt.reason_rejected} (proposed by ${alt.proposed_by}; ${alt.source})`
    );
  }
  alternativeLines.push(...slackDecisionExcerpts(timeline));
  alternativeLines.push(...jiraDecisionExcerpts(timeline));

  const alternatives =
    alternativeLines.length > 0
      ? alternativeLines.join("\n")
      : "Not explicitly recorded in attached Slack/Jira excerpts — see **Sources** for linked threads and tickets.";

  const tradeoffLines = [
    ...slackDecisionExcerpts(timeline).filter((line) => /\btrade-?off|vs\.?|instead\b/i.test(line)),
    ...jiraDecisionExcerpts(timeline).filter((line) => /\btrade-?off|vs\.?|instead\b/i.test(line))
  ];
  const tradeoffs =
    tradeoffLines.length > 0
      ? [...new Set(tradeoffLines)].join("\n")
      : alternativeLines.length > 0
        ? "See quoted discussion excerpts above — trade-offs are implied in those messages, not listed separately."
        : "Not documented in the available Slack/Jira excerpts.";

  return { alternatives, tradeoffs };
}

export function injectGroundedAlternativesSections(content: string, timeline: DecisionTimeline): string {
  const { alternatives, tradeoffs } = buildGroundedAlternativesTradeOffsSections(timeline);
  let result = replaceSectionBody(content, "Alternatives considered", alternatives);
  result = replaceSectionBody(result, "Trade-offs", tradeoffs);
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function shouldReplaceWithGroundedAlternatives(
  content: string,
  timeline: DecisionTimeline,
  userQuestion?: string
): boolean {
  if (!timelineHasDiscussionEvidence(timeline)) {
    return false;
  }
  if (responseHasSpeculativeTradeoffs(content)) {
    return true;
  }
  if (asksAboutAlternativesOrTradeoffs(userQuestion) && alternativesSectionsLackGrounding(content, timeline)) {
    return true;
  }
  return alternativesSectionsLackGrounding(content, timeline);
}

/** Compact, evidence-honest answer when only an introducing commit is available. */
export function buildThinAlternativesTradeOffsResponse(
  timeline: DecisionTimeline,
  file: string,
  options?: { includeUnknownSections?: boolean }
): string {
  const warningNote = timeline.warnings.find((warning) => /no linked pull request/i.test(warning));
  const commitLabel = timeline.originalCommit
    ? decisionSourceLabelCommit(timeline.originalCommit.sha)
    : undefined;
  const includeUnknown = options?.includeUnknownSections !== false;

  const lines = [
    "**Summary**",
    `Evidence is **limited** — only the introducing commit for \`${file}\` is attached.`,
    ""
  ];

  if (includeUnknown) {
    lines.push(
      "**Alternatives considered**",
      warningNote
        ? `Unknown — not recorded (${warningNote}).`
        : "Unknown — not recorded in attached sources.",
      "",
      "**Trade-offs**",
      "Not documented in the available sources.",
      ""
    );
  }

  const checklist = listDecisionSourcesChecklist(timeline);
  if (checklist.length) {
    lines.push("**Sources**");
    for (const item of checklist) {
      if (commitLabel && item.startsWith(commitLabel)) {
        lines.push(`- ${commitLabel} — original introduction; does not record rejected alternatives or trade-offs.`);
      } else {
        lines.push(`- ${item}`);
      }
    }
  }

  return lines.join("\n").trim();
}

/**
 * Removes speculative Alternatives / Trade-offs filler when the timeline has no discussion,
 * keeping Summary / Technical decision / Sources intact when present.
 */
export function stripSpeculativeAlternativesTradeOffs(content: string): string {
  let result = content;
  for (const heading of ["Alternatives considered", "Trade-offs"]) {
    const pattern = new RegExp(
      `\\n\\*\\*${escapeRegExp(heading)}\\*\\*\\s*\\n[\\s\\S]*?(?=\\n\\*\\*[^*]|$)`,
      "i"
    );
    result = result.replace(pattern, "\n");
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
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

  if (thin) {
    const asksAlternatives = asksAboutAlternativesOrTradeoffs(options.userQuestion);
    const speculative = responseHasSpeculativeTradeoffs(options.content);

    if (asksAlternatives) {
      return stripDisallowedNarrativeSourceCitations(
        buildThinAlternativesTradeOffsResponse(
          timeline,
          options.activeFile?.trim() || timeline.file,
          { includeUnknownSections: true }
        )
      );
    }
    if (speculative) {
      const stripped = stripSpeculativeAlternativesTradeOffs(options.content);
      // If stripping left almost nothing useful, fall back to a compact honest stub.
      const hasLead =
        /\*\*(Summary|Technical decision)\*\*/i.test(stripped) &&
        stripped.replace(/\*\*[^*]+\*\*/g, "").trim().length >= 12;
      if (!hasLead) {
        return stripDisallowedNarrativeSourceCitations(
          buildThinAlternativesTradeOffsResponse(
            timeline,
            options.activeFile?.trim() || timeline.file,
            { includeUnknownSections: false }
          )
        );
      }
      return stripDisallowedNarrativeSourceCitations(stripped);
    }
  } else if (shouldReplaceWithGroundedAlternatives(options.content, timeline, options.userQuestion)) {
    return stripDisallowedNarrativeSourceCitations(
      injectGroundedAlternativesSections(options.content, timeline)
    );
  }

  return stripDisallowedNarrativeSourceCitations(options.content);
}
