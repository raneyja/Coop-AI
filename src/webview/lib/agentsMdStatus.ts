import type { ProjectInstructionsState } from "../../chat/types";

export function agentsMdAttached(state?: ProjectInstructionsState): boolean {
  return Boolean(state?.hasAgentsMd);
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
