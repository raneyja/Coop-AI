import type { KnowledgeGapsEvidence } from "../context/contextBundleEvidence";
import type { ConfluenceSearchEvidence } from "../context/contextBundleEvidence";
import { shouldIncludeIntegrationInSourcesChecklist } from "../context/integrationEvidenceVisibility";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";

export function knowledgeGapsSourceLabelScan(): string {
  return "[Sources: Knowledge gap scan]";
}

export function knowledgeGapsSourceLabelConfluence(): string {
  return "[Sources: Confluence pages]";
}

export function knowledgeGapsSourceLabelOwnership(): string {
  return "[Sources: Ownership signals]";
}

export function knowledgeGapsSourceLabelDependencies(): string {
  return "[Sources: Dependency graph]";
}

export function knowledgeGapsSourceLabelJira(): string {
  return "[Sources: Jira issues]";
}

export function knowledgeGapsSourceLabelSlack(): string {
  return "[Sources: Slack discussions]";
}

export function knowledgeGapsSourceLabelTeams(): string {
  return "[Sources: Teams discussions]";
}

export function knowledgeGapsSourceLabelNotion(): string {
  return "[Sources: Notion pages]";
}

export function knowledgeGapsSourceLabelGoogleDocs(): string {
  return "[Sources: Google Docs]";
}

export function knowledgeGapsSourceLabelLimited(): string {
  return "[Sources: Evidence limited]";
}

export function listKnowledgeGapsSourceLabels(
  evidence: KnowledgeGapsEvidence,
  confluence?: ConfluenceSearchEvidence,
  jira?: { issues?: unknown[]; error?: string },
  slack?: { messages?: unknown[]; error?: string },
  notion?: { pages?: unknown[]; error?: string },
  googleDocs?: { documents?: unknown[]; error?: string },
  teams?: { messages?: unknown[]; error?: string }
): string[] {
  const labels: string[] = [];
  if (evidence.jobScan) {
    labels.push(knowledgeGapsSourceLabelScan());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(confluence)) {
    labels.push(knowledgeGapsSourceLabelConfluence());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(jira)) {
    labels.push(knowledgeGapsSourceLabelJira());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(slack)) {
    labels.push(knowledgeGapsSourceLabelSlack());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(teams)) {
    labels.push(knowledgeGapsSourceLabelTeams());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(notion)) {
    labels.push(knowledgeGapsSourceLabelNotion());
  }
  if (shouldIncludeIntegrationInSourcesChecklist(googleDocs)) {
    labels.push(knowledgeGapsSourceLabelGoogleDocs());
  }
  if ((evidence.ownershipReport?.scores?.length ?? 0) > 0) {
    labels.push(knowledgeGapsSourceLabelOwnership());
  }
  if (
    (evidence.dependencyGraph?.directDependents?.length ?? 0) > 0 ||
    (evidence.dependencyGraph?.edgeCount ?? 0) > 0
  ) {
    labels.push(knowledgeGapsSourceLabelDependencies());
  }
  if (labels.length === 0) {
    labels.push(evidence.jobScan ? knowledgeGapsSourceLabelScan() : knowledgeGapsSourceLabelLimited());
  }
  return labels;
}

export function listKnowledgeGapsSourcesChecklist(
  evidence: KnowledgeGapsEvidence,
  confluence?: ConfluenceSearchEvidence,
  jira?: { issues?: unknown[]; error?: string },
  slack?: { messages?: unknown[]; error?: string },
  notion?: { pages?: unknown[]; error?: string },
  googleDocs?: { documents?: unknown[]; error?: string },
  teams?: { messages?: unknown[]; error?: string }
): string[] {
  const extra: string[] = [];
  if (!evidence.jobScan) {
    extra.push(
      `${knowledgeGapsSourceLabelLimited()} — No automated scan attached; audit is limited to integration and ownership evidence fetched.`
    );
  }
  return buildSourcesChecklistFromKeys(
    listKnowledgeGapsSourceLabels(evidence, confluence, jira, slack, notion, googleDocs, teams),
    extra
  );
}
