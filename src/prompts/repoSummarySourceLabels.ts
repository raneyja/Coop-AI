import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import { shouldIncludeIntegrationInSourcesChecklist } from "../context/integrationEvidenceVisibility";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";

/**
 * Previously hid GitHub App / code-host install errors from Repo Overview.
 * Those messages are product-honest for remote users — keep them visible.
 * (Function retained so call sites stay stable; it is now a passthrough.)
 */
export function isRepoSummaryInfraWarning(_warning: string): boolean {
  return false;
}

export function filterRepoSummaryInfraWarnings(warnings: string[] | undefined): string[] {
  return warnings ?? [];
}

export function repoSummarySourceLabelManifest(): string {
  return "[Sources: Repository manifest]";
}

export function repoSummarySourceLabelEntryFiles(): string {
  return "[Sources: Anchor files]";
}

export function repoSummarySourceLabelOwnership(): string {
  return "[Sources: Ownership signals]";
}

export function repoSummarySourceLabelDependencies(): string {
  return "[Sources: Dependency graph]";
}

export function repoSummarySourceLabelConfluence(): string {
  return "[Sources: Confluence architecture]";
}

export function repoSummarySourceLabelJira(): string {
  return "[Sources: Jira issues]";
}

export function repoSummarySourceLabelSlack(): string {
  return "[Sources: Slack discussions]";
}

export function repoSummarySourceLabelTeams(): string {
  return "[Sources: Teams discussions]";
}

export function repoSummarySourceLabelNotion(): string {
  return "[Sources: Notion pages]";
}

export function repoSummarySourceLabelGoogleDocs(): string {
  return "[Sources: Google Docs]";
}

export function listRepoSummarySourceLabels(summary: RepoSummaryEvidence): string[] {
  const labels: string[] = [];
  if (summary.manifest || summary.repository) {
    labels.push(repoSummarySourceLabelManifest());
  }
  if (summary.entryFiles?.length) {
    labels.push(repoSummarySourceLabelEntryFiles());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(summary.confluence)) {
    labels.push(repoSummarySourceLabelConfluence());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(summary.jira)) {
    labels.push(repoSummarySourceLabelJira());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(summary.slack)) {
    labels.push(repoSummarySourceLabelSlack());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(summary.teams)) {
    labels.push(repoSummarySourceLabelTeams());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(summary.notion)) {
    labels.push(repoSummarySourceLabelNotion());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(summary.googleDocs)) {
    labels.push(repoSummarySourceLabelGoogleDocs());
  }
  if ((summary.ownershipReport?.scores?.length ?? 0) > 0) {
    labels.push(repoSummarySourceLabelOwnership());
  }
  if ((summary.dependencyGraph?.directDependents?.length ?? 0) > 0) {
    labels.push(repoSummarySourceLabelDependencies());
  }
  return labels;
}

export function listRepoSummarySourcesChecklist(summary: RepoSummaryEvidence): string[] {
  return buildSourcesChecklistFromKeys(listRepoSummarySourceLabels(summary));
}
