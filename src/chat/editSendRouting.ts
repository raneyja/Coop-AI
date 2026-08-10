import { plainChatHistoryContent, type MentionScopeRef } from "../prompts/mentionScope";

export type EditSendOptions = {
  composerMode?: string;
  historyContent?: string;
  mentions?: unknown[];
};

const ADVISORY_ASK_RE =
  /\b(where should|which (?:existing )?(?:\w+\s+){0,6}should i|who owns|what breaks if|why (?:do|did|does|is|are) we|how (?:does|do|should) .{0,80}\b(?:work|live|flow|fit)\b)\b/i;

const CONCRETE_EDIT_VERB_RE =
  /\b(add|insert|update|change|fix|implement|replace|remove|delete|rename|refactor|wire(?:\s+up)?|patch|migrate)\b/i;

const APPLY_LANGUAGE_RE =
  /\b(show the exact change|exact change to apply|apply (?:this|the|these|it)|emit (?:an? |the )?applyable patch|search\s*\/\s*replace|<<<<<<< SEARCH)\b/i;

const EDIT_TARGET_HINT_RE =
  /\b(in this (?:file|function|method|class)|this (?:file|function|method)|validate_\w+|def \w+|function \w+|method)\b/i;

/** Shown when /edit has no open file / @mention to anchor a patch. */
export const EDIT_NO_TARGET_FILE_ERROR =
  "Open a file in the editor (or @mention one), then use /edit so Coop can emit an apply-able patch for that path.";

/** Shown when /edit knows the path but remote/codehost content could not be read. */
export const EDIT_UNREADABLE_FILE_ERROR =
  "Could not read the open remote file for /edit. Keep the file tab open (or reopen it from Remote workspace) and try again.";

/**
 * True when plain chat is asking for a concrete code change (not advice / archaeology).
 * Used to auto-route onto the /edit Apply-patch path when a file is in scope.
 */
export function isConcreteFileEditAsk(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  if (APPLY_LANGUAGE_RE.test(text)) {
    return true;
  }
  // Blast / ownership / “why do we…” archaeology — never auto-edit, even when the
  // sentence also contains change/rename + `backticks` (those are impact targets).
  if (ADVISORY_ASK_RE.test(text)) {
    return false;
  }
  if (!CONCRETE_EDIT_VERB_RE.test(text)) {
    return false;
  }
  // Edit verb alone is too broad ("add context about X"); require a code/apply target hint.
  return EDIT_TARGET_HINT_RE.test(text) || /`[^`]+`/.test(text) || /\bValidationError\b/.test(text);
}

/** True when an edit-mode send should record edit.requested and patch retry context. */
export function shouldTrackEditRequest(
  options: EditSendOptions | undefined,
  quickAction: string | undefined
): boolean {
  return options?.composerMode === "edit" && !quickAction;
}

/**
 * /edit must stay on the Apply-patch path when a file (chip or @mention) is in scope.
 * Callers must not silently demote to ask — that yields Summary / status narratives with no patch.
 */
export function hasEditTargetInScope(options: {
  file?: string;
  mentionCount?: number;
}): boolean {
  return Boolean(options.file?.trim()) || (options.mentionCount ?? 0) > 0;
}

/**
 * Status-transition / feature-add / email-template grounding must not hijack /edit.
 * Those paths emit Summary templates instead of File: + ```patch.
 */
export function shouldBypassAdvisoryGroundingForEdit(composerMode?: string): boolean {
  return composerMode === "edit";
}

/**
 * Zero-Clone edit snap order: remote VFS tab first, then local/external only when
 * remote provenance is not active. Prevents EDH Coop-AI disk files (e.g. tsconfig)
 * from stealing the patch target when a remote Use-repo file is open.
 */
export type EditEditorSnapPreference = "remote-only" | "remote-then-local" | "local-then-any";

export function resolveEditEditorSnapPreference(options: {
  composerMode?: string;
  remoteProvenance: boolean;
}): EditEditorSnapPreference {
  if (options.remoteProvenance) {
    return "remote-only";
  }
  if (options.composerMode === "edit") {
    return "remote-then-local";
  }
  return "local-then-any";
}

/** Bubble/history text stored for patch retry — mirrors handleChatSend edit path. */
export function resolveEditTrackingMessage(
  message: string,
  options: EditSendOptions | undefined,
  mentionRefs: MentionScopeRef[] = []
): string {
  return options?.historyContent ?? plainChatHistoryContent(message, mentionRefs);
}
