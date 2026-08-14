/**
 * Agent-job budgets — separate from Q&A soft gather.
 *
 * `MAX_USER_FACING_RESPONSE_MS` (~15s) is the start-answering guideline for plain
 * chat and quick actions. It must not cap or abort an opted-in agent job.
 * See docs/agent-ship-loop-build-plan.md (Wave 1 / UX freeze).
 */

/** Wall clock for an opted-in repo-hunt tool loop (activity is visible). */
export const AGENT_JOB_WALL_MS = 90_000;

/** Max model-chosen tool rounds per job (aligns with AgentOrchestrator DEFAULT_MAX_STEPS). */
export const AGENT_MAX_TOOL_ROUNDS = 8;

/** Max read_file executions per job. */
export const AGENT_MAX_FILES_READ = 10;

/** Compact activity: extra steps fold behind this cap. */
export const AGENT_MAX_VISIBLE_ACTIVITY_STEPS = 3;
