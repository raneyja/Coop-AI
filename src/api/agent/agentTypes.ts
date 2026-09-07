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

/** One turn in the agent conversation (tool JSON or tool result). */
export type AgentConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentPlanTurnInput = {
  message: string;
  repoId: string;
  round: number;
  priorSteps: AgentStep[];
  lastToolResult?: string;
  conversation: AgentConversationMessage[];
  /** Planner allowlist for this turn — mid-loop may only call these. */
  allowedIntegrations?: IntegrationChatProvider[];
};

/**
 * Same-conversation turn that picks the next repo tool.
 * Returns JSON: {tool, args} or {done:true}.
 */
export type AgentPlanTurnFn = (input: AgentPlanTurnInput) => Promise<string>;

export type AgentStreamAnswerInput = {
  message: string;
  repoId: string;
  conversation: AgentConversationMessage[];
  action?: "locate" | "understand" | "change" | "none";
};

/** Same conversation, next turn: stream the user-visible answer. */
export type AgentStreamAnswerFn = (input: AgentStreamAnswerInput) => Promise<string>;

export type AgentSessionRequest = {
  message: string;
  repoId?: string;
  maxSteps?: number;
  /**
   * What the turn is for. Locate / understand / change all run the same
   * conversation: tools then the user-visible answer. Deterministic hunt is
   * only the no-planTurn fallback (tests / fail-open).
   */
  action?: "locate" | "understand" | "change" | "none";
  /** Open file chip — seed `read_file` on ticket-style feature-add so we do not hunt the new token. */
  openFile?: string;
};

/** Tool payloads collected during a run — used for the Apply-card bridge. */
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
  /** User-visible answer from the same conversation (when streamAnswer ran). */
  answer?: string;
  context?: AgentSessionContext;
};
