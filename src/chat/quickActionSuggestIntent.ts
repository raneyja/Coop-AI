/**
 * Deterministic quick-action suggest classifier for plain chat.
 * Suggest chips confirm before running the same pipelines as grid / slash commands.
 *
 * Spec matrix (Phase 0): positives, negatives, collisions, file rules — see tests.
 */
import type { RepoContext } from "./types";
import type { QuickActionId } from "../webview/types";
import { isQuickActionBlocked } from "../context/quickActionScope";
import { SLASH_COMMANDS } from "../context/slashCommands";

export type SuggestConfidence = "high" | "medium" | "low";

export type QuickActionSuggestion = {
  actionId: QuickActionId;
  score: number;
  label: string;
};

export type SuggestQuickActionsResult = {
  confidence: SuggestConfidence;
  suggestions: QuickActionSuggestion[];
  clarifyingPrompt: string;
};

export type SuggestQuickActionsOptions = {
  /** When true, skip classification (slash / QA / prior suggest resume). */
  disabled?: boolean;
};

type ScoredHit = { actionId: QuickActionId; score: number };

const LABEL_BY_ACTION: Record<QuickActionId, string> = {
  "understand-repo": "Understand Repo",
  "trace-decision": "Trace Decision",
  "find-owner": "Find Owner",
  "blast-radius": "Blast Radius",
  "knowledge-gaps": "Knowledge Gaps"
};

const CLARIFY_BY_ACTION: Record<QuickActionId, string> = {
  "find-owner":
    "This looks like an ownership question. Want the full owner map (commits, reviews, Slack)?",
  "trace-decision":
    "This looks like a decision-history question. Want Trace Decision for why this code exists?",
  "blast-radius":
    "This looks like a change-impact question. Want Blast Radius for what else is affected?",
  "understand-repo":
    "This looks like a repo-overview question. Want Understand Repo for architecture and key systems?",
  "knowledge-gaps":
    "This looks like a documentation-gap question. Want Knowledge Gaps for what's missing or unclear?"
};

const AMBIGUOUS_CLARIFY =
  "This could use a guided Coop workflow. Which one should I run?";

/** Phrase banks — keep in sync with quickActionSuggestIntent.test.ts. */
const POSITIVE: Record<QuickActionId, RegExp[]> = {
  "find-owner": [
    /\bwho\s+owns\b/i,
    /\bwho(?:'s|\s+is)\s+(?:the\s+)?(?:primary\s+)?(?:owner|owners|maintainer|maintainers|expert|experts)\b/i,
    /\bwho\s+(?:should\s+i\s+)?(?:ask|ping|contact|reach\s+out)\b/i,
    /\bwho\s+(?:to\s+)?(?:ask|ping|contact)\b/i,
    /\bfind\s+(?:the\s+)?(?:owner|owners|maintainer|expert)\b/i,
    /\b(?:codeowners?|ownership\s+map)\b/i,
    /\bmaintainer(?:s)?\s+(?:for|of)\b/i,
    /\bprimary\s+(?:contact|owner|expert)\b/i,
    /\bwho\s+maintains\b/i
  ],
  "trace-decision": [
    /\bwhy\s+(?:was|is|are|did|do|does)\s+(?:this|the)\b/i,
    /\bwhy\s+(?:we|did\s+we|do\s+we)\b/i,
    /\btrace\s+(?:the\s+)?decision\b/i,
    /\bdecision\s+history\b/i,
    /\brationale\s+(?:for|behind)\b/i,
    /\bwhy\s+(?:this|the)\s+(?:code|approach|design|pattern|choice)\b/i,
    /\bhow\s+did\s+(?:this|we)\s+(?:come|end)\s+up\b/i,
    /\btrade.?offs?\s+(?:for|behind|of)\b/i
  ],
  "blast-radius": [
    /\bwhat\s+breaks\s+if\b/i,
    /\bblast\s+radius\b/i,
    /\bchange\s+impact\b/i,
    /\bwhat\s+(?:else\s+)?(?:is\s+)?affected\b/i,
    /\bwho\s+calls\b/i,
    /\bdependents?\s+of\b/i,
    /\bif\s+i\s+(?:change|modify|rename|delete|remove)\b/i,
    /\bimpact\s+(?:of\s+(?:changing|editing)|analysis)\b/i,
    /\bcallers?\s+(?:of|for)\b/i
  ],
  "understand-repo": [
    /\bunderstand\s+(?:this\s+)?(?:repo|repository)\b/i,
    /\bhow\s+is\s+(?:this\s+)?(?:repo|repository|codebase)\s+structured\b/i,
    /\brepo\s+(?:architecture|overview|structure)\b/i,
    /\barchitecture\s+(?:of\s+(?:this\s+)?(?:repo|repository)|overview)\b/i,
    /\bexplain\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bkey\s+systems?\s+in\s+(?:this\s+)?(?:repo|repository)\b/i,
    /\bgive\s+me\s+(?:an?\s+)?overview\s+of\s+(?:this\s+)?(?:repo|repository)\b/i
  ],
  "knowledge-gaps": [
    /\bknowledge\s+gaps?\b/i,
    /\bwhat(?:'s|\s+is)\s+(?:missing|undocumented)\b/i,
    /\bmissing\s+docs?\b/i,
    /\bundocumented\b/i,
    /\bwhat\s+(?:don'?t|do\s+we\s+not)\s+know\b/i,
    /\bdocs?\s+gaps?\b/i,
    /\bopen\s+questions?\s+(?:about|in)\b/i,
    /\bwhere\s+are\s+(?:the\s+)?docs?\s+(?:thin|missing|weak)\b/i
  ]
};

/**
 * Suppress a hit or divert score. Applied after positives.
 * "who owns this decision" should not be Owner-only.
 */
const OWNER_DECISION_RE = /\bwho\s+owns\s+(?:this\s+)?decision\b/i;
const TRACE_DECISION_OWNERSHIP_RE =
  /\b(?:decision|rationale|trade.?off).{0,40}\b(?:owner|owns|who)\b|\b(?:owner|owns|who).{0,40}\b(?:decision|rationale)\b/i;

function labelFor(actionId: QuickActionId): string {
  const fromSlash = SLASH_COMMANDS.find(
    (def) => def.target.kind === "action" && def.target.actionId === actionId
  );
  return fromSlash?.label ?? LABEL_BY_ACTION[actionId];
}

function scoreAction(message: string, actionId: QuickActionId): number {
  let score = 0;
  for (const re of POSITIVE[actionId]) {
    if (re.test(message)) {
      score += 2;
    }
  }
  return score;
}

function applyCollisionAdjustments(message: string, scores: Map<QuickActionId, number>): void {
  if (OWNER_DECISION_RE.test(message) || TRACE_DECISION_OWNERSHIP_RE.test(message)) {
    const owner = scores.get("find-owner") ?? 0;
    const trace = scores.get("trace-decision") ?? 0;
    if (owner > 0) {
      scores.set("find-owner", Math.max(1, owner - 1));
      scores.set("trace-decision", Math.max(trace, owner + 1));
    }
  }

  // "explain this file" is not Understand Repo (repo-wide).
  if (
    /\bexplain\s+(?:this\s+)?(?:file|function|class|method)\b/i.test(message) ||
    /\bwhat\s+does\s+(?:this\s+)?(?:file|function|class|method)\b/i.test(message)
  ) {
    scores.set("understand-repo", 0);
  }

  // Generic "impact" without change language should not force Blast.
  if ((scores.get("blast-radius") ?? 0) > 0) {
    const strongBlast =
      /\bwhat\s+breaks\b/i.test(message) ||
      /\bblast\s+radius\b/i.test(message) ||
      /\bif\s+i\s+(?:change|modify|rename|delete|remove)\b/i.test(message) ||
      /\bwho\s+calls\b/i.test(message) ||
      /\bdependents?\b/i.test(message) ||
      /\bcallers?\b/i.test(message) ||
      /\bchange\s+impact\b/i.test(message);
    if (!strongBlast && /\bimpact\b/i.test(message) && !/\baffected\b/i.test(message)) {
      scores.set("blast-radius", Math.min(scores.get("blast-radius") ?? 0, 1));
    }
  }
}

function confidenceFor(topScore: number, count: number): SuggestConfidence {
  if (topScore >= 4 || (topScore >= 2 && count === 1)) {
    return "high";
  }
  if (topScore >= 2) {
    return "medium";
  }
  return "low";
}

function clarifyingPromptFor(suggestions: QuickActionSuggestion[]): string {
  if (suggestions.length === 0) {
    return AMBIGUOUS_CLARIFY;
  }
  if (suggestions.length === 1) {
    return CLARIFY_BY_ACTION[suggestions[0]!.actionId];
  }
  return AMBIGUOUS_CLARIFY;
}

/**
 * Classify plain-chat text into 0–2 quick-action suggestions.
 * Does not check file/repo gates — call {@link filterSuggestableActions} before showing chips.
 */
export function suggestQuickActions(
  message: string,
  options?: SuggestQuickActionsOptions
): SuggestQuickActionsResult {
  if (options?.disabled) {
    return { confidence: "low", suggestions: [], clarifyingPrompt: "" };
  }

  const text = message.trim();
  if (!text || text.length < 8) {
    return { confidence: "low", suggestions: [], clarifyingPrompt: "" };
  }

  // Already an explicit slash / tagged quick action — never suggest.
  if (/^\/(?:understand|trace|owner|blast|gaps|who|why|impact)\b/i.test(text)) {
    return { confidence: "low", suggestions: [], clarifyingPrompt: "" };
  }
  if (/^\[[\w-]+\]/.test(text)) {
    return { confidence: "low", suggestions: [], clarifyingPrompt: "" };
  }

  const scores = new Map<QuickActionId, number>();
  for (const actionId of Object.keys(POSITIVE) as QuickActionId[]) {
    const score = scoreAction(text, actionId);
    if (score > 0) {
      scores.set(actionId, score);
    }
  }

  applyCollisionAdjustments(text, scores);

  const hits: ScoredHit[] = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .map(([actionId, score]) => ({ actionId, score }))
    .sort((a, b) => b.score - a.score || a.actionId.localeCompare(b.actionId));

  if (hits.length === 0) {
    return { confidence: "low", suggestions: [], clarifyingPrompt: "" };
  }

  const topScore = hits[0]!.score;
  // Drop weak runners-up more than 2 points behind the leader.
  const ranked = hits.filter((hit) => hit.score >= topScore - 2).slice(0, 2);
  const confidence = confidenceFor(topScore, ranked.length);

  if (confidence === "low") {
    return { confidence: "low", suggestions: [], clarifyingPrompt: "" };
  }

  const suggestions: QuickActionSuggestion[] = ranked.map((hit) => ({
    actionId: hit.actionId,
    score: hit.score,
    label: labelFor(hit.actionId)
  }));

  return {
    confidence,
    suggestions,
    clarifyingPrompt: clarifyingPromptFor(suggestions)
  };
}

/** Drop actions the grid would block for the current context. */
export function filterSuggestableActions(
  suggestions: QuickActionSuggestion[],
  context: RepoContext
): QuickActionSuggestion[] {
  return suggestions.filter((entry) => !isQuickActionBlocked(entry.actionId, context));
}

/** True when the classifier wants an interrupt (chips) instead of plain gather. */
export function shouldOfferQuickActionSuggest(
  message: string,
  context: RepoContext,
  options?: SuggestQuickActionsOptions
): SuggestQuickActionsResult | undefined {
  const result = suggestQuickActions(message, options);
  if (result.confidence === "low" || result.suggestions.length === 0) {
    return undefined;
  }
  const available = filterSuggestableActions(result.suggestions, context);
  if (available.length === 0) {
    return undefined;
  }
  return {
    ...result,
    suggestions: available,
    clarifyingPrompt: clarifyingPromptFor(available)
  };
}
