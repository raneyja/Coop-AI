import {
  normalizeRelativePath,
  readLocalWorkspaceFiles,
  readWorkspaceFileFromAbsolutePath
} from "../../../context/localFileContext";
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

  const absolutePath = ctx.resolveAbsolutePath(path);
  if (!absolutePath) {
    return JSON.stringify({ error: `Could not resolve path: ${path}` });
  }

  const payload = lines
    ? readWorkspaceFileFromAbsolutePath(absolutePath, path, lines)
    : await readLocalWorkspaceFiles({
        file: path,
        fileSource: "workspace",
        resolveAbsolutePath: () => absolutePath,
        maxFiles: 1,
        lines
      });

  if (!payload?.files.length) {
    return JSON.stringify({ error: `Could not read file: ${path}` });
  }

  return JSON.stringify({
    path,
    files: payload.files.map((file) => ({
      path: file.path,
      content: file.content,
      ...(file.lineRange ? { lineRange: file.lineRange } : {})
    }))
  });
}
