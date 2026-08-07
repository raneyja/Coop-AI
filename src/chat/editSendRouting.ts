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

/** Bubble/history text stored for patch retry — mirrors handleChatSend edit path. */
export function resolveEditTrackingMessage(
  message: string,
  options: EditSendOptions | undefined,
  mentionRefs: MentionScopeRef[] = []
): string {
  return options?.historyContent ?? plainChatHistoryContent(message, mentionRefs);
}
