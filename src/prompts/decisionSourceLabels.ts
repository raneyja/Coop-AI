import type { DecisionTimeline } from "../types/decisionTimeline";
import { groupedIntegrationDocLabel } from "./sourcesFooterEnrichment";
import {
  evidenceCodeHostDisplayName,
  resolveEvidenceCodeHost
} from "../api/codeHosts/codeHostLabels";

export function decisionSourceLabelCommit(
  sha: string,
  codeHost?: string | null
): string {
  const host = evidenceCodeHostDisplayName(codeHost);
  return `[Sources: ${host} commit ${sha.slice(0, 7)}]`;
}

export function decisionSourceLabelPr(number: number, codeHost?: string | null): string {
  const host = resolveEvidenceCodeHost(codeHost);
  if (host === "gitlab") {
    return `[Sources: MR #${number}]`;
  }
  if (!host) {
    return `[Sources: PR/MR #${number}]`;
  }
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

export function listDecisionSourceLabels(
  timeline: DecisionTimeline,
  codeHost?: string | null
): string[] {
  const host = resolveEvidenceCodeHost(codeHost ?? timeline.provider);
  const labels: string[] = [];
  if (timeline.focusCommit) {
    labels.push(decisionSourceLabelCommit(timeline.focusCommit.sha, host));
  }
  if (timeline.originalCommit && timeline.originalCommit.sha !== timeline.focusCommit?.sha) {
    labels.push(decisionSourceLabelCommit(timeline.originalCommit.sha, host));
  }
  if (timeline.linkedPR) {
    labels.push(decisionSourceLabelPr(timeline.linkedPR.number, host));
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

export function listDecisionSourcesChecklist(
  timeline: DecisionTimeline,
  codeHost?: string | null
): string[] {
  return listDecisionSourceLabels(timeline, codeHost).map((label) => {
    const suffix = decisionSourceChecklistSuffix(label, timeline);
    return `${label} — ${suffix}`;
  });
}

function decisionSourceChecklistSuffix(label: string, timeline: DecisionTimeline): string {
  if (/\[Sources: (?:GitHub|GitLab|Bitbucket) commit/.test(label)) {
    return "sampled commit and message — provenance; original introduction and alternatives unknown unless verified";
  }
  if (/\[Sources: (?:PR|MR|PR\/MR) #/.test(label)) {
    const pr = timeline.linkedPR;
    const parts = ["PR/MR metadata"];
    if (pr?.description.trim()) parts.push("attached description");
    const reviews = pr?.reviews.filter((review) => review.body.trim()).length ?? 0;
    if (reviews) parts.push(`${reviews} attached review comment(s)`);
    if (pr?.approvers.length) parts.push("listed approvers");
    return `${parts.join(", ")} — rationale and rejected options only when stated in attached text`;
  }
  if (label.startsWith("[Sources: Slack")) {
    return "attached thread messages — consensus and alternatives only when explicitly recorded";
  }
  if (label.startsWith("[Sources: Teams")) {
    return "attached Teams messages — alternatives only when explicitly recorded";
  }
  if (label.startsWith("[Sources: Jira")) {
    return "attached ticket fields — requirements, acceptance criteria, and scope only when present";
  }
  if (label.startsWith("[Sources: Confluence pages")) {
    return "Confluence search results and available excerpts — full page bodies not attached";
  }
  if (label.startsWith("[Sources: Confluence")) {
    return "Confluence search result and available excerpt — full page body not attached";
  }
  if (label.startsWith("[Sources: Notion pages")) {
    return "Notion search results — titles and links only; page bodies not attached";
  }
  if (label.startsWith("[Sources: Notion")) {
    return "Notion search result — title and link only; page body not attached";
  }
  if (label.startsWith("[Sources: Google Docs (")) {
    return "Google Docs search results — titles and links only; document bodies not attached";
  }
  if (label.startsWith("[Sources: Google Docs")) {
    return "Google Docs search result — title and link only; document body not attached";
  }
  return "summarize what this source contributed to the decision";
}
