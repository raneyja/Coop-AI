import { extractNamedSourceFiles } from "../api/agent/searchQuery";
import { isFileCallerQuery, isShipCheckQuery } from "../context/fileCallerIntent";
import { isFileHistoryQuery } from "../context/fileHistoryIntent";
import {
  isAdvisoryFileAsk,
  isRepoWideChangeMessage,
  messageHasNamedCodeSymbol
} from "./editSendRouting";
import { classifyRepoCodeIntent } from "./repoCodeIntent";

/**
 * Live highlight on this send already is the change target.
 * Search is for evidence you do not have yet. Do not hunt insert-text.
 *
 * L file-assistant may also match. Callers keep that turn on the L path.
 * Explicit /edit, quick actions, and integration slashes stay with their owners.
 */
export type OpenFileSelectionChangeInput = {
  /** Chip path on this send. */
  file?: string;
  /** Live selection on this send. Not inferred from the sentence. */
  selectedLines?: [number, number];
  message: string;
  /** Accepted so callers can pass the flag. Does not force the L path off. */
  fileAssistant?: boolean;
  /** User typed /edit or /fix. Anchored-edit already owns the turn. */
  explicitEdit?: boolean;
  hasQuickAction?: boolean;
  integrationSlash?: boolean;
};

/**
 * Leading edit verbs already used by change classification, concrete edits,
 * and comment asks. Only consulted when the classifier drops a short
 * imperative ("insert a line", "put a note here"). Not a phrase list.
 */
const SELECTION_CHANGE_LEAD =
  /^(?:please\s+|(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:add|insert|put|write|update|change|fix|implement|replace|remove|delete|rename|refactor|wire|patch|migrate|modify|create|move|convert|extract)\b/i;

/** Shown when the highlight is the target but the remote body could not be read. */
export const REMOTE_SELECTION_UNREADABLE_ERROR =
  "Could not read the open remote file. Keep that file tab open, or reopen it from Remote workspace.";

/**
 * Change asks that name another symbol via "to requireauth" (no camelCase/backticks).
 * camelCase/snake_case stay on messageHasNamedCodeSymbol.
 */
const CHANGE_TARGET_PREP =
  /\b(?:to|in|for|on|into)\s+(?!this\b|the\b|that\b|here\b|it\b|a\b|an\b|our\b|your\b)([a-z][a-z0-9_]{4,})\b/i;

function isLiveSelection(lines: [number, number] | undefined): lines is [number, number] {
  if (!lines || lines.length !== 2) {
    return false;
  }
  const [start, end] = lines;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}

function sameRepoPath(left: string, right: string): boolean {
  const norm = (value: string) =>
    value.replace(/\\/g, "/").replace(/^\.?\//, "").trim().toLowerCase();
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) {
    return false;
  }
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * Quoted text and "that says / that said …" are the words to insert, not a
 * symbol to locate.
 */
export function stripInsertSpec(message: string): string {
  return message
    .replace(/\b(?:that|which)\s+(?:says|said|reads|read)\b[^.;!?]*/gi, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/(?<![\w])'[^']*'(?![\w])/g, " ");
}

function asksForSelectionChange(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  if (
    isShipCheckQuery(trimmed) ||
    isFileCallerQuery(trimmed) ||
    isFileHistoryQuery(trimmed) ||
    isAdvisoryFileAsk(trimmed)
  ) {
    return false;
  }
  const action = classifyRepoCodeIntent(trimmed).action;
  if (action === "locate" || action === "understand") {
    return false;
  }
  if (action === "change") {
    return true;
  }
  return SELECTION_CHANGE_LEAD.test(trimmed);
}

function namesOtherTarget(message: string, chipFile: string): boolean {
  if (isRepoWideChangeMessage(message)) {
    return true;
  }
  const stripped = stripInsertSpec(message);
  if (extractNamedSourceFiles(stripped).some((file) => !sameRepoPath(file, chipFile))) {
    return true;
  }
  const ticks = stripped.match(/`[^`]+`/g) ?? [];
  for (const tick of ticks) {
    const inner = tick.slice(1, -1).trim();
    if (!inner || /\s/.test(inner) || sameRepoPath(inner, chipFile)) {
      continue;
    }
    return true;
  }
  if (messageHasNamedCodeSymbol(stripped)) {
    return true;
  }
  return CHANGE_TARGET_PREP.test(stripped);
}

export function openFileSelectionOwnsChange(input: OpenFileSelectionChangeInput): boolean {
  if (input.explicitEdit || input.hasQuickAction || input.integrationSlash) {
    return false;
  }
  if (!input.file?.trim() || !isLiveSelection(input.selectedLines)) {
    return false;
  }
  if (!asksForSelectionChange(input.message ?? "")) {
    return false;
  }
  return !namesOtherTarget(input.message ?? "", input.file);
}
