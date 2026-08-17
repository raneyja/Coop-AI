/**
 * Promote mid-loop integration tool results onto the standard bundle keys
 * used by synthesis formatters (`slackSearch`, `jiraSearch`, …).
 * Prefetch may already have filled those keys — keep both by preferring the
 * mid-loop payload when it has hits, else keep prefetch.
 */
import type { ContextFetchResult } from "../../context/requestBatcher";
import type { AgentSessionContext } from "./agentTypes";
import {
  AGENT_INTEGRATION_TOOLS,
  INTEGRATION_BUNDLE_KEY,
  type AgentIntegrationToolName
} from "./integrationTools";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasHits(payload: Record<string, unknown>): boolean {
  for (const key of ["messages", "issues", "pages", "documents", "pullRequests"]) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0) {
      return true;
    }
  }
  return false;
}

export function promoteAgentIntegrationSearches(result: ContextFetchResult): ContextFetchResult {
  const data = asRecord(result.data);
  const tools = data.agentTools as AgentSessionContext | undefined;
  if (!tools) {
    return result;
  }
  let mutated = false;
  for (const tool of Object.keys(AGENT_INTEGRATION_TOOLS) as AgentIntegrationToolName[]) {
    const mid = tools[tool];
    if (!mid || typeof mid !== "object") {
      continue;
    }
    const provider = AGENT_INTEGRATION_TOOLS[tool];
    const bundleKey = INTEGRATION_BUNDLE_KEY[provider];
    const existing = asRecord(data[bundleKey]);
    if (!hasHits(existing) || hasHits(mid)) {
      data[bundleKey] = mid;
      mutated = true;
    }
  }
  return mutated ? { ...result, data } : result;
}
