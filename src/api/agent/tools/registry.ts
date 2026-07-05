import type { AgentToolName } from "../agentTypes";

export type AgentToolHandler = (args: Record<string, unknown>) => Promise<string>;

/** Stub registry — wire to graph/org APIs in Phase 5 implementation. */
export const AGENT_TOOL_REGISTRY: Partial<Record<AgentToolName, AgentToolHandler>> = {
  read_file: async () => "[stub] read_file not implemented",
  search_code: async () => "[stub] search_code not implemented"
};
