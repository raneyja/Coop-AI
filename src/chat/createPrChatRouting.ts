import type { PatchCardState } from "./types";

/** “create a PR” / “open a pull request” anywhere in the ask — not only those three words. */
const SHIP_PR =
  /\b(?:create|open|make|submit|ship|draft)\s+(?:(?:a|the|this|my)\s+)?(?:pr|pull[\s-]?request|merge[\s-]?request)s?\b/i;

const PROCESS_QUESTION_START =
  /^(?:how|what|why|where|when|should|do i|does|is there|explain|describe)\b/i;

const NEW_WORK_LEAD =
  /^(?:please\s+)?(?:add|insert|implement|fix|wire|refactor|rename)\b/i;

const NEW_WORK_AFTER_PR =
  /\b(?:pr|pull[\s-]?request|merge[\s-]?request)s?\s+that\s+(?:adds?|implements?|fixes?|introduces?|refactors?|updates?|creates?)\b/i;

const PR_TEMPLATE_ASK =
  /\b(?:pr|pull[\s-]?request|merge[\s-]?request)s?\s+templates?\b/i;

const CONTEXT_CHIP_LINE =
  /^(?:file|repo|branch|selection):[^\n]+\n*/gim;

export const CREATE_PR_CHAT_NEED_APPLY =
  "I don't see editor changes or an Applied /edit in this chat. Edit a Use-repo file, or Apply an /edit, then say Create a PR.";

export const CREATE_PR_CHAT_NEED_APPLY_PENDING =
  "Apply the patch on the card above first. Then I can open a pull request.";

export const CREATE_PR_CHAT_NEED_USE_REPO =
  "Pick a Use-repo first. Then I can open a pull request for your changes.";

export const CREATE_PR_CHAT_OPENED =
  "Review the branch, title, and notes, then create the pull request.";

export const CREATE_PR_CHAT_OPENED_MULTI =
  "Review the branch, title, and notes for every /edit you Applied in this chat, then create the pull request.";

export type CreatePrFile = { path: string; content: string };

export type CreatePrChatRouting =
  | {
      kind: "open-confirm";
      messageTimestamp: number;
      files: CreatePrFile[];
      appliedEditCount: number;
    }
  | { kind: "need-apply" }
  | { kind: "need-apply-pending" }
  | { kind: "need-use-repo" }
  | { kind: "none" };

/**
 * True when the user is asking to ship existing applied work as a PR.
 * Matches a tail (“of all the work I just applied”) and chip lines after the ask.
 * Rejects process questions and “create a PR that adds …” new-work asks.
 */
export function isCreatePullRequestAsk(message: string): boolean {
  const text = message.replace(CONTEXT_CHIP_LINE, "").trim();
  if (!text) {
    return false;
  }
  if (PROCESS_QUESTION_START.test(text) || NEW_WORK_LEAD.test(text)) {
    return false;
  }
  if (!SHIP_PR.test(text)) {
    return false;
  }
  if (PR_TEMPLATE_ASK.test(text) || NEW_WORK_AFTER_PR.test(text)) {
    return false;
  }
  return true;
}

export function isEligibleCreatePrCard(card: PatchCardState): boolean {
  if (card.status !== "applied") {
    return false;
  }
  if (card.canCreatePr === true) {
    return true;
  }
  return (card.prFiles ?? []).some((file) => file.path.trim() && file.content.length > 0);
}

export function latestEligibleCreatePrCard(
  cards: readonly PatchCardState[]
): PatchCardState | undefined {
  return [...cards]
    .filter(isEligibleCreatePrCard)
    .sort((a, b) => (b.messageTimestamp ?? 0) - (a.messageTimestamp ?? 0))[0];
}

/** Oldest → newest. Same path keeps the later Apply (current file body). */
export function mergeAppliedPrFiles(cards: readonly PatchCardState[]): CreatePrFile[] {
  const byPath = new Map<string, CreatePrFile>();
  const eligible = [...cards]
    .filter(isEligibleCreatePrCard)
    .sort((a, b) => (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0));
  for (const card of eligible) {
    for (const file of card.prFiles ?? []) {
      const path = file.path.trim();
      if (!path || !file.content.length) {
        continue;
      }
      byPath.set(path, { path, content: file.content });
    }
  }
  return [...byPath.values()];
}

/** Oldest → newest applied, then editor buffers. Same path keeps the live editor body. */
export function mergeCreatePrFiles(
  applied: readonly CreatePrFile[],
  editor: readonly CreatePrFile[] = []
): CreatePrFile[] {
  const byPath = new Map<string, CreatePrFile>();
  for (const file of [...applied, ...editor]) {
    const path = file.path.trim();
    if (!path || !file.content.length) {
      continue;
    }
    byPath.set(path, { path, content: file.content });
  }
  return [...byPath.values()];
}

/** All applied hunks in this thread, so PR notes cover every /edit. */
export function mergeAppliedPrPreviewFiles(
  cards: readonly PatchCardState[]
): PatchCardState["files"] {
  const byPath = new Map<string, PatchCardState["files"][number]>();
  const applied = [...cards]
    .filter((card) => card.status === "applied")
    .sort((a, b) => (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0));
  for (const card of applied) {
    for (const file of card.files) {
      const existing = byPath.get(file.relativePath);
      if (!existing) {
        byPath.set(file.relativePath, { ...file, hunks: [...file.hunks] });
        continue;
      }
      byPath.set(file.relativePath, {
        ...existing,
        hunks: [...existing.hunks, ...file.hunks]
      });
    }
  }
  return [...byPath.values()];
}

export function resolveCreatePrChatRouting(options: {
  asked: boolean;
  hasUseRepo: boolean;
  cards: readonly PatchCardState[];
  editorFiles?: readonly CreatePrFile[];
  confirmTimestamp?: number;
}): CreatePrChatRouting {
  if (!options.asked) {
    return { kind: "none" };
  }
  const applied = mergeAppliedPrFiles(options.cards);
  const files = mergeCreatePrFiles(applied, options.editorFiles ?? []);
  const eligible = latestEligibleCreatePrCard(options.cards);
  if (files.length > 0) {
    if (!options.hasUseRepo) {
      return { kind: "need-use-repo" };
    }
    const messageTimestamp = eligible?.messageTimestamp ?? options.confirmTimestamp;
    if (messageTimestamp === undefined) {
      return { kind: "need-apply" };
    }
    return {
      kind: "open-confirm",
      messageTimestamp,
      files,
      appliedEditCount: options.cards.filter(isEligibleCreatePrCard).length
    };
  }
  if (options.cards.some((card) => card.status === "pending")) {
    return { kind: "need-apply-pending" };
  }
  return { kind: "need-apply" };
}

export function createPrChatReply(routing: CreatePrChatRouting): string | undefined {
  switch (routing.kind) {
    case "open-confirm":
      return routing.appliedEditCount > 1 ? CREATE_PR_CHAT_OPENED_MULTI : CREATE_PR_CHAT_OPENED;
    case "need-apply":
      return CREATE_PR_CHAT_NEED_APPLY;
    case "need-apply-pending":
      return CREATE_PR_CHAT_NEED_APPLY_PENDING;
    case "need-use-repo":
      return CREATE_PR_CHAT_NEED_USE_REPO;
    case "none":
      return undefined;
  }
}
