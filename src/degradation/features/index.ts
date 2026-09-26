import { resolveCodeHostProvider, type CodeHostProvider } from "../../api/codeHosts/types";
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

export function codeHostForDegradationRequest(request: ContextFetchRequest): CodeHostProvider | undefined {
  const provider = request.params.provider;
  const repoId = request.params.repoId;
  return resolveCodeHostProvider({
    provider: typeof provider === "string" ? provider : undefined,
    repoId: typeof repoId === "string" ? repoId : undefined
  });
}

export async function runFeatureFallback(options: FeatureDegradationOptions): Promise<ContextFetchResult | undefined> {
  const action = options.request.params.quickAction as QuickActionFeatureId | undefined;
  const codeHost = codeHostForDegradationRequest(options.request);
  if (!action) {
    // Plain-chat PR review requests ownership without a Find Owner click.
    if (options.request.type === "ownership") {
      const status = fallbackStatusForFeature("find-owner", options.health, codeHost);
      return ownershipMap({ ...options, status });
    }
    return undefined;
  }
  const feature = resolveFeatureForRequest(action, options.request.type);
  const status = fallbackStatusForFeature(action, options.health, codeHost);
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
