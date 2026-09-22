import type { ContextFetchResult } from "../context/requestBatcher";
import { pathsReferToSameFile } from "../context/githubVfsUri";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  isolateContextBundleForTurn,
  type TurnIsolationScenario
} from "../workspace/repoEvidenceIsolation";

const PRESERVED_HUNT_KEYS = [
  "directDependents",
  "transitiveDependents",
  "dependentDetails",
  "docsReferences",
  "confluenceSearch",
  "notionSearch",
  "googleDocsSearch",
  "slackSearch",
  "teamsSearch",
  "jiraSearch",
  "confluence",
  "notion",
  "googleDocs",
  "slack",
  "teams",
  "jira"
];

function entryFile(entry: ContextFetchResult): string | undefined {
  const data = entry.data as { file?: string; timeline?: DecisionTimeline } | undefined;
  const file = data?.file?.trim();
  if (file) {
    return file;
  }
  return data?.timeline?.file?.trim() || undefined;
}

/** Preserved evidence for a different file must not keep that file's hunts or docs. */
function stripPreservedFileHunts(
  entry: ContextFetchResult,
  activeFile: string | undefined
): ContextFetchResult {
  const file = entryFile(entry);
  if (!activeFile?.trim() || !file || pathsReferToSameFile(file, activeFile)) {
    return entry;
  }
  const data = entry.data;
  if (!data || typeof data !== "object") {
    return entry;
  }
  const next = { ...(data as Record<string, unknown>) };
  for (const key of PRESERVED_HUNT_KEYS) {
    delete next[key];
  }
  return { ...entry, data: next };
}

/**
 * Preserve evidence types missing from a lighter follow-up fetch, then drop
 * integration hits that are not this turn's Use-repo.
 */
export function mergeContextBundleResults(
  previous: ContextFetchResult[],
  incoming: ContextFetchResult[],
  activeFile?: string,
  scenario?: TurnIsolationScenario
): ContextFetchResult[] {
  const incomingTypes = new Set(incoming.map((entry) => entry.type));
  const preserved = previous
    .filter((entry) => {
      if (incomingTypes.has(entry.type)) {
        return false;
      }
      if (entry.type === "decision_history" && activeFile?.trim()) {
        const timeline = (entry.data as { timeline?: DecisionTimeline } | undefined)?.timeline;
        if (timeline?.file?.trim() && !pathsReferToSameFile(timeline.file, activeFile)) {
          return false;
        }
      }
      return true;
    })
    .map((entry) => stripPreservedFileHunts(entry, activeFile));
  const merged = [...incoming, ...preserved];
  return isolateContextBundleForTurn(merged, {
    ...scenario,
    file: scenario?.file ?? activeFile
  });
}
