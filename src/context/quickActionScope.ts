import type { RepoContext } from "../chat/types";
import type { QuickActionId } from "../webview/types";
import { isExplicitRepoScope } from "./contextScope";

/** Display path for repo-wide ownership analysis (not a real file path). */
export const REPO_OWNERSHIP_PATH = "(repository)";

const FILE_LEVEL_ACTIONS = new Set<QuickActionId>(["trace-decision", "blast-radius"]);

const REPO_WIDE_ACTIONS = new Set<QuickActionId>([
  "understand-repo",
  "knowledge-gaps",
  "find-owner"
]);

export function isFileLevelQuickAction(actionId: QuickActionId): boolean {
  return FILE_LEVEL_ACTIONS.has(actionId);
}

export function quickActionWorksWithoutFile(actionId: QuickActionId): boolean {
  return REPO_WIDE_ACTIONS.has(actionId);
}

export function isQuickActionBlocked(actionId: QuickActionId, context: RepoContext): boolean {
  if (context.file?.trim()) {
    return false;
  }
  if (!quickActionWorksWithoutFile(actionId)) {
    return true;
  }
  if (actionId === "find-owner") {
    return !context.owner?.trim() || !context.repo?.trim();
  }
  return false;
}

export function quickActionBlockedMessage(actionId: QuickActionId, context: RepoContext): string {
  if (actionId === "trace-decision") {
    return fileLevelOnlyMessage("Trace Decision");
  }
  if (actionId === "blast-radius") {
    return fileLevelOnlyMessage("Blast Radius");
  }
  if (actionId === "find-owner") {
    return "Find Owner needs a repository. Select a repo in the explorer or set Owner/Repo in Settings.";
  }
  if (isExplicitRepoScope(context)) {
    return "Select a file in the explorer or open one in the editor.";
  }
  return "Open a file in the editor first.";
}

export function quickActionHoverHint(
  actionId: QuickActionId,
  context: RepoContext,
  dimmed: boolean,
  description: string
): string {
  if (isQuickActionBlocked(actionId, context)) {
    return quickActionBlockedMessage(actionId, context);
  }
  if (dimmed) {
    return "Open a file for full context.";
  }
  return description;
}

function fileLevelOnlyMessage(label: string): string {
  return `${label} is available at file level, not repo level. Select a file in the explorer or open one in the editor.`;
}
