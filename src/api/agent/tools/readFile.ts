import { normalizeRelativePath } from "../../../context/localFileContext";
import type { AgentToolContext } from "../agentToolContext";
import { optionalPositiveInt, requireStringArg } from "./toolArgs";

export async function handleReadFile(
  ctx: AgentToolContext,
  args: Record<string, unknown>
): Promise<string> {
  const path = normalizeRelativePath(requireStringArg(args, "path"));
  const startLine = optionalPositiveInt(args, "startLine");
  const endLine = optionalPositiveInt(args, "endLine");
  const lines =
    startLine !== undefined || endLine !== undefined
      ? { start: startLine ?? 1, end: endLine ?? startLine ?? 1 }
      : undefined;

  // Zero-Clone: indexed / codehost only — never workspace absolute paths.
  const remote = await ctx.readRemoteFile?.({ path, repoId: args.repoId as string | undefined });
  if (remote?.content) {
    return JSON.stringify({
      path: remote.path,
      files: [{ path: remote.path, content: sliceLines(remote.content, lines) }]
    });
  }
  return JSON.stringify({ error: `Could not read file: ${path}` });
}

function sliceLines(content: string, lines?: { start: number; end: number }): string {
  if (!lines) {
    return content;
  }
  return content
    .split("\n")
    .slice(Math.max(0, lines.start - 1), lines.end)
    .join("\n");
}
