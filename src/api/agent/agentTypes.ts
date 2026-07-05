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

export type AgentSessionResult = {
  steps: AgentStep[];
  answer?: string;
};
