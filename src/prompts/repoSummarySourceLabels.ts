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

export function repoSummarySourceLabelInventory(): string {
  return "[Sources: Repository inventory]";
}

export function repoSummarySourceLabelTree(): string {
  return "[Sources: Repository tree]";
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
  const inventory = summary.repoInventory;
  if (typeof inventory?.fileCount === "number" && inventory.fileCount > 0) {
    labels.push(repoSummarySourceLabelInventory());
  }
  const tree = summary.treeOverview as { topLevelDirs?: string[]; topLevelFiles?: string[] } | undefined;
  if (
    tree &&
    ((tree.topLevelDirs?.length ?? 0) > 0 || (tree.topLevelFiles?.length ?? 0) > 0)
  ) {
    labels.push(repoSummarySourceLabelTree());
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
  const labels = listRepoSummarySourceLabels(summary);
  const extras = labels.map((label) => `${label} — ${repoSummarySourceFact(label, summary)}`);
  return buildSourcesChecklistFromKeys(labels, extras);
}

/** One concrete fact for a Sources footer bullet — never generic "contributed insights" filler. */
export function repoSummarySourceFact(label: string, summary: RepoSummaryEvidence): string {
  const tree = summary.treeOverview as { topLevelDirs?: string[]; topLevelFiles?: string[] } | undefined;
  const inventory = summary.repoInventory;
  const manifest = summary.manifest;

  if (label === repoSummarySourceLabelInventory()) {
    if (typeof inventory?.fileCount === "number") {
      const lines =
        typeof inventory.lineCount === "number" ? ` · ${inventory.lineCount.toLocaleString()} lines` : "";
      return `${inventory.fileCount.toLocaleString()} indexed files${lines}`;
    }
    return "indexed file inventory";
  }

  if (label === repoSummarySourceLabelTree()) {
    const dirs = (tree?.topLevelDirs ?? [])
      .map((dir) => dir.replace(/\/$/, ""))
      .filter(Boolean)
      .slice(0, 5);
    if (dirs.length) {
      return `top-level ${dirs.join(", ")}`;
    }
    const files = (tree?.topLevelFiles ?? []).slice(0, 4);
    if (files.length) {
      return `root files ${files.join(", ")}`;
    }
    return "top-level repository layout";
  }

  if (label === repoSummarySourceLabelEntryFiles()) {
    const paths = (summary.entryFiles ?? []).map((file) => file.path).filter(Boolean).slice(0, 4);
    if (paths.length) {
      return `loaded ${paths.join(", ")}`;
    }
    return "anchor file contents";
  }

  if (label === repoSummarySourceLabelManifest()) {
    if (typeof manifest?.fileCount === "number") {
      return `manifest reports ${manifest.fileCount.toLocaleString()} files`;
    }
    if (typeof inventory?.fileCount === "number") {
      return `manifest/metadata for ${inventory.fileCount.toLocaleString()} files`;
    }
    return "repository metadata";
  }

  if (label === repoSummarySourceLabelConfluence()) {
    const count = summary.confluence?.pages?.length ?? 0;
    return count > 0 ? `${count} architecture page(s)` : "Confluence architecture pages";
  }
  if (label === repoSummarySourceLabelJira()) {
    const count = summary.jira?.issues?.length ?? 0;
    return count > 0 ? `${count} issue(s)` : "Jira issues";
  }
  if (label === repoSummarySourceLabelSlack()) {
    const count = summary.slack?.messages?.length ?? 0;
    return count > 0 ? `${count} message(s)` : "Slack discussions";
  }
  if (label === repoSummarySourceLabelTeams()) {
    const count = summary.teams?.messages?.length ?? 0;
    return count > 0 ? `${count} message(s)` : "Teams discussions";
  }
  if (label === repoSummarySourceLabelNotion()) {
    const count = summary.notion?.pages?.length ?? 0;
    return count > 0 ? `${count} page(s)` : "Notion pages";
  }
  if (label === repoSummarySourceLabelGoogleDocs()) {
    const count = summary.googleDocs?.documents?.length ?? 0;
    return count > 0 ? `${count} document(s)` : "Google Docs";
  }
  if (label === repoSummarySourceLabelOwnership()) {
    const primary = summary.ownershipReport?.scores?.find((score) => score.tier === "primary");
    if (primary?.owner) {
      return `primary owner ${primary.owner}`;
    }
    return "ownership scores";
  }
  if (label === repoSummarySourceLabelDependencies()) {
    const count = summary.dependencyGraph?.directDependents?.length ?? 0;
    return count > 0 ? `${count} direct dependent(s)` : "dependency graph";
  }

  return "summarize one concrete fact from this source";
}

/** True when the checklist is code-host grounded with no integration/doc hits. */
export function isGithubOnlyRepoSummaryEvidence(summary: RepoSummaryEvidence): boolean {
  return !(
    shouldIncludeIntegrationInSourcesChecklist(summary.confluence) ||
    shouldIncludeIntegrationInSourcesChecklist(summary.jira) ||
    shouldIncludeIntegrationInSourcesChecklist(summary.slack) ||
    shouldIncludeIntegrationInSourcesChecklist(summary.teams) ||
    shouldIncludeIntegrationInSourcesChecklist(summary.notion) ||
    shouldIncludeIntegrationInSourcesChecklist(summary.googleDocs)
  );
}
