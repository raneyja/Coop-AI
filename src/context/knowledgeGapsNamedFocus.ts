import { extractNamedSourceFiles } from "../api/agent/searchQuery";
import { locateJobTerms } from "../chat/intentPlanner/planChatJobs";
import type { ChatIntentJob } from "../chat/intentPlanner/types";
import type { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";

/** Explicit file audit targets bypass semantic ranking, using the remote workspace only. */
export async function readKnowledgeGapsNamedFocus(options: {
  query?: string;
  jobs?: ChatIntentJob[];
  target: RepoTarget;
  workspace: Pick<IndexedRepoWorkspace, "readFile">;
}): Promise<{ namedPaths: string[]; files: Array<{ path: string; content: string; repoId: string; truncated?: boolean; startLine: number }> }> {
  const namedPaths = [...new Set([
    ...extractNamedSourceFiles(options.query ?? ""),
    ...locateJobTerms(options.jobs).flatMap(extractNamedSourceFiles)
  ])].slice(0, 5);
  const bodies = await Promise.all(namedPaths.map(async (path) => {
    try {
      const evidence = await options.workspace.readFile(options.target, path);
      return evidence?.origin === "remote" && evidence.content.trim() ? evidence : undefined;
    } catch {
      return undefined;
    }
  }));
  return {
    namedPaths,
    files: bodies.flatMap((body) => body ? [{ path: body.path, content: body.content, repoId: body.repoId, truncated: body.truncated, startLine: 1 }] : [])
  };
}
