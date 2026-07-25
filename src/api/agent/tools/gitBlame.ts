import { normalizeRelativePath } from "../../../context/localFileContext";
import type { AgentToolContext } from "../agentToolContext";
import { optionalStringArg, requireStringArg } from "./toolArgs";

export async function handleGitBlame(
  ctx: AgentToolContext,
  args: Record<string, unknown>
): Promise<string> {
  const path = normalizeRelativePath(requireStringArg(args, "path"));
  const repoId = optionalStringArg(args, "repoId");

  if (!ctx.getBlame) {
    return JSON.stringify({
      error: "git_blame is not available in this session (no code-host blame access).",
      path,
      repoId
    });
  }

  try {
    const blame = await ctx.getBlame({ path, repoId });
    return JSON.stringify({
      sampleNote: "Blame ranges for the requested file only — not a repository-wide ownership inventory.",
      ...blame,
      path
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to fetch blame",
      path,
      repoId
    });
  }
}
