import type { OwnershipReport, OwnershipTier } from "../types/ownership";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";
import {
  evidenceCodeHostDisplayName,
  resolveEvidenceCodeHost
} from "../api/codeHosts/codeHostLabels";

/** User-facing tier label (no numeric scores). */
export function ownershipTierLabel(tier: OwnershipTier): string {
  switch (tier) {
    case "primary":
      return "Primary";
    case "secondary":
      return "Secondary";
    case "familiar":
      return "Backup";
  }
}

export function ownershipSourceLabelCodeHost(codeHost?: string | null): string {
  return `[Sources: ${evidenceCodeHostDisplayName(codeHost)} commits & reviews]`;
}

/** @deprecated Prefer ownershipSourceLabelCodeHost with the active Use-repo host. */
export function ownershipSourceLabelGitHub(): string {
  return ownershipSourceLabelCodeHost("github");
}

export function ownershipSourceLabelSlack(): string {
  return "[Sources: Slack presence]";
}

export function ownershipSourceLabelCodeowners(): string {
  return "[Sources: CODEOWNERS]";
}

export function ownershipSourceLabelRepositoryTeams(): string {
  return "[Sources: GitHub repository teams]";
}

export function ownershipSourceLabelJira(): string {
  return "[Sources: Jira issues]";
}

export function ownershipSourceLabelSlackDiscussions(): string {
  return "[Sources: Slack discussions]";
}

export function listOwnershipSourceLabels(
  report: OwnershipReport,
  slackSearch?: { messages?: unknown[]; error?: string }
): string[] {
  const labels = [ownershipSourceLabelCodeHost(report.provider)];
  if (report.scores.some((score) => score.presence)) {
    labels.push(ownershipSourceLabelSlack());
  }
  if (slackSearch?.messages?.length) {
    labels.push(ownershipSourceLabelSlackDiscussions());
  }
  if (report.orgContext?.source === "codeowners") {
    labels.push(ownershipSourceLabelCodeowners());
  } else if (report.orgContext?.source === "github_teams") {
    labels.push(ownershipSourceLabelRepositoryTeams());
  }
  return labels;
}

export function listOwnershipSourcesChecklist(
  report: OwnershipReport,
  slackSearch?: { messages?: unknown[]; error?: string }
): string[] {
  const extra: string[] = [];
  const hasPresence = report.scores.some((score) => score.presence);
  const hasDiscussions = (slackSearch?.messages?.length ?? 0) > 0;
  if (hasPresence && !hasDiscussions) {
    extra.push(
      `${ownershipSourceLabelSlack()} — cite only the observed active/away status and identity qualifier; response availability is unverified (no Slack discussion messages were found).`
    );
  }
  return buildSourcesChecklistFromKeys(listOwnershipSourceLabels(report, slackSearch), extra);
}
