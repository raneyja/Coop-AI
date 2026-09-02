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
 * A symbol the user typed: `extractBearerToken`, `AuthContext`, `get_queryset`.
 * Copilot's /fix ask names the broken function and nothing else, so a bare
 * identifier is as concrete a target as "this function".
 */
const NAMED_CODE_SYMBOL_RE =
  /\b(?:[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/;

/**
 * Repo-wide changes ("rename verifyToken across the repo") must reach the agent
 * hunt instead of anchoring to whatever tab happens to be open.
 */
const REPO_WIDE_CHANGE_RE =
  /\b(?:across|throughout)\s+(?:the\s+|this\s+|our\s+)?(?:repo|repository|codebase|code\s?base|project|app)\b|\b(?:repo|repository|project)-wide\b|\beverywhere\b|\bin\s+(?:every|all)\s+\w+/i;

/** Shown when explicit /edit has no open file / @mention to anchor a patch. */
export const EDIT_NO_TARGET_FILE_ERROR =
  "Open a file in the editor (or @mention one), then use /edit so Coop can emit an apply-able patch for that path.";

/**
 * Shown when a concrete change ask has no file anchor and routing will not hunt.
 * Prefer Agent hunt → patch over forcing an open tab.
 */
export const EDIT_NO_TARGET_WITHOUT_AGENT_ERROR =
  "Open a file (or @mention one) for /edit, or ask Coop to find the code and propose a patch.";

/** Shown when /edit knows the path but remote/codehost content could not be read. */
export const EDIT_UNREADABLE_FILE_ERROR =
  "Could not read the open remote file for /edit. Keep the file tab open (or reopen it from Remote workspace) and try again.";

/**
 * How to handle a change-shaped ask: anchored /edit, Agent hunt→patch, or hard error.
 * Open file is a hint — not a gate — when Agent can own the change.
 */
export type ChangeSendRouting =
  | { kind: "anchored-edit" }
  | { kind: "agent-change" }
  | { kind: "reject-no-target"; message: string }
  | { kind: "none" };

export function resolveChangeSendRouting(options: {
  /** User explicitly chose /edit (slash or composer). */
  explicitEdit: boolean;
  concreteEditAsk: boolean;
  hasEditTarget: boolean;
  /** This turn may run the repo tool loop (locate/understand/change). */
  agentCanOwnChange: boolean;
}): ChangeSendRouting {
  if (options.explicitEdit) {
    if (options.hasEditTarget) {
      return { kind: "anchored-edit" };
    }
    return { kind: "reject-no-target", message: EDIT_NO_TARGET_FILE_ERROR };
  }
  if (!options.concreteEditAsk) {
    return { kind: "none" };
  }
  if (options.hasEditTarget) {
    return { kind: "anchored-edit" };
  }
  if (options.agentCanOwnChange) {
    return { kind: "agent-change" };
  }
  return { kind: "reject-no-target", message: EDIT_NO_TARGET_WITHOUT_AGENT_ERROR };
}

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
  if (EDIT_TARGET_HINT_RE.test(text) || /`[^`]+`/.test(text) || /\bValidationError\b/.test(text)) {
    return true;
  }
  return NAMED_CODE_SYMBOL_RE.test(text) && !REPO_WIDE_CHANGE_RE.test(text);
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
