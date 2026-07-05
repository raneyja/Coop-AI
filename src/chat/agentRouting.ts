import type { ContextFetchResult } from "../context/requestBatcher";

/** Returns true when plain chat should use the read-only agent loop instead of single-shot fetch. */
export function shouldUseAgentMode(options: {
  query: string;
  hasQuickAction: boolean;
  agentModeSetting: "off" | "auto" | "on";
  contextBundle?: ContextFetchResult[];
}): boolean {
  if (options.agentModeSetting === "off") {
    return false;
  }
  if (options.hasQuickAction) {
    return false;
  }
  if (options.agentModeSetting === "on") {
    return true;
  }
  // auto: future heuristics (cross-file questions, thin bundle)
  void options.query;
  void options.contextBundle;
  return false;
}
