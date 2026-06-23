import type { ChatFileMention } from "../chat/types";

const DEFAULT_MENTION_LIMIT = 3;

export function appendFileMention(
  mentions: ChatFileMention[],
  entry: ChatFileMention,
  limit = DEFAULT_MENTION_LIMIT
): ChatFileMention[] {
  if (mentions.some((existing) => existing.repoId === entry.repoId && existing.path === entry.path)) {
    return mentions;
  }
  const next = [...mentions, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
