import type { DegradationCache } from "../../cache/degradationCache";
import type { ContextFetchRequest, ContextFetchResult } from "../../context/requestBatcher";
import type { IntegrationHealth } from "../../integrations/healthMonitor";
import {
  fallbackStatusForFeature,
  type QuickActionFeatureId
} from "../fallbackMatrix";
import { blastRadius } from "./blastRadius";
import { knowledgeGaps } from "./knowledgeGaps";
import { ownershipMap } from "./ownershipMap";
import { repoSummary } from "./repoSummary";
import { traceDecision } from "./traceDecision";
import { resolveFeatureForRequest } from "./resolveFeatureForRequest";

export { resolveFeatureForRequest } from "./resolveFeatureForRequest";

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
