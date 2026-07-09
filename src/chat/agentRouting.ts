import type { ContextFetchResult } from "../context/requestBatcher";

const REPO_SEARCH_KEYWORDS =
  /\b(where|find|across|codebase|repo|which file|how does)\b/i;

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

  const query = options.query.trim();
  if (query.length >= 20 && REPO_SEARCH_KEYWORDS.test(query)) {
    return true;
  }
  if (contextBundleLacksRepoContext(options.contextBundle)) {
    return true;
  }
  return false;
}

function contextBundleLacksRepoContext(bundle?: ContextFetchResult[]): boolean {
  if (!bundle?.length) {
    return true;
  }
  for (const item of bundle) {
    const data = item.data as Record<string, unknown> | undefined;
    if (data?.repoSemanticSearch || data?.localFiles) {
      return false;
    }
  }
  return true;
}
