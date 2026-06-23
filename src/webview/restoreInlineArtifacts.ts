import type { ChatPersistedArtifact } from "../../chat/types";
import type { IntegrationChatProvider } from "../../chat/types";
import type {
  BlastRadiusEvidence,
  ConfluenceSearchEvidence,
  GoogleDocsSearchEvidence,
  JiraSearchEvidence,
  KnowledgeGapsEvidence,
  NotionSearchEvidence,
  RepoSummaryEvidence,
  SlackSearchEvidence
} from "../../context/contextBundleEvidence";
import type { ChatInlineArtifact } from "./components/ChatStream";
import type { DecisionTimelinePayload } from "./DecisionTimeline";
import type { OwnershipCardPayload } from "./OwnershipCard";

export function inlineArtifactsFromHistory(
  artifacts: ChatPersistedArtifact[] | undefined
): ChatInlineArtifact[] {
  if (!artifacts?.length) {
    return [];
  }
  return artifacts.flatMap((entry) => {
    const restored = restoreInlineArtifact(entry);
    return restored ? [restored] : [];
  });
}

function restoreInlineArtifact(entry: ChatPersistedArtifact): ChatInlineArtifact | undefined {
  const payload = entry.payload;
  switch (entry.kind) {
    case "decision":
      return {
        id: entry.id,
        kind: "decision",
        timestamp: entry.timestamp,
        timeline: payload.timeline as DecisionTimelinePayload
      };
    case "ownership":
      return {
        id: entry.id,
        kind: "ownership",
        timestamp: entry.timestamp,
        report: payload.report as OwnershipCardPayload,
        slackSearch: payload.slackSearch as SlackSearchEvidence | undefined
      };
    case "repo-summary":
      return {
        id: entry.id,
        kind: "repo-summary",
        timestamp: entry.timestamp,
        evidence: payload.evidence as RepoSummaryEvidence,
        owner: String(payload.owner ?? ""),
        repo: String(payload.repo ?? ""),
        branch: payload.branch as string | undefined
      };
    case "blast-radius":
      return {
        id: entry.id,
        kind: "blast-radius",
        timestamp: entry.timestamp,
        evidence: payload.evidence as BlastRadiusEvidence,
        file: String(payload.file ?? "")
      };
    case "knowledge-gaps":
      return {
        id: entry.id,
        kind: "knowledge-gaps",
        timestamp: entry.timestamp,
        evidence: payload.evidence as KnowledgeGapsEvidence,
        confluence: payload.confluence as ConfluenceSearchEvidence | undefined,
        jira: payload.jira as JiraSearchEvidence | undefined,
        slack: payload.slack as SlackSearchEvidence | undefined,
        notion: payload.notion as NotionSearchEvidence | undefined,
        googleDocs: payload.googleDocs as GoogleDocsSearchEvidence | undefined,
        teams: payload.teams as TeamsSearchEvidence | undefined,
        file: payload.file as string | undefined
      };
    case "integration":
      return {
        id: entry.id,
        kind: "integration",
        timestamp: entry.timestamp,
        provider: payload.provider as IntegrationChatProvider,
        evidence: payload.evidence as Record<string, unknown>
      };
    default:
      return undefined;
  }
}
