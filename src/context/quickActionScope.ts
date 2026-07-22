import type { RepoContext } from "../chat/types";
import type { QuickActionId } from "../webview/types";
import { isExplicitRepoScope } from "./contextScope";
import { isExternalFileContext } from "./outsideWorkspaceFile";

/** Display path for repo-wide ownership analysis (not a real file path). */
export const REPO_OWNERSHIP_PATH = "(repository)";

const FILE_LEVEL_ACTIONS = new Set<QuickActionId>(["trace-decision", "blast-radius"]);

const REPO_WIDE_ACTIONS = new Set<QuickActionId>([
  "understand-repo",
  "knowledge-gaps",
  "find-owner"
]);

const ALL_QUICK_ACTIONS = new Set<QuickActionId>([
  "understand-repo",
  "trace-decision",
  "find-owner",
  "blast-radius",
  "knowledge-gaps"
]);

export function isFileLevelQuickAction(actionId: QuickActionId): boolean {
  return FILE_LEVEL_ACTIONS.has(actionId);
}

export function quickActionWorksWithoutFile(actionId: QuickActionId): boolean {
  return REPO_WIDE_ACTIONS.has(actionId);
}

export function isQuickActionBlocked(actionId: QuickActionId, context: RepoContext): boolean {
  // Any quick action with a Downloads / Cmd+O tab focused is wrong — do not
  // silently pivot to the settings repo while the user is staring at that file.
  if (ALL_QUICK_ACTIONS.has(actionId) && isExternalFileContext(context)) {
    return true;
  }
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
  if (ALL_QUICK_ACTIONS.has(actionId) && isExternalFileContext(context)) {
    return externalFileMessage(actionId);
  }
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

function externalFileMessage(actionId: QuickActionId): string {
  const labels: Record<QuickActionId, string> = {
    "understand-repo": "Understand Repo",
    "trace-decision": "Trace Decision",
    "find-owner": "Find Owner",
    "blast-radius": "Blast Radius",
    "knowledge-gaps": "Knowledge Gaps"
  };
  const label = labels[actionId] ?? "This action";
  return `${label} needs a file in this repo. The open file is outside the workspace — use File → Open Folder on the project clone, then open a repo file.`;
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
