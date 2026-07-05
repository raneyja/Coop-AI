import type { ContextFetchResult } from "../context/requestBatcher";
import type { ChatPersistedArtifact, IntegrationChatProvider } from "./types";

function integrationSearchKey(provider: IntegrationChatProvider): string {
  switch (provider) {
    case "jira":
      return "jiraSearch";
    case "slack":
      return "slackSearch";
    case "teams":
      return "teamsSearch";
    case "confluence":
      return "confluenceSearch";
    case "notion":
      return "notionSearch";
    case "google-docs":
      return "googleDocsSearch";
  }
}

function artifactToBundleEntry(artifact: ChatPersistedArtifact): ContextFetchResult | undefined {
  const fetchedAt = new Date(artifact.timestamp);
  const payload = artifact.payload;

  switch (artifact.kind) {
    case "decision": {
      const timeline = payload.timeline;
      if (!timeline) {
        return undefined;
      }
      return { requestId: artifact.id, type: "decision_history", data: { timeline }, fetchedAt };
    }
    case "ownership": {
      const report = payload.report;
      if (!report) {
        return undefined;
      }
      return {
        requestId: artifact.id,
        type: "ownership",
        data: { report, slackSearch: payload.slackSearch },
        fetchedAt
      };
    }
    case "repo-summary": {
      const evidence = payload.evidence;
      if (!evidence || typeof evidence !== "object") {
        return undefined;
      }
      return {
        requestId: artifact.id,
        type: "file_metadata",
        data: evidence as Record<string, unknown>,
        fetchedAt
      };
    }
    case "blast-radius": {
      const evidence =
        payload.evidence && typeof payload.evidence === "object"
          ? (payload.evidence as Record<string, unknown>)
          : payload.file
            ? { file: payload.file }
            : undefined;
      if (!evidence) {
        return undefined;
      }
      return { requestId: artifact.id, type: "dependencies", data: evidence, fetchedAt };
    }
    case "knowledge-gaps": {
      const data: Record<string, unknown> =
        payload.evidence && typeof payload.evidence === "object"
          ? { ...(payload.evidence as Record<string, unknown>) }
          : {};
      if (payload.file) {
        data.file = payload.file;
      }
      if (payload.confluence) {
        data.confluenceSearch = payload.confluence;
      }
      if (payload.jira) {
        data.jiraSearch = payload.jira;
      }
      if (payload.slack) {
        data.slackSearch = payload.slack;
      }
      if (payload.notion) {
        data.notionSearch = payload.notion;
      }
      if (payload.googleDocs) {
        data.googleDocsSearch = payload.googleDocs;
      }
      if (payload.teams) {
        data.teamsSearch = payload.teams;
      }
      return { requestId: artifact.id, type: "knowledge_gaps", data, fetchedAt };
    }
    case "integration": {
      const provider = payload.provider as IntegrationChatProvider | undefined;
      const evidence = payload.evidence;
      if (!provider || !evidence) {
        return undefined;
      }
      return {
        requestId: artifact.id,
        type: "chat_context",
        data: { [integrationSearchKey(provider)]: evidence },
        fetchedAt
      };
    }
    default:
      return undefined;
  }
}

/** Rebuild a minimal context bundle from the latest persisted evidence per kind. */
export function hydrateContextBundleFromArtifacts(
  artifacts: ChatPersistedArtifact[]
): ContextFetchResult[] {
  const latestByKind = new Map<ChatPersistedArtifact["kind"], ChatPersistedArtifact>();
  for (const artifact of artifacts) {
    latestByKind.set(artifact.kind, artifact);
  }
  return [...latestByKind.values()]
    .map(artifactToBundleEntry)
    .filter((entry): entry is ContextFetchResult => entry !== undefined);
}
