import type { OwnershipReport, OwnershipTier } from "../types/ownership";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";

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

export function ownershipSourceLabelGitHub(): string {
  return "[Sources: GitHub commits & reviews]";
}

export function ownershipSourceLabelSlack(): string {
  return "[Sources: Slack presence]";
}

export function ownershipSourceLabelCodeowners(): string {
  return "[Sources: CODEOWNERS]";
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
  const labels = [ownershipSourceLabelGitHub()];
  if (report.scores.some((score) => score.presence)) {
    labels.push(ownershipSourceLabelSlack());
  }
  if (slackSearch?.messages?.length) {
    labels.push(ownershipSourceLabelSlackDiscussions());
  }
  if (report.orgContext?.source === "codeowners") {
    labels.push(ownershipSourceLabelCodeowners());
  }
  return labels;
}

export function listOwnershipSourcesChecklist(
  report: OwnershipReport,
  slackSearch?: { messages?: unknown[]; error?: string }
): string[] {
  return buildSourcesChecklistFromKeys(listOwnershipSourceLabels(report, slackSearch));
}
