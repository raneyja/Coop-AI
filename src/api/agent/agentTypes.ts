export type AgentToolName =
  | "read_file"
  | "search_code"
  | "list_directory"
  | "git_blame"
  | "propose_patch";

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
};

export type AgentSessionResult = {
  steps: AgentStep[];
  /** Reserved for a future synthesized answer when the loop terminates without chat. */
  answer?: string;
  context?: AgentSessionContext;
};
