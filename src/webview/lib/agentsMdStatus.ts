import type { ProjectInstructionsState } from "../../chat/types";

export function agentsMdAttached(state?: ProjectInstructionsState): boolean {
  return Boolean(state?.hasAgentsMd);
}

/**
 * Create / Upload card. Off for Use-repo (even when the repo file is missing)
 * and for an L file with no personal upload. On only for a signed-in account
 * that can add a personal file and does not have one yet.
 */
export function shouldPromptForAgentsMd(state?: ProjectInstructionsState): boolean {
  if (!state || state.status === "disabled") {
    return false;
  }
  if (state.source === "repo") {
    return false;
  }
  if (state.hasAgentsMd) {
    return false;
  }
  if (state.canMutate === false) {
    return false;
  }
  return state.status === "missing" || state.status === "no_git";
}

/** Personal upload/create only — Use-repo AGENTS.md cannot be removed from Settings. */
export function canDetachAgentsMd(state?: ProjectInstructionsState): boolean {
  if (!agentsMdAttached(state)) {
    return false;
  }
  if (state?.source === "repo") {
    return false;
  }
  if (state?.canMutate === false) {
    return false;
  }
  return true;
}
