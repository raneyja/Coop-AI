import type { ChatMessage, ComposerMode, PatchCardState } from "../chat/types";
import { parseSlashCommand } from "../context/slashCommands";
import {
  detectEditOptionRequest,
  formatMultiOptionEditReminder,
  type EditOptionRequest
} from "./editOptionsIntent";
import {
  clearLastEditUserMessage,
  getLastEditUserMessage,
  listPatchCards
} from "./patchSession";

/**
 * Sticky /edit is narrow on purpose.
 *
 * Edit mode is opt-in via `/edit` (or explicit composerMode: "edit").
 * Plain-English follow-ups stay in edit mode ONLY when pending patch cards
 * exist AND the new message looks like a patch refinement — not a question.
 *
 * Ask / explain messages always break sticky and return to normal chat.
 *
 * Option counts are NOT gated on brittle noun lists for the model. Every /edit
 * turn gets the user's exact request text; the model follows that sentence.
 * Regex count detection is only an optional exact-N hint when it can parse one.
 */

const ASK_INTENT =
  /^(?:what|whats|what's|why|how|when|where|who|which|whose|whom)\b/i;

const ASK_PHRASE =
  /\b(?:what\s+(?:does|do|is|are|was|were)|whats|what's|explain|describe|summarize|summarise|tell\s+me|walk\s+me\s+through|help\s+me\s+understand|can\s+you\s+explain)\b/i;

const EDIT_FOLLOW_UP =
  /\b(?:option\s*[0-9]+|alternative\s*[0-9]+|replace(?:s|d|ment)?|don'?t\s+add|do\s+not\s+add|instead(?:\s+of)?|prefer|make\s+(?:it|them|option)|safer|rewrite|refactor|rename|extract|null[- ]?check|tl;?dr|change\s+(?:it|the|this|that)|update\s+(?:it|the|this|that)|fix\s+(?:it|the|this|that)|add\s+(?:a|an|the)\s+\w+|remove\s+(?:the|this|that)|use\s+\w+\s+instead)\b/i;

function normalizeMessage(message: string | undefined): string {
  return (message ?? "").trim();
}

function isFreshEditSlash(message: string): boolean {
  const content = normalizeMessage(message);
  if (!content) {
    return false;
  }
  const parsed = parseSlashCommand(content);
  if (parsed?.def.target.kind === "composer-mode" && parsed.def.target.mode === "edit") {
    return true;
  }
  return /^\/edit\b/i.test(content);
}

/** True when the user is asking a question / wants an explanation — not a patch. */
export function looksLikeAskIntent(message: string): boolean {
  const text = normalizeMessage(message);
  if (!text || isFreshEditSlash(text)) {
    return false;
  }
  const body = text.replace(/^\/ask\b\s*/i, "").trim();
  if (!body) {
    return true;
  }
  if (ASK_INTENT.test(body) || ASK_PHRASE.test(body)) {
    return true;
  }
  if (/\?\s*$/.test(body) && !EDIT_FOLLOW_UP.test(body) && !detectEditOptionRequest(body)) {
    return true;
  }
  return false;
}

/** True when the message looks like refining / regenerating a patch. */
export function looksLikeEditFollowUp(message: string): boolean {
  const text = normalizeMessage(message);
  if (!text || isFreshEditSlash(text) || looksLikeAskIntent(text)) {
    return false;
  }
  if (detectEditOptionRequest(text)) {
    return true;
  }
  return EDIT_FOLLOW_UP.test(text);
}

function hasPendingPatchCards(cards: readonly PatchCardState[]): boolean {
  return cards.some((card) => card.status === "pending" || card.status === "failed");
}

/**
 * Resolve composer mode for this turn.
 *
 * Pass `currentMessage` for the text being sent now (preferred). When omitted,
 * falls back to the latest user message in `chatHistory` (stream path).
 */
export function resolveEffectiveComposerMode(
  explicit: ComposerMode | undefined,
  chatHistory: readonly ChatMessage[],
  options?: {
    patchCards?: readonly PatchCardState[];
    lastEditUserMessage?: string;
    currentMessage?: string;
  }
): ComposerMode | undefined {
  if (explicit === "edit") {
    return "edit";
  }
  if (explicit === "ask") {
    clearLastEditUserMessage();
    return undefined;
  }

  const current =
    normalizeMessage(options?.currentMessage) ||
    [...chatHistory].reverse().find((entry) => entry.role === "user")?.content.trim() ||
    "";

  if (!current) {
    return undefined;
  }

  if (isFreshEditSlash(current)) {
    return "edit";
  }

  if (looksLikeAskIntent(current)) {
    clearLastEditUserMessage();
    return undefined;
  }

  const cards = options?.patchCards ?? listPatchCards();
  const stickyContext =
    hasPendingPatchCards(cards) ||
    Boolean((options?.lastEditUserMessage ?? getLastEditUserMessage())?.trim());

  if (stickyContext && looksLikeEditFollowUp(current)) {
    return "edit";
  }

  if (!hasPendingPatchCards(cards)) {
    clearLastEditUserMessage();
  }
  return undefined;
}

/**
 * Optional count hint when wording is easy to parse. Never required for the
 * model to honor the user's sentence — only used to tighten sticky follow-ups.
 */
export function resolveEditOptionRequest(
  message: string,
  chatHistory: readonly ChatMessage[] = [],
  options?: {
    patchCards?: readonly PatchCardState[];
    allowInherit?: boolean;
  }
): EditOptionRequest | undefined {
  const fromCurrent = detectEditOptionRequest(message);
  if (fromCurrent) {
    return fromCurrent;
  }

  if (isFreshEditSlash(message) || options?.allowInherit === false) {
    return undefined;
  }

  const allowInherit =
    options?.allowInherit ??
    (!looksLikeAskIntent(message) && looksLikeEditFollowUp(message));

  if (!allowInherit) {
    return undefined;
  }

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const entry = chatHistory[i];
    if (entry.role !== "user") {
      continue;
    }
    const fromHistory = detectEditOptionRequest(entry.content);
    if (fromHistory) {
      return fromHistory;
    }
    const parsed = parseSlashCommand(entry.content.trim());
    if (parsed?.def.target.kind === "action" || parsed?.def.target.kind === "integration") {
      break;
    }
    if (isFreshEditSlash(entry.content) && !detectEditOptionRequest(entry.content)) {
      break;
    }
  }

  const cards = options?.patchCards ?? listPatchCards();
  const latest = [...cards]
    .filter((card) => card.status === "pending" || card.status === "failed")
    .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0))[0];
  const count = latest?.variantCount;
  if (typeof count === "number" && count >= 2 && count <= 8) {
    return { count };
  }

  return undefined;
}

/**
 * Always attached on /edit turns. Quotes the user's exact request so the model
 * cannot ignore the words after `/edit`. Regex count is only an optional hint.
 */
export function buildEditRequestReminderForTurn(
  userRequest: string,
  chatHistory: readonly ChatMessage[] = [],
  options?: {
    patchCards?: readonly PatchCardState[];
  }
): string {
  const request = normalizeMessage(userRequest) || "(empty /edit — infer a useful patch from the selection/file)";
  const fromCurrent = Boolean(detectEditOptionRequest(request));
  const parsedCount = resolveEditOptionRequest(request, chatHistory, {
    ...options,
    allowInherit: fromCurrent || looksLikeEditFollowUp(request)
  });

  const lines = [
    `<edit_user_request>`,
    `Follow the user's exact request below. Do not ignore any part of it:`,
    request,
    ``,
    `How to respond:`,
    `- One change requested → one File: + SEARCH/REPLACE patch.`,
    `- Multiple alternatives requested (any wording: options, changes, edits, ways, suggestions, …) → that many separate Option blocks (Option 1:, Option 2:, …), each with its own File: + SEARCH/REPLACE + Summary.`,
    `- Never collapse several requested alternatives into one Proposed edit.`,
    `- Do what the sentence asks — the model can read English; honor the count and intent in their words.`
  ];

  if (parsedCount) {
    lines.push(
      ``,
      `Count hint (from their wording or prior multi-option turn): emit exactly ${parsedCount.count} Option blocks.`
    );
  }

  lines.push(`</edit_user_request>`);

  if (parsedCount && !fromCurrent && looksLikeEditFollowUp(request)) {
    lines.push(
      "",
      `<edit_options_follow_up>`,
      `The user is refining the previous multi-option /edit — keep emitting exactly ${parsedCount.count} separate Option blocks with File: + SEARCH/REPLACE + Summary.`,
      `Do not switch to plain markdown, typescript fences, or a single narrative answer.`,
      `Apply their latest instruction to every option (or replace options that no longer fit).`,
      `</edit_options_follow_up>`
    );
  } else if (parsedCount && fromCurrent) {
    lines.push("", formatMultiOptionEditReminder(parsedCount.count));
  }

  return lines.join("\n");
}

/** @deprecated Use buildEditRequestReminderForTurn — kept for older call sites/tests. */
export function buildEditOptionsReminderForTurn(
  message: string,
  chatHistory: readonly ChatMessage[] = [],
  options?: {
    patchCards?: readonly PatchCardState[];
  }
): string {
  return buildEditRequestReminderForTurn(message, chatHistory, options);
}
