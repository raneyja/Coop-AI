import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendUserFocusInstructions,
  supplementaryKeysOmittedFromChecklist,
  truncationNote,
  ATTACHED_FACTS_HEADING,
  EVIDENCE_CITATION_RULES
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

export const DECISION_HISTORIAN_SYSTEM = `You are a code historian. You have been given structured sources from the Sources card shown to the user.

Each evidence section is labeled with an exact citation key like \`[Sources: PR #1506]\` or \`[Sources: Slack #engineering]\`.

Answer the user's question with a short trace, separating these evidence kinds:
1. **Current observations** — only behavior directly visible in the selected current source, with its actual conditions and scope. Attribute comments as comments; they do not verify another file, whether a proposed improvement remains unimplemented, or organizational intent.
2. **Recorded history** — attribute exact commit/PR/discussion accounts to their source and time. A title or message describes that record, not the exact guard/function it introduced. Claim a particular code addition only when an attached relevant target patch establishes it; bounded history and a patch still do not prove original introduction unless independently verified.
3. **Unknowns** — state briefly what the attached evidence cannot establish about rationale, rejected alternatives, trade-offs, decision status, or current responsibility. Do not fill these gaps with a design story inferred from the present code or multiple sampled commits.

Use only the partitions needed for the ask. Within recorded history, explain a business problem, rejection reason or accepted trade-off only when the original source explicitly records it. **Who to engage** may name possible contacts with their observed evidence role (authors, approvers, thread participants), not generic role titles.

Contact evidence is sampled historical participation, not verified current ownership, expertise, availability, or an exhaustive contact roster. Even when one person authored every attached commit, do not call them the only person to engage, the sole expert, or the required approver. Suggest that observed participant as a possible starting point; current responsibility and other contacts remain unknown unless an attached current ownership policy explicitly establishes them.

The primary trace target is the file in ## Task and the decision timeline in ## What we found — not @-attached paths unless listed as in-scope in ## @ attachments.
Never attribute timeline commits, PRs, or tickets to code from out-of-scope @ attachments.
Never retarget the narrative to a different repo path (migration, sibling model, drive-by file in a multi-file PR). Unrelated paths may appear only as clearly labeled secondary context.
If warnings say history for the target file is thin, truncated, or missing, say so honestly for that file — do not substitute another popular file's story.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}
Source presence and ranking are retrieval hints, not proof of a decision rationale. An approval records approval, not why a choice was made. A source title, link, identifier, or arbitrary quote cannot establish alternatives or trade-offs; use only the attached body and preserve what it actually says. Choosing Y instead of X does not state a reason for rejecting X. Document titles without excerpts establish only a search result, not an ADR or its contents.
State confidence when evidence is thin. Keep answers concise — limited evidence warrants short sections, not speculative essays.
Historical commits and discussions describe their account at that time. Current code can show a behavior remains present, but that does not establish the design decision is active, approved, or superseded. **Decision status** is optional; without an explicit current decision record, say status is unverified. A latest sampled date does not establish the last change or exhaust all activity.
Follow-up questions use the same evidence partitions; omit sections the user did not ask about when they have no evidence.
For **Alternatives considered** and **Trade-offs**, ground every claim in original attached PR review, Slack/Jira/Teams or decision-document text — quote or paraphrase with plain provenance (e.g. "PR #1506 review by @alice"). Extracted alternatives and rankings are navigation hints, not independent proof. If no original source documents options, write unknown — never invent them.
When only a sampled commit is attached (no PR, Slack, Jira, or design doc), say alternatives and trade-offs are unknown — never invent them.
When enriched fields are attached (targetLabel, introducingDiffSummary, evolution, rationaleRanking, focusCommit), use them per the Evidence enrichment section in the user prompt.
When a user focus ask is present, prefer commits/PRs that match that ask and the open file over a generic recent multi-file change. For full-file traces, focusCommit and evolution select sampled historical accounts to attribute, not a confirmed recent decision story; treat originalCommit as a sampled provenance anchor. Bounded path history and selected-line blame do not prove when a file or requested function was introduced. A rename is not an introduction; use fileChange and the patch to describe only the observed change.`;

export type DecisionSynthesisInput = {
  timeline: DecisionTimeline;
  file: string;
  owner?: string;
  repo?: string;
  lineRange?: { start: number; end: number };
  codeSnippet?: string;
  userQuestion?: string;
  /** Specific ask after a slash command / custom prompt — answer in the opening prose. */
  userFocus?: string;
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
  appendUserFocusInstructions(lines, input.userFocus);
  lines.push("## Primary trace target");
  if (timeline.targetLabel) {
    lines.push(`- Target: ${timeline.targetLabel}`);
  } else {
    lines.push(`- File: ${file}${formatLineRange(lineRange)}`);
  }
  if (input.owner && input.repo) {
    lines.push(`- Repository: ${input.owner}/${input.repo}`);
  }
  lines.push(
    `- Grounding rule: the opening and **Technical decision** must be about \`${file}\` (or commits/PRs that touch it). Other paths in multi-file PRs are secondary only.`
  );
  appendMentionScopeSection(lines, input);
  lines.push("");

  if (codeSnippet?.trim()) {
    lines.push("## Code under investigation");
    lines.push("```");
    lines.push(codeSnippet.trim());
    lines.push("```");
    lines.push("");
  }

  lines.push(ATTACHED_FACTS_HEADING);
  lines.push(formatTimelineForPrompt(timeline));
  lines.push("");
  const citationKeys = listDecisionSourceLabels(timeline);
  const sourcesChecklist = listDecisionSourcesChecklist(timeline);
  appendCitationKeysSection(lines, citationKeys);
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendSupplementarySourceCitationGuardrails(
    lines,
    sourcesChecklist,
    supplementaryKeysOmittedFromChecklist(citationKeys, sourcesChecklist)
  );
  appendEvidenceQualityInstructions(lines);
  if (hasDecisionEnrichment(timeline)) {
    lines.push("## Evidence enrichment");
    lines.push("- Target labels, focus/evolution selection, chronology, rationale ranking and diff summaries guide retrieval only. Do not turn them into a recent decision story, current decision status, complete activity record, or code-introduction claim.");
    lines.push("- Attribute exact original commit/PR/discussion text. A relevant target patch may establish its observed changed lines, not original introduction; aggregate diff counts and a commit title cannot establish which current guard/function was added. A rename is not an introduction.");
    lines.push("");
  }
  appendAlternativesTradeOffGuidance(lines, timeline);
  if (input.isFollowUp) {
    appendFollowUpInstructions(lines, input.userBubble ?? userQuestion);
  }
  lines.push(
    "Synthesize the decision for the primary trace target only. Use the timeline evidence for that file — do not rewrite the narrative around out-of-scope @ attachments or unrelated paths from a multi-file commit/PR."
  );
  if (!input.isFollowUp) {
    lines.push(
      "Produce a short trace for the primary file (opening + at most 3 evidence partitions) — do not collapse the answer to only alternatives or trade-offs."
    );
  }
  if (input.userFocus?.trim()) {
    lines.push(
      "Weight commits/PRs that match the user focus and primary file over weakly related multi-file PRs labeled secondary in warnings or rationale ranking."
    );
  }
  lines.push(
    "If the attached sources warn that history for this file is thin/truncated/missing, say that plainly for this file — never substitute a different migration or model file as the main subject."
  );
  lines.push(
    "Separate **Current observations**, exact attributed **Recorded history**, and **Unknowns** as needed. Recent/focus commits, rationale rankings, chronology narratives and aggregate diff summaries are navigation hints, not proof of a code addition or motivation. Only a relevant attached target patch can support a specific guard/function addition; quote a commit title as its title instead of mapping it to current code. Comments support their attributed statements, not verified current duplication, unimplemented improvements or accepted design trade-offs."
  );
  lines.push(
    "Do not force **Decision status** to active/superseded: current code presence and a recent sampled commit do not establish decision approval or exhaustive last activity. **Who to engage** may cite approvers, authors, or thread participants as possible contacts with their observed roles. A single author across sampled commits does not establish an exclusive contact, sole expert, required approver, or current owner; current responsibility and other contacts remain unknown without an attached current ownership policy."
  );
  lines.push("Follow the evidence partitions in your system instructions. Prefer fewer supported claims over a complete-looking speculative story.");

  return lines.join("\n");
}

function hasDecisionEnrichment(timeline: DecisionTimeline): boolean {
  return (
    Boolean(timeline.targetLabel) ||
    Boolean(timeline.introducingDiffSummary) ||
    Boolean(timeline.evolution) ||
    Boolean(timeline.focusCommit) ||
    (timeline.rationaleRanking?.length ?? 0) > 0
  );
}

function appendFollowUpInstructions(lines: string[], userQuestion: string | undefined): void {
  lines.push("## Follow-up");
  lines.push("- This is a follow-up in an active trace-decision thread — answer only from the attached sources.");
  lines.push("- Use the required section headings, but keep the reply compact (often 4-8 sentences when evidence is limited).");
  lines.push("- Omit sections the user did not ask about when they would be empty or speculative.");
  if (userQuestion?.trim()) {
    lines.push(`- Focus on: ${userQuestion.trim()}`);
    lines.push(
      "- Answer the follow-up in the opening sentences. Do not add a **Your question**, **Answer**, or **Summary** heading."
    );
    lines.push(
      "- Opening PASS: cites evidence from the attached timeline for the ask. FAIL: generic restatement with no PR/commit/discussion citation when evidence exists."
    );
  }
  lines.push("");
}

function appendAlternativesTradeOffGuidance(lines: string[], timeline: DecisionTimeline): void {
  const hasDiscussion =
    Boolean(timeline.linkedPR?.description?.trim()) ||
    (timeline.linkedPR?.reviews.some(review => review.body.trim()) ?? false) ||
    (timeline.slackThread?.messages.some(message => message.text.trim()) ?? false) ||
    (timeline.teamsThread?.messages.some(message => message.text.trim()) ?? false) ||
    (timeline.jiraTickets?.some(ticket => ticket.description.trim() || ticket.acceptanceCriteria.some(text => text.trim())) ?? false) ||
    (timeline.integrationSearch?.confluence?.pages.some(page => page.excerpt?.trim()) ?? false) ||
    (timeline.integrationSearch?.slack?.messages.some(message => message.text.trim()) ?? false) ||
    (timeline.integrationSearch?.teams?.messages.some(message => (message.text ?? message.body ?? "").trim()) ?? false);
  lines.push("## Alternatives / trade-offs guidance");
  if (hasDiscussion) {
    lines.push(
      "- Before stating any alternative or trade-off, quote or paraphrase the original attached PR review, Slack/Jira/Teams message or decision-document excerpt — use plain provenance in narrative (e.g. PR #1506 review by @alice); reserve `[Sources: …]` labels for **Sources**. Extracted alternatives are hints to inspect the original text, not independent evidence."
    );
    lines.push("- Do not list options or trade-offs that no attached discussion source mentions.");
  } else {
    lines.push(
      "- Bundle has no original attached discussion body — **Alternatives considered** and **Trade-offs** must say unknown or not documented (one line each). Metadata, approvals and extracted alternatives do not fill that gap."
    );
    lines.push("- Do not infer generic trade-offs from software best practices or the sampled commit alone.");
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

  if (timeline.evolution) {
    const evolution = timeline.evolution;
    const recentLines =
      evolution.recentCommits
        ?.map(
          (commit) =>
            `- ${commit.sha.slice(0, 7)} (${commit.date}) ${commit.author}: ${truncate(commit.message, 160)}`
        )
        .join("\n") ?? "";
    sections.push(
      "### Sampled file evolution (historical accounts, not exhaustive activity)\n" +
        `- Sampled later commits: ${evolution.commitCountSinceIntroduction}` +
        (evolution.lastModifiedAt ? `\n- Latest sampled change: ${evolution.lastModifiedAt}` : "") +
        (evolution.lastModifiedAuthor ? `\n- Latest sampled author: ${evolution.lastModifiedAuthor}` : "") +
        (recentLines ? `\n- Recent commits:\n${recentLines}` : "")
    );
  }

  const focus = timeline.focusCommit ?? timeline.originalCommit;
  if (focus) {
    const isRecentFocus =
      timeline.originalCommit && focus.sha !== timeline.originalCommit.sha;
    sections.push(
      `### ${isRecentFocus ? "Recent sampled commit" : decisionSourceLabelCommit(focus.sha)}\n` +
        `- SHA: ${focus.sha.slice(0, 12)}\n- Author: ${focus.author}\n- Date: ${focus.date}\n- Message:\n${focus.message}`
    );
  } else if (timeline.fallbackMessage) {
    sections.push(`### Commit history\n${timeline.fallbackMessage}`);
  }

  if (
    timeline.originalCommit &&
    timeline.focusCommit &&
    timeline.focusCommit.sha !== timeline.originalCommit.sha
  ) {
    const c = timeline.originalCommit;
    sections.push(
      `### Sampled provenance (background)\n- SHA: ${c.sha.slice(0, 12)}\n- Author: ${c.author}\n- Date: ${c.date}\n- Message:\n${c.message}`
    );
  } else if (timeline.originalCommit && !timeline.focusCommit) {
    const c = timeline.originalCommit;
    sections.push(
      `### ${decisionSourceLabelCommit(c.sha)}\n- SHA: ${c.sha.slice(0, 12)}\n- Author: ${c.author}\n- Date: ${c.date}\n- Message:\n${c.message}`
    );
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
      `### Sampled commit diff summary\n- ${diff.summary}` +
        (stats ? `\n- Change stats: ${stats}` : "") +
        (diff.fileChange ? `\n- Target file change: ${diff.fileChange.type}${diff.fileChange.previousPath ? ` from ${diff.fileChange.previousPath}` : ""}` : "") +
        (diff.patchExcerpt ? `\n- Patch excerpt: ${truncate(diff.patchExcerpt, 300)}` : "")
    );
  }

  if (timeline.rationaleRanking?.length) {
    const primaryRationale = timeline.rationaleRanking.find((entry) => entry.role === "rationale");
    sections.push(
      "### Rationale ranking (candidate sources; attached body must establish the reason)\n" +
        timeline.rationaleRanking
          .map((entry) => {
            const primary =
              primaryRationale && entry.source === primaryRationale.source ? " (primary rationale source candidate)" : "";
            return `- ${entry.label} — ${entry.role}${primary} [${entry.source}]`;
          })
          .join("\n")
    );
  }

  if (timeline.focusDecisionQuality === "weak" || timeline.focusIsMegaDriveBy) {
    sections.push(
      "### Focus confidence\n" +
        `- quality: ${timeline.focusDecisionQuality ?? "unknown"}` +
        (timeline.focusIsMegaDriveBy ? "\n- megaDriveBy: true" : "") +
        "\n- Instruction: Do NOT claim this focus commit/PR as the design rationale for the user's ask. Say the decision record is unclear and keep Sources as provenance only."
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
            .join("\n") +
          truncationNote(pr.reviews.length, 30)
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
          .join("\n") +
        truncationNote(s.messages.length, 40)
    );
  }

  if (timeline.teamsThread) {
    const t = timeline.teamsThread;
    sections.push(
      `### ${decisionSourceLabelTeams()}\n- Participants: ${t.participants.join(", ")}\n` +
        t.messages
          .slice(0, 40)
          .map((m) => `- @${m.user}: ${truncate(m.text, 300)}`)
          .join("\n") +
        truncationNote(t.messages.length, 40)
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
          .join("\n") +
        truncationNote(search.slack?.messages?.length ?? 0, 10)
    );
  }

  if ((search.teams?.messages.length ?? 0) > 0 && !timeline.teamsThread) {
    sections.push(
      `### ${decisionSourceLabelTeams()} (integration search)\n` +
        (search.teams?.messages ?? [])
          .slice(0, 10)
          .map((message) => `- ${message.fromUserName ?? "unknown"}: ${truncate(message.text ?? message.body ?? "", 250)}`)
          .join("\n") +
        truncationNote(search.teams?.messages?.length ?? 0, 10)
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
  const focus = timeline.focusCommit ?? timeline.originalCommit;
  if (focus && timeline.originalCommit && focus.sha !== timeline.originalCommit.sha) {
    parts.push(`recent ${focus.sha.slice(0, 7)}`);
    parts.push(`provenance ${timeline.originalCommit.sha.slice(0, 7)}`);
  } else if (timeline.originalCommit) {
    parts.push(`sampled commit ${timeline.originalCommit.sha.slice(0, 7)}`);
  }
  if (timeline.evolution?.commitCountSinceIntroduction) {
    parts.push(`${timeline.evolution.commitCountSinceIntroduction} sampled later commits`);
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
