import { decisionTimelineFromBundle } from "../context/contextBundleEvidence";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelJira,
  decisionSourceLabelPr,
  decisionSourceLabelTeams,
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
  return discussionBodies(timeline).length > 0;
}

function discussionBodies(timeline: DecisionTimeline): string[] {
  return [
    timeline.linkedPR?.description ?? "",
    ...(timeline.linkedPR?.reviews.map((review) => review.body) ?? []),
    ...(timeline.slackThread?.messages.map((message) => message.text) ?? []),
    ...(timeline.teamsThread?.messages.map((message) => message.text) ?? []),
    ...(timeline.jiraTickets?.flatMap((ticket) => [ticket.description, ...ticket.acceptanceCriteria]) ?? []),
    ...(timeline.integrationSearch?.confluence?.pages.map((page) => page.excerpt ?? "") ?? []),
    ...(timeline.integrationSearch?.slack?.messages.map((message) => message.text) ?? []),
    ...(timeline.integrationSearch?.teams?.messages.map((message) => message.text ?? message.body ?? "") ?? [])
  ].filter((body) => body.trim());
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

function separateCombinedAlternativesHeading(content: string): string {
  return content.replace(
    /(^|\n)\*\*(Alternatives considered)\s*[/&|]\s*([^*\n]+)\*\*\s*\n([\s\S]*?)(?=\n\*\*[^*]|$)/gi,
    (_match, prefix: string, heading: string, other: string, body: string) => {
      const marker = new RegExp(`(?:^|\\n)(?:\\*\\*)?${escapeRegExp(other.trim())}(?:\\*\\*)?\\s*[:—]\\s*`, "i");
      const split = marker.exec(body);
      if (!split) return `${prefix}**${heading}**\n${body}`;
      return `${prefix}**${heading}**\n${body.slice(0, split.index).trim()}\n\n**${other.trim()}**\n${body.slice(split.index + split[0].length).trim()}\n`;
    }
  );
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
  const framed = `\n${content}`;
  if (!pattern.test(framed)) {
    return `${content.trimEnd()}\n\n**${heading}**\n${body}`;
  }
  return framed.replace(pattern, `$1${body.trim()}\n`).replace(/^\n/, "");
}

/** Every factual paragraph needs an actual attached original-source quote.
 * This checks source membership; it does not certify the meaning of a paraphrase.
 */
export function alternativesSectionsLackGrounding(content: string, timeline: DecisionTimeline): boolean {
  const separated = separateCombinedAlternativesHeading(content);
  const alternatives = extractSectionBody(`\n${separated}`, "Alternatives considered");
  const tradeoffs = extractSectionBody(`\n${separated}`, "Trade-offs");
  const paragraphs = `${alternatives ?? ""}\n${tradeoffs ?? ""}`.trim()
    .split(/\n+/).map((line) => line.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  if (!paragraphs.length) return true;
  const bodies = discussionBodies(timeline);
  return paragraphs.some((paragraph) => {
    if (/^(?:Unknown|Not (?:documented|recorded|established|explicitly recorded))(?:[ —:.,].*)?$/i.test(paragraph)) return false;
    const quotes = [...paragraph.matchAll(/["“]([^"”]{8,})["”]/g)].map((match) => match[1]);
    const attachedQuotes = quotes.length > 0 && quotes.every((quote) => bodies.some((body) => body.includes(quote)));
    return !attachedQuotes;
  });
}

function quotedDiscussionExcerpt(value: string): string {
  // Keep a contiguous source line. Truncation is presentation, outside the quote.
  const line = value.split(/\r?\n/).find(part =>
    /\b(alternative|rejected|trade-?off|decision|instead|chose|decided|rather than|went with)\b/i.test(part)) ?? value.split(/\r?\n/)[0];
  return `"${line.slice(0, 220)}"${line.length > 220 ? " … (excerpt truncated)" : ""}`;
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
    .map((message) => `- @${message.user}: ${quotedDiscussionExcerpt(message.text)} (${label})`);
}

function jiraDecisionExcerpts(timeline: DecisionTimeline): string[] {
  const lines: string[] = [];
  for (const ticket of timeline.jiraTickets ?? []) {
    const label = decisionSourceLabelJira(ticket.key);
    for (const body of [ticket.description, ...ticket.acceptanceCriteria]) {
      if (!/\b(alternative|rejected|trade-?off|decision|chose|instead)\b/i.test(body)) continue;
      lines.push(`- ${ticket.key}: ${quotedDiscussionExcerpt(body)} (${label})`);
    }
  }
  return lines.slice(0, 3);
}

/** Quote-grounded Alternatives / Trade-offs built only from attached discussion sources. */
export function buildGroundedAlternativesTradeOffsSections(timeline: DecisionTimeline): {
  alternatives: string;
  tradeoffs: string;
} {
  const alternativeLines: string[] = [];
  // Extracted alternatives are navigation hints, not original evidence. Only
  // attached discussion text can survive deterministic answer preparation.
  const pr = timeline.linkedPR;
  if (pr) {
    for (const body of [pr.description, ...pr.reviews.map((review) => review.body)]) {
      if (/\b(alternative|rejected|trade-?off|instead|chose|decided|rather than|went with)\b/i.test(body)) {
        alternativeLines.push(`- Attached discussion: ${quotedDiscussionExcerpt(body)} (${decisionSourceLabelPr(pr.number, timeline.provider)})`);
      }
    }
  }
  for (const message of timeline.teamsThread?.messages ?? []) {
    if (/\b(alternative|rejected|trade-?off|instead|chose|decided|rather than|went with)\b/i.test(message.text)) {
      alternativeLines.push(`- @${message.user}: ${quotedDiscussionExcerpt(message.text)} (${decisionSourceLabelTeams()})`);
    }
  }
  alternativeLines.push(...slackDecisionExcerpts(timeline));
  alternativeLines.push(...jiraDecisionExcerpts(timeline));

  const alternatives =
    alternativeLines.length > 0
      ? alternativeLines.join("\n")
      : "Not explicitly recorded in the attached discussion excerpts.";

  const tradeoffLines = alternativeLines.filter((line) => /\btrade-?off\b/i.test(line));
  const tradeoffs = tradeoffLines.length > 0
    ? [...new Set(tradeoffLines)].join("\n")
    : "Not explicitly recorded in the attached discussion excerpts.";

  return { alternatives, tradeoffs };
}

export function injectGroundedAlternativesSections(content: string, timeline: DecisionTimeline): string {
  const { alternatives, tradeoffs } = buildGroundedAlternativesTradeOffsSections(timeline);
  let result = replaceSectionBody(separateCombinedAlternativesHeading(content), "Alternatives considered", alternatives);
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

/** Compact, evidence-honest answer when only a sampled provenance commit is available. */
export function buildThinAlternativesTradeOffsResponse(
  timeline: DecisionTimeline,
  file: string
): string {
  const warningNote = timeline.warnings.find((warning) => /no linked pull request/i.test(warning));
  const commitLabel = timeline.originalCommit
    ? decisionSourceLabelCommit(timeline.originalCommit.sha)
    : undefined;

  const lines = [
    `Evidence is **limited** — attached history for \`${file}\` does not establish alternatives or trade-offs.`,
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
        lines.push(`- ${commitLabel} — sampled provenance; original introduction, rejected alternatives and trade-offs are unverified.`);
      } else {
        lines.push(`- ${item}`);
      }
    }
  }

  return lines.join("\n");
}

/** Short SHA / PR anchors present on the timeline that the answer should cite. */
export function timelineHistoryAnchors(timeline: DecisionTimeline): string[] {
  const anchors: string[] = [];
  const focus = timeline.focusCommit ?? timeline.originalCommit;
  if (focus?.sha) {
    anchors.push(focus.sha.slice(0, 7), focus.sha.slice(0, 12));
  }
  if (
    timeline.originalCommit?.sha &&
    timeline.originalCommit.sha !== focus?.sha
  ) {
    anchors.push(
      timeline.originalCommit.sha.slice(0, 7),
      timeline.originalCommit.sha.slice(0, 12)
    );
  }
  if (timeline.linkedPR?.number != null) {
    anchors.push(`PR #${timeline.linkedPR.number}`, `#${timeline.linkedPR.number}`);
  }
  for (const commit of timeline.evolution?.recentCommits?.slice(0, 3) ?? []) {
    if (commit.sha) {
      anchors.push(commit.sha.slice(0, 7));
    }
  }
  return [...new Set(anchors.filter(Boolean))];
}

export function timelineHasCommitOrPrEvidence(timeline: DecisionTimeline): boolean {
  return Boolean(
    timeline.focusCommit?.sha ||
      timeline.originalCommit?.sha ||
      timeline.linkedPR?.number != null ||
      (timeline.evolution?.recentCommits?.length ?? 0) > 0
  );
}

/** True when timeline has history but the answer never mentions a commit SHA or PR. */
export function responseLacksHistoryAnchors(content: string, timeline: DecisionTimeline): boolean {
  if (!timelineHasCommitOrPrEvidence(timeline)) {
    return false;
  }
  const anchors = timelineHistoryAnchors(timeline);
  if (anchors.length === 0) {
    return false;
  }
  const haystack = content;
  if (anchors.some((anchor) => haystack.includes(anchor))) {
    return false;
  }
  // Plain-language commit/PR mentions that still count as an attempt.
  if (/\b(?:commit|sha)\s+[0-9a-f]{7,40}\b/i.test(haystack)) {
    return false;
  }
  if (/\bPR\s*#?\s*\d+\b/i.test(haystack) || /\bpull request\s*#?\s*\d+\b/i.test(haystack)) {
    return false;
  }
  return true;
}

function historyLeadParagraph(timeline: DecisionTimeline, file: string): string {
  const focus = timeline.focusCommit ?? timeline.originalCommit;
  const weak =
    timeline.focusDecisionQuality === "weak" ||
    timeline.focusDecisionQuality === "unknown" ||
    timeline.focusIsMegaDriveBy;

  // Phase B gate: never force a demoted/unaligned focus as “the decision.”
  if (weak && timeline.focusDecisionQuality === "weak") {
    const parts = [
      `Commit history for \`${file}\` is attached, but no commit clearly matched the ask — treat Sources as provenance, not a confirmed design rationale.`
    ];
    if (focus?.sha) {
      parts.push(`Nearest history anchor: ${focus.sha.slice(0, 7)}.`);
    }
    return parts.join(" ");
  }

  const parts: string[] = [];
  if (focus?.sha) {
    const sha = focus.sha.slice(0, 7);
    const msg = truncate((focus.message ?? "").replace(/\s+/g, " ").trim(), 140);
    parts.push(
      msg
        ? `Decision history for \`${file}\` includes commit ${sha} (“${msg}”).`
        : `Decision history for \`${file}\` includes commit ${sha}.`
    );
  }
  if (timeline.linkedPR?.number != null && !timeline.focusIsMegaDriveBy) {
    const title = truncate((timeline.linkedPR.title ?? "").trim(), 120);
    parts.push(
      title
        ? `Linked PR #${timeline.linkedPR.number}: ${title}.`
        : `Linked PR #${timeline.linkedPR.number}.`
    );
  }
  if (parts.length === 0) {
    parts.push(`Commit/PR history is attached for \`${file}\` — see **Sources**.`);
  }
  return parts.join(" ");
}

/** Inject commit/PR grounding when the model answered as a pure code walkthrough. */
export function injectHistoryGrounding(content: string, timeline: DecisionTimeline, file: string): string {
  // Do not force-cite a mega/unaligned focus as the decision story (Z3 Phase B).
  if (timeline.focusIsMegaDriveBy && timeline.focusDecisionQuality !== "aligned") {
    return content.trim();
  }
  const lead = historyLeadParagraph(timeline, file);
  let result = content.trim();
  const summaryBody = extractSectionBody(`\n${result}`, "Summary");
  if (summaryBody !== undefined) {
    const nextSummary = `${lead}\n\n${summaryBody}`.trim();
    result = replaceSectionBody(`\n${result}`, "Summary", nextSummary).replace(/^\n/, "");
  } else {
    result = `${lead}\n\n${result}`;
  }

  const checklist = listDecisionSourcesChecklist(timeline);
  if (checklist.length && !/\*\*Sources\*\*/i.test(result)) {
    result = `${result.trimEnd()}\n\n**Sources**\n${checklist.map((item) => `- ${item}`).join("\n")}`;
  } else if (checklist.length) {
    // Ensure at least one history checklist line is present under Sources.
    const missing = checklist.filter((item) => !result.includes(item.split(" — ")[0] ?? item));
    if (missing.length) {
      result = replaceSectionBody(
        `\n${result}`,
        "Sources",
        `${extractSectionBody(`\n${result}`, "Sources") ?? ""}\n${missing.map((item) => `- ${item}`).join("\n")}`.trim()
      ).replace(/^\n/, "");
    }
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Replaces speculative trade-off filler with a short evidence-bound answer when the
 * timeline lacks PR/discussion metadata. Also forces commit/PR anchors when history
 * exists but the model answered as a code walkthrough.
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

  const file = options.activeFile?.trim() || timeline.file;
  const content = separateCombinedAlternativesHeading(options.content);
  const thin = !timelineHasDiscussionEvidence(timeline);

  if (thin) {
    const asksAlternatives = asksAboutAlternativesOrTradeoffs(options.userQuestion);
    const speculative = responseHasSpeculativeTradeoffs(content);

    if (asksAlternatives || speculative) {
      return stripDisallowedNarrativeSourceCitations(
        buildThinAlternativesTradeOffsResponse(timeline, file)
      );
    }
  } else if (shouldReplaceWithGroundedAlternatives(content, timeline, options.userQuestion)) {
    return stripDisallowedNarrativeSourceCitations(
      injectGroundedAlternativesSections(content, timeline)
    );
  }

  if (responseLacksHistoryAnchors(content, timeline)) {
    // Phase B: skip forced cite when focus is a demoted mega drive-by.
    if (timeline.focusIsMegaDriveBy && timeline.focusDecisionQuality !== "aligned") {
      return stripDisallowedNarrativeSourceCitations(content);
    }
    return stripDisallowedNarrativeSourceCitations(
      injectHistoryGrounding(content, timeline, file)
    );
  }

  return stripDisallowedNarrativeSourceCitations(content);
}
