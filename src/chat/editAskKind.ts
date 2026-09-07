/**
 * `/edit` only names the target (open file / highlight / repo). The user's words
 * are the spec. Rewrite the highlighted block only when they explicitly ask.
 */

export type EditAskKind = "comment" | "rewrite" | "default";

const SLASH_EDIT_RE = /^\/(?:edit|patch|fix)\b/i;
const CONTEXT_CHIP_LINE_RE = /^(file|repo|branch|selection):/i;

const COMMENT_ASK_RE =
  /\b((?:leave|add|insert|write|put|include)\b.{0,80}\b(?:a |the )?(?:brief |short |one[\s-]+(?:line|sentence) )?(?:comment|jsdoc|docstring)|comment above|jsdoc|docstring)\b/i;

const SUMMARY_WHAT_IT_DOES_RE =
  /\bsummar(?:y|ize|ise)\b.{0,80}\bwhat (?:it|this|the (?:code|function|method|constructor|block))\s+does\b/i;

const ONE_SENTENCE_RE =
  /\b(?:just\s+)?(?:make|keep|use)\s+it\s+(?:a\s+)?one[\s-]*(?:senten[cs]e|line|liner)\b/i;

const REWRITE_ASK_RE =
  /\b(rewrite|refactor|make more efficient|shorten (?:this|the highlighted|the selection)|replace (?:this|the highlighted|the selection))\b/i;

function stripEditDecorators(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !CONTEXT_CHIP_LINE_RE.test(line))
    .join(" ")
    .replace(SLASH_EDIT_RE, "")
    .trim();
}

function isCommentAskText(text: string): boolean {
  if (!text) {
    return false;
  }
  if (COMMENT_ASK_RE.test(text) || SUMMARY_WHAT_IT_DOES_RE.test(text) || ONE_SENTENCE_RE.test(text)) {
    return true;
  }
  return false;
}

function isRewriteAskText(text: string): boolean {
  return REWRITE_ASK_RE.test(text);
}

export function resolveEditAskKind(
  message: string,
  options?: { priorUserMessages?: string[] }
): EditAskKind {
  const text = stripEditDecorators(message);
  const commentAsk = isCommentAskText(text);
  const rewriteAsk = isRewriteAskText(text);
  if (commentAsk && !rewriteAsk) {
    return "comment";
  }
  if (commentAsk && rewriteAsk) {
    // "rewrite the comment" still inserts documentation, not a code refactor.
    return "comment";
  }
  if (rewriteAsk) {
    return "rewrite";
  }
  const prior = options?.priorUserMessages ?? [];
  if (text.length > 0 && text.length <= 120 && !rewriteAsk) {
    for (let i = prior.length - 1; i >= 0; i -= 1) {
      if (resolveEditAskKind(prior[i] ?? "") === "comment") {
        return "comment";
      }
    }
  }
  return "default";
}

export function isCommentOnlyEditAsk(
  message: string,
  options?: { priorUserMessages?: string[] }
): boolean {
  return resolveEditAskKind(message, options) === "comment";
}
