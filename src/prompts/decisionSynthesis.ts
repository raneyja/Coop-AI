import type { DecisionTimeline } from "../types/decisionTimeline";

export const DECISION_HISTORIAN_SYSTEM = `You are a code historian. You have been given:
- Original code commit and message
- PR discussion with code review comments
- Slack or Teams thread discussing the decision (when available)
- Jira ticket with product context (when available)

Synthesize a clear narrative explaining:
1. What was the business problem or technical need?
2. What alternatives were considered and why were they rejected?
3. What trade-offs were made?
4. Are there known limitations or future improvements noted?
5. Who are the domain experts?

Cite sources explicitly: "According to PR #123…", "As discussed in Slack thread…", "Per Jira PROJ-456…".
Never invent URLs, ticket IDs, or PR numbers not present in the evidence.
State confidence when evidence is thin.`;

export type DecisionSynthesisInput = {
  timeline: DecisionTimeline;
  file: string;
  lineRange?: { start: number; end: number };
  codeSnippet?: string;
  userQuestion?: string;
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
  lines.push("Synthesize from evidence only. Follow the required response structure in your system instructions.");

  return lines.join("\n");
}

export function formatTimelineForPrompt(timeline: DecisionTimeline): string {
  const sections: string[] = [];

  if (timeline.originalCommit) {
    const c = timeline.originalCommit;
    sections.push(
      `### Original commit\n- SHA: ${c.sha.slice(0, 12)}\n- Author: ${c.author}\n- Date: ${c.date}\n- Message:\n${c.message}`
    );
  } else if (timeline.fallbackMessage) {
    sections.push(`### Commit history\n${timeline.fallbackMessage}`);
  }

  if (timeline.linkedPR) {
    const pr = timeline.linkedPR;
    sections.push(
      `### Pull request #${pr.number}\n- Title: ${pr.title}\n- State: ${pr.state}\n- Description:\n${pr.description || "(empty)"}\n- Approvers: ${pr.approvers.join(", ") || "none listed"}`
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
    sections.push(
      `### Slack thread\n- Channel: ${s.channelName ?? s.channelId}\n- Participants: ${s.participants.join(", ")}\n` +
        s.messages
          .slice(0, 40)
          .map((m) => `- @${m.user}: ${truncate(m.text, 300)}`)
          .join("\n")
    );
  }

  if (timeline.teamsThread) {
    const t = timeline.teamsThread;
    sections.push(
      `### Microsoft Teams thread\n- Participants: ${t.participants.join(", ")}\n` +
        t.messages
          .slice(0, 40)
          .map((m) => `- @${m.user}: ${truncate(m.text, 300)}`)
          .join("\n")
    );
  }

  if (timeline.jiraTicket) {
    const j = timeline.jiraTicket;
    sections.push(
      `### Jira ${j.key}\n- Epic: ${j.epic ?? "none"}\n- Summary: ${j.summary}\n- Description:\n${j.description || "(empty)"}\n- Acceptance criteria:\n${j.acceptanceCriteria.map((ac) => `  - ${ac}`).join("\n") || "  (none parsed)"}`
    );
  }

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

export function decisionTimelineSummary(timeline: DecisionTimeline): string {
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
