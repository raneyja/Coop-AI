import { normalizeRelativePath } from "../../../context/localFileContext";
import type { AgentToolContext } from "../agentToolContext";
import { optionalStringArg, requireStringArg } from "./toolArgs";

export async function handleListDirectory(
  ctx: AgentToolContext,
  args: Record<string, unknown>
): Promise<string> {
  const rawPath = typeof args.path === "string" ? args.path : "";
  const path = rawPath.trim() ? normalizeRelativePath(rawPath) : "";
  const repoId = optionalStringArg(args, "repoId");

  if (!ctx.listDirectory) {
    return JSON.stringify({
      error: "list_directory is not available in this session (no code-host or workspace tree access).",
      path,
      repoId
    });
  }

  try {
    const result = await ctx.listDirectory({ path, repoId });
    return JSON.stringify({
      path: result.path,
      branch: result.branch,
      entryCount: result.entries.length,
      sampleNote:
        "Directory listing for one path only — not a recursive inventory of the whole repository.",
      entries: result.entries
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to list directory",
      path,
      repoId
    });
  }
}
