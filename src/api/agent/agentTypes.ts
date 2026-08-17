import type { IntegrationChatProvider } from "../../chat/types";

export type AgentToolName =
  | "read_file"
  | "search_code"
  | "list_directory"
  | "git_blame"
  | "propose_patch"
  | "search_slack"
  | "search_jira"
  | "search_teams"
  | "search_notion"
  | "search_confluence"
  | "search_google_docs";

export type AgentStep = {
  index: number;
  tool: AgentToolName;
  summary: string;
  completed: boolean;
};

export type AgentPlanTurnInput = {
  message: string;
  repoId: string;
  round: number;
  priorSteps: AgentStep[];
  lastToolResult?: string;
  /** Planner allowlist for this turn — mid-loop may only call these. */
  allowedIntegrations?: IntegrationChatProvider[];
};

/** Cheap model turn that returns JSON: {tool, args} or {done:true}. */
export type AgentPlanTurnFn = (input: AgentPlanTurnInput) => Promise<string>;

export type AgentSessionRequest = {
  message: string;
  repoId?: string;
  maxSteps?: number;
};

/** Tool payloads collected during a run — injected into chat context for the final LLM turn. */
export type AgentSessionContext = {
  search_code?: Record<string, unknown>;
  read_file?: Record<string, unknown>;
  list_directory?: Record<string, unknown>;
  git_blame?: Record<string, unknown>;
  /** SEARCH/REPLACE text for the Patch card — never auto-applied. */
  propose_patch?: Record<string, unknown>;
  search_slack?: Record<string, unknown>;
  search_jira?: Record<string, unknown>;
  search_teams?: Record<string, unknown>;
  search_notion?: Record<string, unknown>;
  search_confluence?: Record<string, unknown>;
  search_google_docs?: Record<string, unknown>;
};

export type AgentSessionResult = {
  steps: AgentStep[];
  /** Reserved for a future synthesized answer when the loop terminates without chat. */
  answer?: string;
  context?: AgentSessionContext;
};
