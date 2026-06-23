import type { DecisionTimeline } from "../types/decisionTimeline";

export function decisionSourceLabelCommit(sha: string): string {
  return `[Sources: GitHub commit ${sha.slice(0, 7)}]`;
}

export function decisionSourceLabelPr(number: number): string {
  return `[Sources: PR #${number}]`;
}

export function decisionSourceLabelSlack(channel: string): string {
  const normalized = channel.startsWith("#") ? channel : `#${channel}`;
  return `[Sources: Slack ${normalized}]`;
}

export function decisionSourceLabelTeams(): string {
  return `[Sources: Teams thread]`;
}

export function decisionSourceLabelJira(key: string): string {
  return `[Sources: Jira ${key}]`;
}

export function listDecisionSourceLabels(timeline: DecisionTimeline): string[] {
  const labels: string[] = [];
  if (timeline.originalCommit) {
    labels.push(decisionSourceLabelCommit(timeline.originalCommit.sha));
  }
  if (timeline.linkedPR) {
    labels.push(decisionSourceLabelPr(timeline.linkedPR.number));
  }
  if (timeline.slackThread) {
    labels.push(
      decisionSourceLabelSlack(
        timeline.slackThread.channelName ?? timeline.slackThread.channelId
      )
    );
  }
  if (timeline.teamsThread) {
    labels.push(decisionSourceLabelTeams());
  }
  for (const ticket of timeline.jiraTickets ?? []) {
    labels.push(decisionSourceLabelJira(ticket.key));
  }
  return labels;
}

export function listDecisionSourcesChecklist(timeline: DecisionTimeline): string[] {
  return listDecisionSourceLabels(timeline).map((label) => {
    const suffix = decisionSourceChecklistSuffix(label);
    return `${label} — ${suffix}`;
  });
}

function decisionSourceChecklistSuffix(label: string): string {
  if (label.startsWith("[Sources: GitHub commit")) {
    return "introducing commit and message — provenance; alternatives unknown unless stated";
  }
  if (label.startsWith("[Sources: PR #")) {
    return "PR description, review comments, and approvals — decision rationale and rejected options";
  }
  if (label.startsWith("[Sources: Slack")) {
    return "thread discussion — consensus and informal alternatives";
  }
  if (label.startsWith("[Sources: Teams")) {
    return "Teams thread — discussion and informal alternatives";
  }
  if (label.startsWith("[Sources: Jira")) {
    return "ticket requirements, acceptance criteria, and scope";
  }
  return "summarize what this source contributed to the decision";
}
