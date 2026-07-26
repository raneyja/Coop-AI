import type { ChatMessage, ComposerMode, PatchCardState } from "../chat/types";
import { parseSlashCommand } from "../context/slashCommands";
import {
  detectEditOptionRequest,
  formatMultiOptionEditReminder,
  type EditOptionRequest
} from "./editOptionsIntent";
import {
  getLastEditUserMessage,
  listPatchCards
} from "./patchSession";

/**
 * Sticky /edit for follow-ups. Users refine patches in plain English after the
 * first /edit turn — those messages must keep the patch-card contract, not fall
 * back to ask-mode markdown.
 */
export function resolveEffectiveComposerMode(
  explicit: ComposerMode | undefined,
  chatHistory: readonly ChatMessage[],
  options?: {
    patchCards?: readonly PatchCardState[];
    lastEditUserMessage?: string;
  }
): ComposerMode | undefined {
  if (explicit === "edit") {
    return "edit";
  }
  if (explicit === "ask") {
    return undefined;
  }

  const cards = options?.patchCards ?? listPatchCards();
  if (cards.length > 0) {
    return "edit";
  }

  if ((options?.lastEditUserMessage ?? getLastEditUserMessage())?.trim()) {
    return "edit";
  }

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role !== "user") {
      continue;
    }
    const content = message.content.trim();
    const parsed = parseSlashCommand(content);
    if (parsed?.def.target.kind === "composer-mode" && parsed.def.target.mode === "edit") {
      return "edit";
    }
    if (parsed?.def.target.kind === "action" || parsed?.def.target.kind === "integration") {
      // A later quick-action / integration slash ends the edit sticky.
      return undefined;
    }
    if (/^\/edit\b/i.test(content)) {
      return "edit";
    }
  }

  return undefined;
}

/**
 * Option count for this turn: current wording, else prior option ask in the
 * thread, else the live multi-option cards already on screen.
 */
export function resolveEditOptionRequest(
  message: string,
  chatHistory: readonly ChatMessage[] = [],
  options?: {
    patchCards?: readonly PatchCardState[];
  }
): EditOptionRequest | undefined {
  const fromCurrent = detectEditOptionRequest(message);
  if (fromCurrent) {
    return fromCurrent;
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
  }

  const cards = options?.patchCards ?? listPatchCards();
  const latest = [...cards].sort(
    (a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0)
  )[0];
  const count = latest?.variantCount;
  if (typeof count === "number" && count >= 2 && count <= 8) {
    return { count };
  }

  return undefined;
}

export function buildEditOptionsReminderForTurn(
  message: string,
  chatHistory: readonly ChatMessage[] = [],
  options?: {
    patchCards?: readonly PatchCardState[];
  }
): string | undefined {
  const request = resolveEditOptionRequest(message, chatHistory, options);
  if (!request) {
    return undefined;
  }
  const fromCurrent = Boolean(detectEditOptionRequest(message));
  const base = formatMultiOptionEditReminder(request.count);
  if (fromCurrent) {
    return base;
  }
  return [
    base,
    "",
    `<edit_options_follow_up>`,
    `The user is refining the previous multi-option /edit — keep emitting exactly ${request.count} separate Option blocks with File: + SEARCH/REPLACE + Summary.`,
    `Do not switch to plain markdown, typescript fences, or a single narrative answer.`,
    `Apply their latest instruction to every option (or replace options that no longer fit).`,
    `</edit_options_follow_up>`
  ].join("\n");
}
