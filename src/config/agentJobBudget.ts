/**
 * Agent-job budgets on the interactive chat path.
 *
 * Soft start-answering (~15s gather via `remainingContextGatherBudgetMs`) is for
 * all chat / quick actions, including agent-owned repository hunts.
 * `AGENT_JOB_WALL_MS` is an additional loop ceiling. AbortSignal remains user Stop only
 * (never a latency abort).
 */

/** Absolute ceiling for a repo-hunt tool loop (not the Q&A soft gather). */
export const AGENT_JOB_WALL_MS = 90_000;

/** Max model-chosen tool rounds per job (aligns with AgentOrchestrator DEFAULT_MAX_STEPS). */
export const AGENT_MAX_TOOL_ROUNDS = 8;

/** Max read_file executions per job. */
export const AGENT_MAX_FILES_READ = 10;
