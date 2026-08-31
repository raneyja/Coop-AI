import { hasRepoFactNeed, repoFactNeeds } from "../workspace/repoFactIntent";
import { needsRepoCode } from "./repoCodeIntent";

const INTENT_WORD_RE =
  /\b(what|how|why|where|when|who|which|explain|describe|show|find|trace|help|summarize|summarise|list|tell|debug|fix|review|compare|search|lookup|check|analyze|analyse|understand|owner|owners|decision|impact|blast|radius|gaps|error|fail|broken|issue|ticket|jira|slack|teams|confluence|notion|docs?|file|repo|repository|function|class|method|auth|login|deploy|build|docker|api|endpoint|route|handler|middleware|config|env|bug|refactor|migrate|implement|add|remove|update|change|does|is|are|can|could|should|would|will)\b/i;

/** Single-token pings — not a repo question. Multi-word "write a test" still counts via word count. */
const GENERIC_PING_RE =
  /^(?:test|hi|hello|hey|yo|ping|ok|okay|k|sup|hmm+|huh|wow|nice|cool|great|perfect|yes|yep|no|nope|sure|thanks|ty)[.!?]*$/i;

const COMMON_ENGLISH_BIGRAMS = new Set([
  "th",
  "he",
  "in",
  "er",
  "an",
  "re",
  "on",
  "at",
  "en",
  "nd",
  "ti",
  "es",
  "or",
  "te",
  "of",
  "ed",
  "is",
  "it",
  "al",
  "ar",
  "st",
  "to",
  "nt",
  "ng",
  "se",
  "ha",
  "as",
  "ou",
  "io",
  "le",
  "ve",
  "co",
  "me",
  "de",
  "hi",
  "ri",
  "ro",
  "ic",
  "ne",
  "ea",
  "ra",
  "ce",
  "li",
  "ch",
  "ll",
  "be",
  "ma",
  "si",
  "om",
  "ur"
]);

export type ClarifyFirstChatTurnOptions = {
  message: string;
  /** True when the thread already has at least one prior message (user or assistant). */
  hasPriorThreadMessages: boolean;
  hasQuickAction: boolean;
  hasAttachments: boolean;
  hasMentions: boolean;
  hasSourceHint: boolean;
  hasIntegrationProvider: boolean;
};

function looksLikeKeyboardMash(token: string): boolean {
  const normalized = token.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.length < 7) {
    return false;
  }
  if (INTENT_WORD_RE.test(normalized)) {
    return false;
  }
  if (/[-_./\\]/.test(token)) {
    return false;
  }

  let bigramHits = 0;
  for (let i = 0; i < normalized.length - 1; i++) {
    if (COMMON_ENGLISH_BIGRAMS.has(normalized.slice(i, i + 2))) {
      bigramHits++;
    }
  }

  const minHits = normalized.length >= 10 ? 2 : 1;
  return bigramHits < minHits;
}

/** True when plain chat text looks like a real question or task (not a ping or keyboard mash). */
export function hasDiscernibleChatIntent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  if (/```/.test(trimmed)) {
    return true;
  }
  if (/@[\w./-]/.test(trimmed)) {
    return true;
  }
  if (GENERIC_PING_RE.test(trimmed)) {
    return false;
  }
  if (trimmed.includes("?") && /[a-zA-Z0-9]/.test(trimmed)) {
    return true;
  }
  if (INTENT_WORD_RE.test(trimmed)) {
    return true;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return true;
  }

  if (words.length === 1) {
    const word = words[0]!;
    if (word.length <= 2) {
      return false;
    }
    if (looksLikeKeyboardMash(word)) {
      return false;
    }
    return true;
  }

  return false;
}

/** Plain chat with no discernible ask should clarify instead of summarizing context. */
export function shouldClarifyFirstChatTurn(options: ClarifyFirstChatTurnOptions): boolean {
  if (options.hasQuickAction) {
    return false;
  }
  if (options.hasPriorThreadMessages) {
    return false;
  }
  if (options.hasAttachments) {
    return false;
  }
  if (options.hasMentions) {
    return false;
  }
  if (options.hasSourceHint) {
    return false;
  }
  if (options.hasIntegrationProvider) {
    return false;
  }
  return !hasDiscernibleChatIntent(options.message);
}

export function buildMissingIntentClarificationResponse(context?: {
  file?: string;
  owner?: string;
  repo?: string;
}): string {
  const repoLabel =
    context?.owner?.trim() && context?.repo?.trim()
      ? `${context.owner.trim()}/${context.repo.trim()}`
      : "this repository";
  const filePath = context?.file?.trim();
  const fileHint = filePath ? `\`${filePath}\`` : "the open file";

  return [
    "**Answer**",
    "I didn't catch a specific question — tell me what you'd like to know and I'll use the repo context to answer.",
    "",
    "**Examples**",
    `- What does ${fileHint} do in ${repoLabel}?`,
    "- Who owns this area?",
    "- How does authentication work here?",
    "",
    "You can also run **Understand Repo** or type `/understand` for a guided overview."
  ].join("\n");
}

const THIS_REPO_RE = /\b(this|the|my)\s+(repo|repository|codebase|code\s*base)\b/i;
const WHICH_REPO_RE =
  /\b(what|which)\s+(repo|repository|codebase|code\s*base)\b|\brepo(?:sitory)?\s+(are\s+you|am\s+i|is)\s+looking\s+at\b/i;

/** True when the ask only makes sense against a selected Use-repo (or bound file). */
export function messageNeedsSelectedRepo(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  if (THIS_REPO_RE.test(trimmed) || WHICH_REPO_RE.test(trimmed)) {
    return true;
  }
  if (hasRepoFactNeed(repoFactNeeds(trimmed))) {
    return true;
  }
  return needsRepoCode(trimmed);
}

export function buildMissingRepoSelectionResponse(): string {
  return [
    "**Answer**",
    "No repository is selected in this chat, so I can't inspect a codebase yet.",
    "",
    "Click **Use repo** in the Remote workspace picker, then ask again."
  ].join("\n");
}
