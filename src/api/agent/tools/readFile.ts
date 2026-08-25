import { normalizeRelativePath } from "../../../context/localFileContext";
import type { AgentToolContext } from "../agentToolContext";
import { optionalPositiveInt, requireStringArg } from "./toolArgs";

/** Minimum lines to return when the model asked for a window. A 1-line
 *  `startLine: 1` read is the copyright header — never a definition. */
export const MIN_READ_SPAN = 50;

/**
 * Expand a thin or one-sided line window. Omit both to read the whole file.
 */
export function expandReadLineRange(
  startLine?: number,
  endLine?: number
): { start: number; end: number } | undefined {
  if (startLine === undefined && endLine === undefined) {
    return undefined;
  }
  const start = startLine !== undefined && startLine >= 1 ? startLine : 1;
  const rawEnd = endLine !== undefined && endLine >= start ? endLine : start;
  return { start, end: Math.max(rawEnd, start + MIN_READ_SPAN - 1) };
}

export async function handleReadFile(
  ctx: AgentToolContext,
  args: Record<string, unknown>
): Promise<string> {
  const path = normalizeRelativePath(requireStringArg(args, "path"));
  const startLine = optionalPositiveInt(args, "startLine");
  const endLine = optionalPositiveInt(args, "endLine");
  const lines = expandReadLineRange(startLine, endLine);

  // Zero-Clone: indexed / codehost only — never workspace absolute paths.
  const remote = await ctx.readRemoteFile?.({ path, repoId: args.repoId as string | undefined });
  if (remote?.content) {
    const start = lines?.start ?? 1;
    return JSON.stringify({
      path: remote.path,
      startLine: start,
      files: [{ path: remote.path, content: numberReadLines(sliceLines(remote.content, lines), start) }]
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

/** Prefix each row with the real file line so citations are not 1-based snippet offsets. */
export function numberReadLines(content: string, startLine: number): string {
  const start = Number.isInteger(startLine) && startLine > 0 ? startLine : 1;
  return content.split("\n").map((row, index) => `${start + index}|${row}`).join("\n");
}

/** SEARCH/REPLACE must match the file, not the N| prefixes from read_file. */
export function stripReadLinePrefixes(text: string): string {
  return text.replace(/^\d+\|/gm, "");
}
