import type { ChatFileMention, RepoContext } from "../chat/types";
import { WORKSPACE_LOCAL_REPO_ID } from "../chat/mentionSearchMerge";

export function mentionKey(mention: Pick<ChatFileMention, "repoId" | "path">): string {
  return `${mention.repoId}:${normalizeMentionPath(mention.path)}`;
}

export function normalizeMentionPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function shortMentionSourceLabel(mention: ChatFileMention): string {
  if (mention.source === "local" || mention.repoId === WORKSPACE_LOCAL_REPO_ID) {
    return "Local Workspace";
  }
  const match = mention.repoId.match(/^(?:github|gitlab|bitbucket):(.+)$/i);
  return match?.[1] ?? mention.repoId;
}

/**
 * After snapping to a live editor file, drop mentions that still point at the
 * previous active file. Active file scope is ContextScopeLabel / RepoContext —
 * composer chips are manual @mentions only.
 */
export function reconcileMentionsAfterEditorSnap(
  mentions: ChatFileMention[] | undefined,
  previousFile: string | undefined,
  context: RepoContext,
  limit = 3
): ChatFileMention[] | undefined {
  const prevNorm = previousFile?.trim() ? normalizeMentionPath(previousFile) : undefined;
  const liveNorm = context.file?.trim() ? normalizeMentionPath(context.file) : undefined;

  let next = mentions ?? [];
  if (prevNorm && liveNorm && prevNorm !== liveNorm) {
    next = next.filter((entry) => normalizeMentionPath(entry.path) !== prevNorm);
  }

  next = next.slice(0, limit);
  return next.length ? next : undefined;
}
