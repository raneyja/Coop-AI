import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendNarrativeCitationInstructions,
  supplementaryKeysOmittedFromChecklist,
  EVIDENCE_CITATION_RULES,
  EVIDENCE_ENRICHMENT_RULES
} from "./evidenceSynthesis";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForTraceDecision,
  type MentionScopeRef
} from "./mentionScope";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelConfluence,
  decisionSourceLabelGoogleDocs,
  decisionSourceLabelJira,
  decisionSourceLabelNotion,
  decisionSourceLabelPr,
  decisionSourceLabelSlack,
  decisionSourceLabelTeams,
  listDecisionSourceLabels,
  listDecisionSourcesChecklist
} from "./decisionSourceLabels";

export const DECISION_HISTORIAN_SYSTEM = `You are a code historian. You have been given a structured evidence bundle from the Sources card shown to the user.

Each evidence section is labeled with an exact citation key like \`[Sources: PR #1506]\` or \`[Sources: Slack #engineering]\`.

Synthesize a clear narrative explaining:
1. What was the business problem or technical need?
2. What alternatives were considered and why were they rejected?
3. What trade-offs were made?
4. Are there known limitations or future improvements noted?
5. Who are the domain experts?
6. What is the current **Decision status** (active, superseded, or unclear from evidence)?
7. **Who to engage** for questions or changes today — name people with evidence (authors, approvers, thread participants), not generic role titles.

The primary trace target is the file in ## Task and the decision timeline in ## Evidence bundle — not @-attached paths unless listed as in-scope in ## @ attachments.
Never attribute timeline commits, PRs, or tickets to code from out-of-scope @ attachments.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}
${EVIDENCE_ENRICHMENT_RULES}
State confidence when evidence is thin. Keep answers concise — limited evidence warrants short sections, not speculative essays.
Follow-up questions use the same required section structure; omit sections the user did not ask about when they have no evidence.
For **Alternatives considered** and **Trade-offs**, ground every claim in a PR review comment, Slack/Jira/Teams message, or extracted alternative — quote or paraphrase with plain provenance (e.g. "PR #1506 review by @alice"). If no discussion source documents options, write unknown — never invent them.
When only an introducing commit is attached (no PR, Slack, Jira, or design doc), say alternatives and trade-offs are unknown — never invent them.
When enriched fields are attached (targetLabel, introducingDiffSummary, evolution, rationaleRanking), use them per the Evidence enrichment section in the user prompt.`;

export type DecisionSynthesisInput = {
  timeline: DecisionTimeline;
  file: string;
  owner?: string;
  repo?: string;
  lineRange?: { start: number; end: number };
  codeSnippet?: string;
  userQuestion?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
  /** True when the user sent a normal chat follow-up in an inherited trace-decision thread. */
  isFollowUp?: boolean;
  /** User-visible bubble text (not the internal model prompt). */
  userBubble?: string;
};

export function buildDecisionSynthesisUserPrompt(input: DecisionSynthesisInput): string {
  const { timeline, file, lineRange, codeSnippet, userQuestion } = input;
  const lines: string[] = [];

  lines.push("## Task");
  lines.push(
    userQuestion?.trim() ||
      `Explain why the code at ${file}${formatLineRange(lineRange)} exists and what decision led to it.`
  );
  lines.push("");
  lines.push("## Primary trace target");
  if (timeline.targetLabel) {
    lines.push(`- Target: ${timeline.targetLabel}`);
  } else {
    lines.push(`- File: ${file}${formatLineRange(lineRange)}`);
  }
  if (input.owner && input.repo) {
    lines.push(`- Repository: ${input.owner}/${input.repo}`);
  }
  appendMentionScopeSection(lines, input);
  lines.push("");

  if (codeSnippet?.trim()) {
    lines.push("## Code under investigation");
    lines.push("```");
    lines.push(codeSnippet.trim());
    lines.push("```");
    lines.push("");
  }

  lines.push("## Evidence bundle");
  lines.push(formatTimelineForPrompt(timeline));
  lines.push("");
  const citationKeys = listDecisionSourceLabels(timeline);
  const sourcesChecklist = listDecisionSourcesChecklist(timeline);
  appendCitationKeysSection(lines, citationKeys);
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendNarrativeCitationInstructions(lines);
  appendSupplementarySourceCitationGuardrails(
    lines,
    sourcesChecklist,
    supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  );
  appendEvidenceQualityInstructions(lines);
  appendEvidenceEnrichmentInstructions(lines);
  appendAlternativesTradeOffGuidance(lines, timeline);
  if (input.isFollowUp) {
    appendFollowUpInstructions(lines, input.userBubble ?? userQuestion);
  }
  lines.push(
    "Synthesize the decision for the primary trace target only. Use the timeline evidence for that file — do not rewrite the narrative around out-of-scope @ attachments."
  );
  if (!input.isFollowUp) {
    lines.push(
      "Produce the full trace narrative (Summary, Business context, Technical decision, Domain experts, etc.) for the primary file — do not collapse the answer to only alternatives or trade-offs."
    );
  }
  lines.push(
    "Include **Decision status** (active / superseded / unclear) and **Who to engage** when evidence supports it — cite approvers, authors, or thread participants; say unknown when the bundle is thin."
  );
  lines.push("Follow the required response structure in your system instructions.");

  return lines.join("\n");
}

function appendFollowUpInstructions(lines: string[], userQuestion: string | undefined): void {
  lines.push("## Follow-up");
  lines.push("- This is a follow-up in an active trace-decision thread — answer only from the attached evidence bundle.");
  lines.push("- Use the required section headings, but keep the reply compact (often 4-8 sentences when evidence is limited).");
  lines.push("- Omit sections the user did not ask about when they would be empty or speculative.");
  if (userQuestion?.trim()) {
    lines.push(`- Focus on: ${userQuestion.trim()}`);
  }
  lines.push("");
}

function appendAlternativesTradeOffGuidance(lines: string[], timeline: DecisionTimeline): void {
  const hasDiscussion =
    Boolean(timeline.linkedPR) ||
    Boolean(timeline.slackThread) ||
    Boolean(timeline.teamsThread) ||
    (timeline.jiraTickets?.length ?? 0) > 0 ||
    timeline.alternatives.length > 0;
  lines.push("## Alternatives / trade-offs guidance");
  if (hasDiscussion) {
    lines.push(
      "- Before stating any alternative or trade-off, quote or paraphrase the PR review, Slack/Jira/Teams message, or extracted alternative — use plain provenance in narrative (e.g. PR #1506 review by @alice); reserve `[Sources: …]` labels for **Sources**."
    );
    lines.push("- Do not list options or trade-offs that no attached discussion source mentions.");
  } else {
    lines.push(
      "- Bundle has no PR, Slack, Teams, Jira, or extracted alternatives — **Alternatives considered** and **Trade-offs** must say unknown or not documented (one line each)."
    );
    lines.push("- Do not infer generic trade-offs from software best practices or the introducing commit alone.");
  }
  if (timeline.warnings.length) {
    lines.push(`- Warnings in bundle: ${timeline.warnings.join("; ")}`);
  }
  lines.push("");
}

function appendMentionScopeSection(lines: string[], input: DecisionSynthesisInput): void {
  if (!input.mentionedFiles?.length) {
    return;
  }

  const targetLabel =
    input.owner && input.repo ? `${input.owner}/${input.repo}` : input.file;
  const scope = partitionMentionsForTraceDecision(input.mentionedFiles, input.activeRepoId);
  appendMentionScopePromptSection(lines, {
    targetLabel,
    scope,
    inScopeInstruction: "may supplement the narrative for the primary file",
    excludeFromLabel: "Summary / Business context / Technical decision",
    alternateActionLabel: "Trace Decision"
  });
}

export function formatTimelineForPrompt(timeline: DecisionTimeline): string {
  const sections: string[] = [];

  const traceCompleteness = formatTraceCompletenessSection(timeline);
  if (traceCompleteness) {
    sections.push(traceCompleteness);
  }

  if (timeline.targetLabel) {
    sections.push(`### Target precision\n- targetLabel: ${timeline.targetLabel}`);
  }

  if (timeline.originalCommit) {
    const c = timeline.originalCommit;
    sections.push(
      `### ${decisionSourceLabelCommit(c.sha)}\n- SHA: ${c.sha.slice(0, 12)}\n- Author: ${c.author}\n- Date: ${c.date}\n- Message:\n${c.message}`
    );
  } else if (timeline.fallbackMessage) {
    sections.push(`### Commit history\n${timeline.fallbackMessage}`);
  }

  if (timeline.introducingDiffSummary) {
    const diff = timeline.introducingDiffSummary;
    const stats = [
      diff.filesChanged ? `${diff.filesChanged} file(s)` : undefined,
      diff.insertions !== undefined || diff.deletions !== undefined
        ? `+${diff.insertions ?? 0} / -${diff.deletions ?? 0}`
        : undefined
    ]
      .filter(Boolean)
      .join(", ");
    sections.push(
      `### Introducing diff summary\n- ${diff.summary}` +
        (stats ? `\n- Change stats: ${stats}` : "") +
        (diff.patchExcerpt ? `\n- Patch excerpt: ${truncate(diff.patchExcerpt, 300)}` : "")
    );
  }

  if (timeline.evolution) {
    const evolution = timeline.evolution;
    sections.push(
      "### Evolution since introduction\n" +
        `- Commits since introduction: ${evolution.commitCountSinceIntroduction}` +
        (evolution.lastModifiedAt ? `\n- Last modified: ${evolution.lastModifiedAt}` : "") +
        (evolution.lastModifiedAuthor ? `\n- Last modifier: ${evolution.lastModifiedAuthor}` : "")
    );
  }

  if (timeline.rationaleRanking?.length) {
    const primaryRationale = timeline.rationaleRanking.find((entry) => entry.role === "rationale");
    sections.push(
      "### Rationale ranking\n" +
        timeline.rationaleRanking
          .map((entry) => {
            const primary =
              primaryRationale && entry.source === primaryRationale.source ? " (primary rationale source)" : "";
            return `- ${entry.label} — ${entry.role}${primary} [${entry.source}]`;
          })
          .join("\n")
    );
  }

  if (timeline.linkedPR) {
    const pr = timeline.linkedPR;
    sections.push(
      `### ${decisionSourceLabelPr(pr.number)}\n- Title: ${pr.title}\n- State: ${pr.state}\n- Description:\n${pr.description || "(empty)"}\n- Approvers: ${pr.approvers.join(", ") || "none listed"}`
    );
    if (pr.reviews.length > 0) {
      sections.push(
        "#### Review comments\n" +
          pr.reviews
            .slice(0, 30)
            .map((r) => `- @${r.author} (${r.createdAt})${r.path ? ` on ${r.path}:${r.line ?? "?"}` : ""}: ${truncate(r.body, 400)}`)
            .join("\n")
      );
    }
  }

  if (timeline.alternatives.length > 0) {
    sections.push(
      "### Alternatives extracted\n" +
        timeline.alternatives
          .map(
            (alt) =>
              `- **${alt.option}** (proposed by ${alt.proposed_by}): rejected because ${alt.reason_rejected}`
          )
          .join("\n")
    );
  }

  if (timeline.slackThread) {
    const s = timeline.slackThread;
    const channelLabel = s.channelName ?? s.channelId;
    sections.push(
      `### ${decisionSourceLabelSlack(channelLabel)}\n- Relevance: ${s.relevance ?? "linked"}\n- Participants: ${s.participants.join(", ")}\n` +
        s.messages
          .slice(0, 40)
          .map((m) => `- @${m.user}: ${truncate(m.text, 300)}`)
          .join("\n")
    );
  }

  if (timeline.teamsThread) {
    const t = timeline.teamsThread;
    sections.push(
      `### ${decisionSourceLabelTeams()}\n- Participants: ${t.participants.join(", ")}\n` +
        t.messages
          .slice(0, 40)
          .map((m) => `- @${m.user}: ${truncate(m.text, 300)}`)
          .join("\n")
    );
  }

  if (timeline.jiraTickets && timeline.jiraTickets.length > 0) {
    for (const j of timeline.jiraTickets) {
      sections.push(
        `### ${decisionSourceLabelJira(j.key)}\n- Epic: ${j.epic ?? "none"}\n- Summary: ${j.summary}\n- Description:\n${j.description || "(empty)"}\n- Acceptance criteria:\n${j.acceptanceCriteria.map((ac) => `  - ${ac}`).join("\n") || "  (none parsed)"}` +
          (j.technicalDebt ? "\n- Technical debt: flagged in ticket metadata" : "")
      );
    }
  }

  appendIntegrationSearchSections(sections, timeline);

  if (timeline.chronology.length > 0) {
    sections.push(
      "### Chronology\n" +
        timeline.chronology
          .map((e) => `- ${e.date} | ${e.actor} | ${e.event} | evidence: ${e.evidence}`)
          .join("\n")
    );
  }

  if (timeline.warnings.length > 0) {
    sections.push("### Warnings\n" + timeline.warnings.map((w) => `- ${w}`).join("\n"));
  }

  return sections.join("\n\n");
}

function appendIntegrationSearchSections(sections: string[], timeline: DecisionTimeline): void {
  const search = timeline.integrationSearch;
  if (!search) {
    return;
  }

  if (search.seedJiraKeys?.length || search.seedSearchTerms?.length) {
    sections.push(
      "### Cross-tool search seeds\n" +
        [
          search.seedJiraKeys?.length ? `- Jira keys from code/commits: ${search.seedJiraKeys.join(", ")}` : undefined,
          search.seedSearchTerms?.length ? `- File/doc search terms: ${search.seedSearchTerms.join(", ")}` : undefined
        ]
          .filter(Boolean)
          .join("\n")
    );
  }

  for (const issue of search.jira?.issues ?? []) {
    if (timeline.jiraTickets?.some((ticket) => ticket.key === issue.key)) {
      continue;
    }
    sections.push(
      `### ${decisionSourceLabelJira(issue.key)} (integration search)\n- Summary: ${issue.summary}\n- Status: ${issue.status}`
    );
  }

  for (const page of search.confluence?.pages ?? []) {
    sections.push(
      `### ${decisionSourceLabelConfluence(page.title)}\n- Excerpt: ${truncate(page.excerpt ?? "(none)", 300)}`
    );
  }

  for (const page of search.notion?.pages ?? []) {
    sections.push(`### ${decisionSourceLabelNotion(page.title)}\n- Notion page from targeted search`);
  }

  for (const doc of search.googleDocs?.documents ?? []) {
    sections.push(`### ${decisionSourceLabelGoogleDocs(doc.title)}\n- Google Doc from targeted search`);
  }

  if ((search.slack?.messages.length ?? 0) > 0 && !timeline.slackThread) {
    sections.push(
      `### ${decisionSourceLabelSlack("search")} (integration search)\n` +
        (search.slack?.messages ?? [])
          .slice(0, 10)
          .map((message) =>
            `- ${message.userName ?? "unknown"}${message.channelName ? ` in #${message.channelName}` : ""}: ${truncate(message.text, 250)}`
          )
          .join("\n")
    );
  }

  if ((search.teams?.messages.length ?? 0) > 0 && !timeline.teamsThread) {
    sections.push(
      `### ${decisionSourceLabelTeams()} (integration search)\n` +
        (search.teams?.messages ?? [])
          .slice(0, 10)
          .map((message) => `- ${message.fromUserName ?? "unknown"}: ${truncate(message.text, 250)}`)
          .join("\n")
    );
  }

  const integrationErrors = [
    search.jira?.error ? `Jira search: ${search.jira.error}` : undefined,
    search.confluence?.error ? `Confluence search: ${search.confluence.error}` : undefined,
    search.notion?.error ? `Notion search: ${search.notion.error}` : undefined,
    search.googleDocs?.error ? `Google Docs search: ${search.googleDocs.error}` : undefined,
    search.slack?.error ? `Slack search: ${search.slack.error}` : undefined,
    search.teams?.error ? `Teams search: ${search.teams.error}` : undefined
  ].filter(Boolean);
  if (integrationErrors.length > 0) {
    sections.push("### Integration search notes\n" + integrationErrors.map((line) => `- ${line}`).join("\n"));
  }
}

function formatTraceCompletenessSection(timeline: DecisionTimeline): string | undefined {
  if (timeline.completeness === "full" && timeline.warnings.length === 0) {
    return undefined;
  }

  const lines = ["### Trace completeness"];
  if (timeline.completeness !== "full") {
    lines.push(`- Completeness: ${timeline.completeness}`);
  }
  if (timeline.warnings.length > 0) {
    lines.push("- Gaps:");
    for (const warning of timeline.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  const debtTickets = (timeline.jiraTickets ?? []).filter((ticket) => ticket.technicalDebt);
  if (debtTickets.length > 0) {
    lines.push(`- Technical debt flagged: ${debtTickets.map((ticket) => ticket.key).join(", ")}`);
  }
  return lines.join("\n");
}

export function decisionTimelineSummary(timeline: DecisionTimeline): string {
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
    parts.push("Slack discussion");
  }
  if (timeline.teamsThread) {
    parts.push("Teams discussion");
  }
  return parts.length > 0 ? parts.join(" · ") : "Limited decision history available";
}

function formatLineRange(range?: { start: number; end: number }): string {
  if (!range) {
    return "";
  }
  return range.start === range.end ? `:${range.start}` : `:${range.start}-${range.end}`;
}

function truncate(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}
