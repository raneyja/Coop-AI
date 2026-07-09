export type AgentToolName = "read_file" | "search_code" | "list_directory" | "git_blame";

export type AgentStep = {
  index: number;
  tool: AgentToolName;
  summary: string;
  completed: boolean;
};

export type AgentSessionRequest = {
  message: string;
  repoId?: string;
  maxSteps?: number;
};

/** Tool payloads collected during a run — injected into chat context for the final LLM turn. */
export type AgentSessionContext = {
  search_code?: Record<string, unknown>;
  read_file?: Record<string, unknown>;
};

export type AgentSessionResult = {
  steps: AgentStep[];
  /** Reserved for a future synthesized answer when the loop terminates without chat. */
  answer?: string;
  context?: AgentSessionContext;
};
