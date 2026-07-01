const INTENT_WORD_RE =
  /\b(what|how|why|where|when|who|which|explain|describe|show|find|trace|help|summarize|summarise|list|tell|debug|fix|review|compare|search|lookup|check|analyze|analyse|understand|owner|owners|decision|impact|blast|radius|gaps|error|fail|broken|issue|ticket|jira|slack|teams|confluence|notion|docs?|file|repo|repository|function|class|method|test|auth|login|deploy|build|docker|api|endpoint|route|handler|middleware|config|env|bug|refactor|migrate|implement|add|remove|update|change|does|is|are|can|could|should|would|will)\b/i;

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

/** True when plain chat text looks like a real question or task (not keyboard mash). */
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

/** First turn in a new chat thread with no explicit action should clarify instead of summarizing context. */
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
