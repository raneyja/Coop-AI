import type { RepoContext } from "./types";

const QUICK_ACTION_LABELS: Record<string, string> = {
  "understand-repo": "Understand Repo",
  "trace-decision": "Trace Decision",
  "find-owner": "Find Owner",
  "blast-radius": "Blast Radius",
  "knowledge-gaps": "Knowledge Gaps"
};

const MAX_TITLE_LENGTH = 52;

export function parseQuickActionPrefix(content: string): string | undefined {
  const match = content.match(/^\[([^\]]+)\]/);
  return match?.[1];
}

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }
  return `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function summarizeThreadTitle(params: {
  content: string;
  quickAction?: string;
  context?: Pick<RepoContext, "file" | "owner" | "repo">;
}): string {
  const actionId = params.quickAction ?? parseQuickActionPrefix(params.content);
  const actionLabel = actionId ? QUICK_ACTION_LABELS[actionId] : undefined;

  if (actionLabel) {
    const file = params.context?.file ? basename(params.context.file) : undefined;
    const repo =
      params.context?.owner && params.context?.repo
        ? `${params.context.owner}/${params.context.repo}`
        : undefined;

    if (file && repo) {
      return truncateTitle(`${actionLabel} · ${file}`);
    }
    if (file) {
      return truncateTitle(`${actionLabel} for ${file}`);
    }
    if (repo) {
      return truncateTitle(`${actionLabel} · ${repo}`);
    }
    return actionLabel;
  }

  const normalized = params.content.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (!normalized) {
    return "New Chat";
  }
  const singleLine = normalized.split("\n")[0]?.trim() ?? normalized;
  return truncateTitle(singleLine);
}

/** @deprecated Use summarizeThreadTitle — kept for call-site migration */
export function titleFromMessage(content: string): string {
  return summarizeThreadTitle({ content });
}
