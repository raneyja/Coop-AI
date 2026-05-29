import type { DegradationCache } from "../../cache/degradationCache";
import type { ContextFetchRequest, ContextFetchResult } from "../../context/requestBatcher";
import type { IntegrationHealth } from "../../integrations/healthMonitor";
import type { FeatureFallbackStatus } from "../fallbackMatrix";

export type FeatureExecutionContext = {
  request: ContextFetchRequest;
  health: IntegrationHealth[];
  cache: DegradationCache;
  status: FeatureFallbackStatus;
  now?: () => Date;
};

export type FeatureResultData = Record<string, unknown>;

export function contextResult(
  context: FeatureExecutionContext,
  data: FeatureResultData,
  message?: string,
  stale = false
): ContextFetchResult {
  return {
    requestId: context.request.id,
    type: context.request.type,
    data,
    message,
    stale,
    fetchedAt: context.now?.() ?? new Date()
  };
}

export function unavailableResult(context: FeatureExecutionContext, message: string): ContextFetchResult {
  return {
    requestId: context.request.id,
    type: context.request.type,
    error: message,
    message,
    fetchedAt: context.now?.() ?? new Date()
  };
}
