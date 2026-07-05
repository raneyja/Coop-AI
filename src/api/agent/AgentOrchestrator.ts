import type { AgentSessionRequest, AgentSessionResult, AgentStep } from "./agentTypes";
import { AGENT_TOOL_REGISTRY } from "./tools/registry";

const DEFAULT_MAX_STEPS = 8;

/**
 * Read-only agent loop skeleton (opt-in). LLM tool-use wiring is Phase 5 follow-up.
 */
export class AgentOrchestrator {
  public async run(request: AgentSessionRequest): Promise<AgentSessionResult> {
    const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
    const steps: AgentStep[] = [];
    void AGENT_TOOL_REGISTRY;
    void maxSteps;
    return { steps, answer: undefined };
  }
}
