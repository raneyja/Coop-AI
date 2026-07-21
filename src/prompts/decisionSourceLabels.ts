import type { DecisionTimeline } from "../types/decisionTimeline";
import { groupedIntegrationDocLabel } from "./sourcesFooterEnrichment";

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

export function decisionSourceLabelConfluence(title: string): string {
  return `[Sources: Confluence ${truncateLabel(title)}]`;
}

export function decisionSourceLabelNotion(title: string): string {
  return `[Sources: Notion ${truncateLabel(title)}]`;
}

export function decisionSourceLabelGoogleDocs(title: string): string {
  return `[Sources: Google Docs ${truncateLabel(title)}]`;
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
  for (const issue of timeline.integrationSearch?.jira?.issues ?? []) {
    if (!labels.includes(decisionSourceLabelJira(issue.key))) {
      labels.push(decisionSourceLabelJira(issue.key));
    }
  }
  // Only Confluence pages with an excerpt count as documentation sources.
  // Title-only Notion / Google Docs / Confluence hits are never checklist sources.
  const confluenceWithBody = (timeline.integrationSearch?.confluence?.pages ?? []).filter((page) =>
    Boolean(page.excerpt?.trim())
  );
  if (confluenceWithBody.length === 1) {
    labels.push(decisionSourceLabelConfluence(confluenceWithBody[0]!.title));
  } else if (confluenceWithBody.length > 1) {
    labels.push(groupedIntegrationDocLabel("Confluence", confluenceWithBody.length));
  }
  return labels;
}

function truncateLabel(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 47)}…`;
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
  if (label.startsWith("[Sources: Confluence pages")) {
    return "architecture or ADR documentation from Confluence search (grouped pages)";
  }
  if (label.startsWith("[Sources: Confluence")) {
    return "architecture or ADR documentation from Confluence search";
  }
  return "summarize what this source contributed to the decision";
}
