import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import { shouldIncludeIntegrationInSourcesChecklist } from "../context/integrationEvidenceVisibility";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";

export function blastRadiusSourceLabelDependencies(): string {
  return "[Sources: Dependency graph]";
}

export function blastRadiusSourceLabelLocalFiles(): string {
  return "[Sources: Local workspace files]";
}

export function blastRadiusSourceLabelOpenPrs(): string {
  return "[Sources: Open pull requests]";
}

export function blastRadiusSourceLabelCodeowners(): string {
  return "[Sources: CODEOWNERS]";
}

export function blastRadiusSourceLabelTests(): string {
  return "[Sources: Test files]";
}

export function blastRadiusSourceLabelPublicApi(): string {
  return "[Sources: Public API]";
}

export function blastRadiusSourceLabelRecentChanges(): string {
  return "[Sources: Recent changes]";
}

export function blastRadiusSourceLabelCiWorkflows(): string {
  return "[Sources: CI workflows]";
}

export function blastRadiusSourceLabelCrossRepo(): string {
  return "[Sources: Cross-repo consumers]";
}

export function blastRadiusSourceLabelJira(): string {
  return "[Sources: Jira issues]";
}

export function blastRadiusSourceLabelConfluence(): string {
  return "[Sources: Confluence pages]";
}

export function blastRadiusSourceLabelDocsReferences(): string {
  return "[Sources: Docs references]";
}

export function blastRadiusSourceLabelSlack(): string {
  return "[Sources: Slack discussions]";
}

export function blastRadiusSourceLabelNotion(): string {
  return "[Sources: Notion pages]";
}

export function blastRadiusSourceLabelGoogleDocs(): string {
  return "[Sources: Google Docs]";
}

export function blastRadiusSourceLabelTeams(): string {
  return "[Sources: Teams discussions]";
}

export function listBlastRadiusSourceLabels(evidence: BlastRadiusEvidence): string[] {
  const labels: string[] = [];
  if (evidence.directDependents?.length || evidence.transitiveDependents?.length || evidence.graphMeta) {
    labels.push(blastRadiusSourceLabelDependencies());
  }
  if (evidence.docsReferences?.length) {
    labels.push(blastRadiusSourceLabelDocsReferences());
  }
  if (evidence.testFiles?.length) {
    labels.push(blastRadiusSourceLabelTests());
  }
  if (evidence.publicExports?.length) {
    labels.push(blastRadiusSourceLabelPublicApi());
  }
  if (evidence.recentChanges?.length) {
    labels.push(blastRadiusSourceLabelRecentChanges());
  }
  if (evidence.openPullRequests?.length) {
    labels.push(blastRadiusSourceLabelOpenPrs());
  }
  if (evidence.ciWorkflows?.length) {
    labels.push(blastRadiusSourceLabelCiWorkflows());
  }
  if (evidence.crossRepoConsumers?.length) {
    labels.push(blastRadiusSourceLabelCrossRepo());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(evidence.jiraSearch)) {
    labels.push(blastRadiusSourceLabelJira());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(evidence.confluenceSearch)) {
    labels.push(blastRadiusSourceLabelConfluence());
  }
  if (evidence.ownersByFile?.length) {
    labels.push(blastRadiusSourceLabelCodeowners());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(evidence.slackSearch)) {
    labels.push(blastRadiusSourceLabelSlack());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(evidence.notionSearch)) {
    labels.push(blastRadiusSourceLabelNotion());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(evidence.googleDocsSearch)) {
    labels.push(blastRadiusSourceLabelGoogleDocs());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(evidence.teamsSearch)) {
    labels.push(blastRadiusSourceLabelTeams());
  }
  if (evidence.localFiles?.files?.length) {
    labels.push(blastRadiusSourceLabelLocalFiles());
  }
  if (labels.length === 0) {
    labels.push(blastRadiusSourceLabelDependencies());
  }
  return labels;
}

export function hasPartialIndexCoverage(evidence: BlastRadiusEvidence): boolean {
  if (evidence.graphMeta?.lightningEnabled === false) {
    return true;
  }
  if (evidence.completeness === "partial" || evidence.completeness === "minimal") {
    return true;
  }
  return (evidence.warnings ?? []).some((warning) =>
    /partial|lightning|index|unverified|not found in index/i.test(warning)
  );
}

export function listBlastRadiusSourcesChecklist(evidence: BlastRadiusEvidence): string[] {
  const dependencyNotes: string[] = [];
  if (hasPartialIndexCoverage(evidence)) {
    dependencyNotes.push("Index coverage is partial; dependency impact may be incomplete.");
  }
  if (!evidence.directDependents?.length && !evidence.transitiveDependents?.length) {
    dependencyNotes.push(
      "Impact unverified: no dependents found in index. Do not claim zero impact; state evidence is missing."
    );
  }
  const extra: string[] = [];
  if (dependencyNotes.length > 0) {
    extra.push(`${blastRadiusSourceLabelDependencies()} — ${dependencyNotes.join(" ")}`);
  }
  return buildSourcesChecklistFromKeys(listBlastRadiusSourceLabels(evidence), extra);
}
