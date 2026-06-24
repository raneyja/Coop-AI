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
  const confluencePages = timeline.integrationSearch?.confluence?.pages ?? [];
  if (confluencePages.length === 1) {
    labels.push(decisionSourceLabelConfluence(confluencePages[0]!.title));
  } else if (confluencePages.length > 1) {
    labels.push(groupedIntegrationDocLabel("Confluence", confluencePages.length));
  }
  const notionPages = timeline.integrationSearch?.notion?.pages ?? [];
  if (notionPages.length === 1) {
    labels.push(decisionSourceLabelNotion(notionPages[0]!.title));
  } else if (notionPages.length > 1) {
    labels.push(groupedIntegrationDocLabel("Notion", notionPages.length));
  }
  const googleDocs = timeline.integrationSearch?.googleDocs?.documents ?? [];
  if (googleDocs.length === 1) {
    labels.push(decisionSourceLabelGoogleDocs(googleDocs[0]!.title));
  } else if (googleDocs.length > 1) {
    labels.push(groupedIntegrationDocLabel("Google Docs", googleDocs.length));
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
  if (label.startsWith("[Sources: Notion pages")) {
    return "design or decision documentation from Notion search (grouped pages)";
  }
  if (label.startsWith("[Sources: Notion")) {
    return "design or decision documentation from Notion search";
  }
  if (label.startsWith("[Sources: Google Docs (")) {
    return "design or decision documentation from Google Docs search (grouped documents)";
  }
  if (label.startsWith("[Sources: Google Docs")) {
    return "design or decision documentation from Google Docs search";
  }
  return "summarize what this source contributed to the decision";
}
