import { stripEmittedPatchBlocks } from "./agentProposedPatch";

/** Shown only when there is no answer to keep — never appended to one. */
export const CUSTOMER_EMPTY_HUNT_ANSWER =
  "I couldn't find that in this repo. Try a more specific name, or open the file.";

const PATCH_OR_FENCE_RE =
  /```(?:patch|diff)[\s\S]*?```|<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g;

const INTERN_SPEAK_RE = [
  /\bevidence bundle\b/i,
  /\b(?:attached\s+)?search samples?\b/i,
  /\bindex is stale\b/i,
  /\bstale index\b/i,
  /\brun the indexed search\b/i,
  /\bIf you want I can\b/i,
  /\bzero hits for\b/i,
  /\bsearch returned zero hits\b/i,
  /\bindex returned no usable match/i,
  /\d+\s+issue\(s\) in the attached search sample/i,
  /\bConnect (?:missing tools )?in Coop Settings/i,
  /\boffer to re-index\b/i,
  /\bsuggest Deep-Index/i,
  /\breindex\b/i,
  /\bsoft gather\b/i,
  /\bgather budget\b/i
];

const OPERATE_COOP_RE = [
  /\bIf you want I can\b/i,
  /\brun the indexed search\b/i,
  /\bindex is stale\b/i,
  /\bstale index\b/i,
  /\boffer to re-index\b/i,
  /\bsuggest Deep-Index/i,
  /\bConnect (?:missing tools )?in Coop Settings/i,
  /\breindex\b/i,
  /\bsoft gather\b/i,
  /\bgather budget\b/i
];

function hasInternSpeak(content: string): boolean {
  return INTERN_SPEAK_RE.some((pattern) => pattern.test(content));
}

function tidyPhrase(value: string): string {
  return value
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/^[,;:\s]+/, "")
    .replace(/[ \t]+$/g, "");
}

function huntMissCopy(symbol?: string): string {
  const name = symbol?.trim();
  if (!name || /^(?:that|it|those terms|the terms tried)$/i.test(name)) {
    return CUSTOMER_EMPTY_HUNT_ANSWER;
  }
  return `I couldn't find ${name} in this repo. Try a more specific name, or open the file.`;
}

function symbolFromHaystack(haystack: string): string | undefined {
  const tick = haystack.match(/`([^`]+)`/);
  if (tick?.[1]?.trim()) {
    return tick[1].trim();
  }
  const named = haystack.match(
    /\b(?:for|of)\s+(?:the\s+)?(?:symbol|term|identifier)\s+[`'"]?([A-Za-z_][\w.]*)[`'"]?/i
  );
  return named?.[1]?.trim();
}

function rewriteZeroHits(text: string): string {
  let out = text.replace(
    /\b((?:Slack|Teams|Jira))\s+search\s+returned\s+zero\s+hits(?:\s+for\s+(?:`([^`]+)`|"([^"]+)"|'([^']+)'|(\S+)))?/gi,
    (_full, tool: string, tick?: string, dquote?: string, squote?: string, bare?: string) => {
      const topic = (tick || dquote || squote || bare)?.replace(/^[`'"]+|[`'"]+$/g, "").replace(/[.,;:]+$/, "");
      if (/jira/i.test(tool)) {
        return topic
          ? `No Jira ticket matching ${topic} in what came back`
          : "No Jira ticket matching that in what came back";
      }
      return topic ? `No mention in ${tool} of ${topic}` : `No mention in ${tool} of that`;
    }
  );
  out = out.replace(
    /\bzero hits for\s+(?:`([^`]+)`|"([^"]+)"|'([^']+)'|(\S+))/gi,
    (full, tick?: string, dquote?: string, squote?: string, bare?: string) => {
      const topic = (tick || dquote || squote || bare)?.replace(/[.,;:]+$/, "");
      if (!topic) {
        return full;
      }
      if (/\bslack\b/i.test(text)) {
        return `No mention in Slack of ${topic}`;
      }
      if (/\bteams\b/i.test(text)) {
        return `No mention in Teams of ${topic}`;
      }
      if (/\bjira\b/i.test(text)) {
        return `No Jira ticket matching ${topic} in what came back`;
      }
      return `No mention of ${topic}`;
    }
  );
  return out;
}

function rewriteIndexMiss(text: string): string {
  return text.replace(
    /\b(?:the\s+)?index returned no usable match(?:es)?(?:\s+for\s+(?:those terms|the terms tried|`([^`]+)`|"([^"]+)"|'([^']+)'|(\S+)))?/gi,
    (_full, tick?: string, dquote?: string, squote?: string, bare?: string) => {
      const topic = (tick || dquote || squote || bare)?.replace(/[.,;:]+$/, "");
      return huntMissCopy(topic ?? symbolFromHaystack(text));
    }
  );
}

function rewriteJargonPhrases(text: string): string {
  let out = text;
  out = out.replace(
    /(\d+)\s+issue\(s\) in the attached search sample/gi,
    "$1 issues"
  );
  out = out.replace(
    /\b(?:from|in|according to)\s+(?:the\s+)?(?:attached\s+)?evidence bundle\b/gi,
    ""
  );
  out = out.replace(/\bthe evidence bundle\b/gi, "what we found");
  out = out.replace(/\bevidence bundle\b/gi, "sources");
  out = out.replace(/\bin the attached search sample\b/gi, "");
  out = out.replace(/\bthis attached search sample\b/gi, "this search");
  out = out.replace(/\b(?:attached\s+)?search samples?\b/gi, "results");
  out = rewriteZeroHits(out);
  out = rewriteIndexMiss(out);
  out = out.replace(/\bConnect (?:missing tools )?in Coop Settings[^.!\n]*/gi, "");
  return tidyPhrase(out);
}

function isOperateCoopSentence(sentence: string): boolean {
  return OPERATE_COOP_RE.some((pattern) => pattern.test(sentence));
}

function dropOperateCoopSentences(text: string): string {
  const pieces = text.split(/([.!?]+)(\s+|$)/);
  const kept: string[] = [];
  for (let i = 0; i < pieces.length; i += 3) {
    const sentence = pieces[i] ?? "";
    const punct = pieces[i + 1] ?? "";
    const space = pieces[i + 2] ?? "";
    if (!sentence.trim()) {
      kept.push(sentence, punct, space);
      continue;
    }
    if (isOperateCoopSentence(sentence)) {
      continue;
    }
    kept.push(sentence, punct, space);
  }
  return kept.join("").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n");
}

function rewriteLine(line: string): string | null {
  const prefixMatch = line.match(/^(\s*(?:[-*]\s+|\d+\.\s+)?)/);
  const prefix = prefixMatch?.[1] ?? "";
  const body = line.slice(prefix.length);
  if (!body.trim()) {
    return line;
  }
  let next = rewriteJargonPhrases(body);
  next = dropOperateCoopSentences(next).trim();
  if (!next) {
    return null;
  }
  return `${prefix}${next}`;
}

function rewriteSegment(segment: string): string {
  return segment
    .split("\n")
    .map(rewriteLine)
    .filter((line): line is string => line !== null)
    .join("\n");
}

function rewritePreservingPatches(content: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const match of content.matchAll(PATCH_OR_FENCE_RE)) {
    const idx = match.index ?? 0;
    parts.push(rewriteSegment(content.slice(last, idx)));
    parts.push(match[0]);
    last = idx + match[0].length;
  }
  parts.push(rewriteSegment(content.slice(last)));
  return parts.join("").replace(/\n{3,}/g, "\n\n");
}

/**
 * Last-gate bubble rewriter. Sentences with intern-speak become teammate English.
 * Answers with none of those phrases are returned unchanged (byte-identical).
 */
export function rewriteCustomerFacingProse(content: string): string {
  if (!hasInternSpeak(content)) {
    return content;
  }
  const rewritten = rewritePreservingPatches(content);
  if (!rewritten.trim()) {
    return content;
  }
  return rewritten;
}

/**
 * Chat bubbles are customer-facing. Hunt/index/patch internals belong in
 * activity, never concatenated onto an answer that already shipped.
 *
 * If the turn produced prose, that prose is the product. Do not append
 * "couldn't produce an apply-able patch" / "use /edit" / "the index".
 */
export function customerFacingAgentAnswer(options: {
  content: string;
  hasApplyPatch: boolean;
}): string {
  if (options.hasApplyPatch) {
    return rewriteCustomerFacingProse(options.content);
  }
  return rewriteCustomerFacingProse(stripEmittedPatchBlocks(options.content).trim());
}
