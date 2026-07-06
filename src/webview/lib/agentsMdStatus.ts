import type { ProjectInstructionsState } from "../../chat/types";

export function agentsMdAttached(state?: ProjectInstructionsState): boolean {
  return Boolean(state?.hasAgentsMd);
}

export function shouldPromptForAgentsMd(state?: ProjectInstructionsState): boolean {
  if (!state || state.status === "disabled") {
    return false;
  }
  return !state.hasAgentsMd;
}

export function agentsMdStatusTitle(state?: ProjectInstructionsState): string {
  if (agentsMdAttached(state)) {
    if (state?.attachedAgentsMdLabel) {
      return `AGENTS.md is attached (${state.attachedAgentsMdLabel}) and loaded on every chat turn.`;
    }
    return "AGENTS.md from your repo is loaded on every chat turn.";
  }
  return "Create AGENTS.md or attach an existing file.";
}
