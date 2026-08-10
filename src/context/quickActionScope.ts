import type { RepoContext } from "../chat/types";
import type { QuickActionId } from "../webview/types";
import { shouldSkipLocalEditorAttachForRepoScope } from "../workspace/repoEvidenceIsolation";
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

function isRepoWideQuickActionId(actionId: string | undefined): actionId is QuickActionId {
  return Boolean(actionId && REPO_WIDE_ACTIONS.has(actionId as QuickActionId));
}

/**
 * When true, do not attach open-editor / active-file bodies for this turn.
 * Repo-wide Use-repo turns and Understand Repo never need leftover editor tabs.
 */
export function shouldSkipOpenFileAttach(options: {
  quickAction?: string;
  hasIntegrationProvider?: boolean;
  allMentionsOutOfScope?: boolean;
  context: Pick<RepoContext, "file" | "scope" | "owner" | "repo">;
}): boolean {
  if (options.quickAction === "understand-repo") {
    return true;
  }
  if (options.hasIntegrationProvider) {
    return true;
  }
  if (!options.quickAction && options.allMentionsOutOfScope) {
    return true;
  }
  // Gaps / Owner / sticky Use-repo with no file chip: leftover tabs are not evidence.
  if (isRepoWideQuickActionId(options.quickAction) && !options.context.file?.trim()) {
    return true;
  }
  return shouldSkipLocalEditorAttachForRepoScope(options.context);
}

/**
 * Surface "could not read open file" only when this turn intentionally needed a file
 * body and attach failed — not when open tabs exist beside a repo-wide ask.
 */
export function shouldWarnOpenFileAttachFailure(options: {
  quickAction?: string;
  hasIntegrationProvider?: boolean;
  hasAttachedFiles: boolean;
  openEditorTabCount: number;
  /** File chip / target for this turn — required to warn. */
  intendedFile?: string;
}): boolean {
  if (options.hasAttachedFiles) {
    return false;
  }
  if (options.openEditorTabCount <= 0) {
    return false;
  }
  if (options.hasIntegrationProvider) {
    return false;
  }
  if (options.quickAction === "understand-repo") {
    return false;
  }
  // Repo-wide Gaps / Owner without a file chip: leftover tabs must not warn.
  if (isRepoWideQuickActionId(options.quickAction) && !options.intendedFile?.trim()) {
    return false;
  }
  return Boolean(options.intendedFile?.trim());
}

export function isQuickActionBlocked(actionId: QuickActionId, context: RepoContext): boolean {
  // Any quick action with a Downloads / Cmd+O tab focused is wrong — do not
  // silently pivot to the settings repo while the user is staring at that file.
  if (ALL_QUICK_ACTIONS.has(actionId) && isExternalFileContext(context)) {
    return true;
  }

  // Understand Repo is always repo-wide — never bind to a file chip.
  if (actionId === "understand-repo") {
    return Boolean(context.file?.trim()) || !hasExplicitRepoSelection(context);
  }

  if (context.file?.trim()) {
    return false;
  }
  if (!quickActionWorksWithoutFile(actionId)) {
    return true;
  }
  // Prefs-seeded owner/repo is NOT a selection. Repo-wide actions need an explicit
  // explorer "Use repo" (scope:"repo") or an open file — otherwise empty-state
  // actions silently analyze the Workspace default.
  return !hasExplicitRepoSelection(context);
}

/**
 * Suggest-chip gate — slightly looser than the grid for Understand Repo.
 * A sticky file chip still means the user has a Use-repo; accepting Understand
 * clears the file before running. Do not hide chips for a clearly repo-wide ask.
 */
export function isQuickActionBlockedForSuggest(
  actionId: QuickActionId,
  context: RepoContext
): boolean {
  if (ALL_QUICK_ACTIONS.has(actionId) && isExternalFileContext(context)) {
    return true;
  }
  if (actionId === "understand-repo") {
    if (hasExplicitRepoSelection(context)) {
      return false;
    }
    // File-scoped Use-repo still has owner/repo coordinates.
    return !(
      Boolean(context.file?.trim()) &&
      Boolean(context.owner?.trim()) &&
      Boolean(context.repo?.trim())
    );
  }
  return isQuickActionBlocked(actionId, context);
}

/** Explicit explorer "Use repo" with coordinates — not Settings prefs alone. */
export function hasExplicitRepoSelection(context: RepoContext): boolean {
  return (
    isExplicitRepoScope(context) && Boolean(context.owner?.trim() && context.repo?.trim())
  );
}

export function quickActionBlockedMessage(actionId: QuickActionId, context: RepoContext): string {
  if (ALL_QUICK_ACTIONS.has(actionId) && isExternalFileContext(context)) {
    return externalFileMessage(actionId);
  }
  if (actionId === "understand-repo") {
    if (context.file?.trim()) {
      return "Understand Repo is repo-wide only. Click Use repo in the Remote workspace picker (select the repository, not a file), then try again.";
    }
    return "Understand Repo needs a selected repository. Click Use repo in the Remote workspace picker.";
  }
  if (actionId === "trace-decision") {
    return fileLevelOnlyMessage("Trace Decision");
  }
  if (actionId === "blast-radius") {
    return fileLevelOnlyMessage("Blast Radius");
  }
  if (quickActionWorksWithoutFile(actionId) && !context.file?.trim() && !hasExplicitRepoSelection(context)) {
    return repoSelectionRequiredMessage(actionId);
  }
  if (isExplicitRepoScope(context)) {
    return "Select a file in the explorer or open one in the editor.";
  }
  return "Open a file in the editor first.";
}

function repoSelectionRequiredMessage(actionId: QuickActionId): string {
  const labels: Record<QuickActionId, string> = {
    "understand-repo": "Understand Repo",
    "trace-decision": "Trace Decision",
    "find-owner": "Find Owner",
    "blast-radius": "Blast Radius",
    "knowledge-gaps": "Knowledge Gaps"
  };
  const label = labels[actionId] ?? "This action";
  return `${label} needs a selected repository. Click Use repo in the explorer, or open a file in the editor.`;
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
