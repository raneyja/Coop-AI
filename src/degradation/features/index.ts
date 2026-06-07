import type { DegradationCache } from "../../cache/degradationCache";
import type { ContextFetchRequest, ContextFetchResult } from "../../context/requestBatcher";
import type { ContextRequestType } from "../../context/intentDetector";
import type { IntegrationHealth } from "../../integrations/healthMonitor";
import {
  fallbackStatusForFeature,
  normalizeFeatureId,
  type FeatureId,
  type QuickActionFeatureId
} from "../fallbackMatrix";
import { blastRadius } from "./blastRadius";
import { knowledgeGaps } from "./knowledgeGaps";
import { ownershipMap } from "./ownershipMap";
import { repoSummary } from "./repoSummary";
import { traceDecision } from "./traceDecision";

export type FeatureDegradationOptions = {
  request: ContextFetchRequest;
  health: IntegrationHealth[];
  cache: DegradationCache;
  now?: () => Date;
};

export async function runFeatureFallback(options: FeatureDegradationOptions): Promise<ContextFetchResult | undefined> {
  const action = options.request.params.quickAction as QuickActionFeatureId | undefined;
  if (!action) {
    return undefined;
  }
  const feature = resolveFeatureForRequest(action, options.request.type);
  const status = fallbackStatusForFeature(action, options.health);
  const context = { ...options, status };
  switch (feature) {
    case "trace_why":
      return traceDecision(context);
    case "ownership_map":
      return ownershipMap(context);
    case "blast_radius":
      return blastRadius(context);
    case "knowledge_gaps":
      return knowledgeGaps(context);
    case "repo_summary":
      return repoSummary(context);
  }
}

function resolveFeatureForRequest(action: QuickActionFeatureId, requestType: ContextRequestType): FeatureId {
  switch (action) {
    case "understand-repo":
      if (requestType === "ownership") {
        return "ownership_map";
      }
      if (requestType === "dependencies") {
        return "blast_radius";
      }
      return "repo_summary";
    case "find-owner":
      return "ownership_map";
    case "trace-decision":
      return "trace_why";
    case "blast-radius":
      return "blast_radius";
    case "knowledge-gaps":
      return "knowledge_gaps";
    default:
      return normalizeFeatureId(action);
  }
}
