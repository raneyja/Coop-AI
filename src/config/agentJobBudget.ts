/**
 * Agent-job budgets on the interactive chat path.
 *
 * Soft start-answering (~15s gather via `remainingContextGatherBudgetMs`) is for
 * non-agent chat / quick actions. Agent-owned locate / understand / change turns
 * use `AGENT_JOB_WALL_MS` (not the 15s gather). AbortSignal remains user Stop only
 * (never a latency abort).
 */

/** Absolute ceiling for a repo-hunt tool loop (not the Q&A soft gather). */
export const AGENT_JOB_WALL_MS = 90_000;

/** Max model-chosen tool rounds per job (aligns with AgentOrchestrator DEFAULT_MAX_STEPS). */
export const AGENT_MAX_TOOL_ROUNDS = 8;

/** Max read_file executions per job. */
export const AGENT_MAX_FILES_READ = 10;

/** Compact activity: extra steps fold behind this cap. */
export const AGENT_MAX_VISIBLE_ACTIVITY_STEPS = 3;
