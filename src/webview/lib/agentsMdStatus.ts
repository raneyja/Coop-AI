import type { ProjectInstructionsState } from "../../chat/types";

export function agentsMdAttached(state?: ProjectInstructionsState): boolean {
  return Boolean(state?.hasAgentsMd);
}

export function shouldPromptForAgentsMd(state?: ProjectInstructionsState): boolean {
  if (!state || state.status === "disabled") {
    return false;
  }
  if (state.source === "repo") {
    return false;
  }
  if (state.canMutate === false) {
    return false;
  }
  return !state.hasAgentsMd;
}

export function agentsMdStatusTitle(state?: ProjectInstructionsState): string {
  if (state?.source === "repo") {
    return agentsMdAttached(state)
      ? "AGENTS.md from this repo is loaded on every chat turn."
      : "This repo has no AGENTS.md yet.";
  }
  if (agentsMdAttached(state)) {
    if (state?.attachedAgentsMdLabel) {
      return `AGENTS.md is attached (${state.attachedAgentsMdLabel}) and loaded on every chat turn.`;
    }
    return "Your AGENTS.md is loaded on every chat turn.";
  }
  if (state?.canMutate === false) {
    return "Sign in to create or upload AGENTS.md.";
  }
  return "Create AGENTS.md or upload an existing file.";
}
