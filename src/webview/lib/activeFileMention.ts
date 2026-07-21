import type { ChatFileMention, RepoContext } from "../../chat/types";
import { WORKSPACE_LOCAL_REPO_ID } from "../../chat/mentionSearchMerge";

export function mentionKey(mention: Pick<ChatFileMention, "repoId" | "path">): string {
  return `${mention.repoId}:${normalizeMentionPath(mention.path)}`;
}

export function normalizeMentionPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/** Build the composer mention chip for the active editor file (remote-first when codehost-scoped). */
export function mentionFromActiveFile(context: RepoContext): ChatFileMention | undefined {
  const path = context.file?.trim();
  if (!path || context.fileSource === "external") {
    return undefined;
  }

  const owner = context.owner?.trim();
  const repo = context.repo?.trim();
  const provider = context.provider ?? "github";

  if (context.fileSource === "remote" && owner && repo) {
    return {
      path,
      repoId: `${provider}:${owner}/${repo}`,
      source: "indexed"
    };
  }

  return {
    path,
    repoId: WORKSPACE_LOCAL_REPO_ID,
    source: "local"
  };
}

export function shortMentionSourceLabel(mention: ChatFileMention): string {
  if (mention.source === "local" || mention.repoId === WORKSPACE_LOCAL_REPO_ID) {
    return "Local Workspace";
  }
  const match = mention.repoId.match(/^(?:github|gitlab|bitbucket):(.+)$/i);
  return match?.[1] ?? mention.repoId;
}

/**
 * Keep user @mentions, replace any same-path / previous auto active-file chip
 * with the current editor scope mention.
 */
export function syncActiveFileMention(
  mentions: ChatFileMention[],
  auto: ChatFileMention | undefined,
  previousAutoKey?: string,
  limit = 3
): ChatFileMention[] {
  const autoPath = auto ? normalizeMentionPath(auto.path) : undefined;
  const withoutStale = mentions.filter((entry) => {
    const key = mentionKey(entry);
    if (previousAutoKey && key === previousAutoKey) {
      return false;
    }
    if (autoPath && normalizeMentionPath(entry.path) === autoPath) {
      return false;
    }
    return true;
  });

  if (!auto) {
    return withoutStale.slice(0, limit);
  }

  return [auto, ...withoutStale].slice(0, limit);
}
