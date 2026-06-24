import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import { shouldIncludeIntegrationInSourcesChecklist } from "../context/integrationEvidenceVisibility";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";

/** Auth / fetch plumbing — not repo architecture; hide from Repo Overview evidence. */
const REPO_SUMMARY_INFRA_WARNING_RE =
  /GitHub App|cloud backend|Install (the )?GitHub|Authorize GitLab|Authorize Bitbucket/i;

export function isRepoSummaryInfraWarning(warning: string): boolean {
  return REPO_SUMMARY_INFRA_WARNING_RE.test(warning);
}

export function filterRepoSummaryInfraWarnings(warnings: string[] | undefined): string[] {
  return (warnings ?? []).filter((warning) => !isRepoSummaryInfraWarning(warning));
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
