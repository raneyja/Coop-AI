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

const UNKNOWN_FILLER_HEADINGS = [
  "Business context",
  "Known limitations",
  "Decision status",
  "Domain experts",
  "Who to engage"
];

const DOC_REVIEW_CLAIM_HEADINGS = [
  "Notion pages reviewed",
  "Confluence pages reviewed",
  "Google Docs reviewed",
  "Related documentation"
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

function removeSection(content: string, heading: string): string {
  const pattern = new RegExp(
    `\\n\\*\\*${escapeRegExp(heading)}\\*\\*\\s*\\n[\\s\\S]*?(?=\\n\\*\\*[^*]|$)`,
    "i"
  );
  return content.replace(pattern, "\n");
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

function collectWhoToEngage(timeline: DecisionTimeline): string[] {
  const people = new Set<string>();
  if (timeline.originalCommit?.author?.trim()) {
    people.add(timeline.originalCommit.author.trim());
  }
  for (const approver of timeline.linkedPR?.approvers ?? []) {
    if (approver.trim()) {
      people.add(approver.trim());
    }
  }
  for (const participant of timeline.slackThread?.participants ?? []) {
    if (participant.trim()) {
      people.add(participant.trim());
    }
  }
  for (const participant of timeline.teamsThread?.participants ?? []) {
    if (participant.trim()) {
      people.add(participant.trim());
    }
  }
  return [...people];
}

function technicalDecisionFromTimeline(timeline: DecisionTimeline, file: string): string {
  if (timeline.linkedPR?.description?.trim()) {
    return truncate(timeline.linkedPR.description.trim().replace(/\s+/g, " "), 280);
  }
  if (timeline.originalCommit?.message?.trim()) {
    return `Introduced in commit ${timeline.originalCommit.sha.slice(0, 7)}: ${truncate(
      timeline.originalCommit.message.trim().replace(/\s+/g, " "),
      220
    )}`;
  }
  return `No commit or PR rationale attached for \`${file}\`.`;
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
  // Default: omit Unknown fillers. Only include one-line unknowns when the caller
  // asked about alternatives/trade-offs explicitly.
  const includeUnknown = options?.includeUnknownSections === true;
  const people = collectWhoToEngage(timeline);

  const lines = [
    "**Summary**",
    `Evidence is **limited** — only the introducing commit for \`${file}\` is attached.`,
    "",
    "**Technical decision**",
    technicalDecisionFromTimeline(timeline, file),
    ""
  ];

  if (people.length > 0) {
    lines.push("**Who to engage**", people.map((person) => `- ${person}`).join("\n"), "");
  }

  if (includeUnknown) {
    lines.push(
      "**Alternatives considered**",
      warningNote ? `Not documented (${warningNote}).` : "Not documented in attached sources.",
      "",
      "**Trade-offs**",
      "Not documented in attached sources.",
      ""
    );
  }

  const checklist = listDecisionSourcesChecklist(timeline);
  if (checklist.length) {
    lines.push("**Sources**");
    for (const item of checklist) {
      if (commitLabel && item.startsWith(commitLabel)) {
        lines.push(
          `- ${commitLabel} — original introduction; does not record rejected alternatives or trade-offs.`
        );
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
    result = removeSection(result, heading);
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function isUnknownFillerBody(body: string): boolean {
  const trimmed = body
    .replace(/^[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .trim()
    .toLowerCase();
  if (!trimmed) {
    return true;
  }
  return (
    /^unknown(\s*[—–-]\s*.*)?\.?$/.test(trimmed) ||
    /^not (recorded|documented|available|known)(\s+in\s+.+)?\.?$/.test(trimmed) ||
    /^n\/a\.?$/.test(trimmed) ||
    /^none\.?$/.test(trimmed) ||
    /^unclear\.?$/.test(trimmed)
  );
}

/** Drop Unknown / empty optional Trace sections the model pads with. */
export function stripUnknownFillerSections(content: string): string {
  let result = `\n${content.replace(/\r\n/g, "\n")}`;
  for (const heading of UNKNOWN_FILLER_HEADINGS) {
    const body = extractSectionBody(result, heading);
    if (body !== undefined && isUnknownFillerBody(body)) {
      result = removeSection(result, heading);
    }
  }
  return result.replace(/^\n/, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Remove "pages reviewed" / "content was not retrievable" claims when Trace only had
 * title matches (or the model invented a review list). Prefer GitHub/discussion Sources.
 */
export function stripTitleOnlyDocReviewClaims(content: string): string {
  let result = `\n${content.replace(/\r\n/g, "\n")}`;
  for (const heading of DOC_REVIEW_CLAIM_HEADINGS) {
    result = removeSection(result, heading);
  }
  // Inline claims like "6 Notion pages reviewed" / "content was not retrievable"
  result = result.replace(
    /^[ \t]*[-*]?\s*\d+\s+(notion|confluence|google docs?)\s+pages?\s+reviewed\.?[ \t]*$/gim,
    ""
  );
  result = result.replace(
    /^[ \t]*[-*]?\s*.{0,80}\bcontent was not retriev(?:able|ed)\b.*$/gim,
    ""
  );
  result = result.replace(
    /^[ \t]*[-*]?\s*.{0,80}\b(pages?|documents?)\s+reviewed\b(?![^\n]{0,40}\bexcerpt\b).*$/gim,
    ""
  );
  return result.replace(/^\n/, "").replace(/\n{3,}/g, "\n\n").trim();
}

function finalizeTraceResponse(content: string): string {
  return stripDisallowedNarrativeSourceCitations(
    stripUnknownFillerSections(stripTitleOnlyDocReviewClaims(content))
  );
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
    return finalizeTraceResponse(options.content);
  }

  const thin = !timelineHasDiscussionEvidence(timeline);

  if (thin) {
    const asksAlternatives = asksAboutAlternativesOrTradeoffs(options.userQuestion);
    const speculative = responseHasSpeculativeTradeoffs(options.content);

    if (asksAlternatives) {
      return finalizeTraceResponse(
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
        return finalizeTraceResponse(
          buildThinAlternativesTradeOffsResponse(
            timeline,
            options.activeFile?.trim() || timeline.file,
            { includeUnknownSections: false }
          )
        );
      }
      return finalizeTraceResponse(stripped);
    }
  } else if (shouldReplaceWithGroundedAlternatives(options.content, timeline, options.userQuestion)) {
    return finalizeTraceResponse(injectGroundedAlternativesSections(options.content, timeline));
  }

  return finalizeTraceResponse(options.content);
}
