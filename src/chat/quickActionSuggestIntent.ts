/**
 * Deterministic quick-action suggest classifier for plain chat.
 * Suggest chips confirm before running the same pipelines as grid / slash commands.
 *
 * Phrase banks: PRIMARY (must) + SECONDARY (paraphrase / enterprise / slang).
 * Collisions + warning negatives keep chip spam down — see tests.
 */
import type { RepoContext } from "./types";
import type { QuickActionId } from "../webview/types";
import { isQuickActionBlockedForSuggest } from "../context/quickActionScope";
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
    "This looks like an ownership question. Want Find Owner for the full owner map (commits, reviews, Slack)?",
  "trace-decision":
    "This looks like a decision-history question. Want Trace Decision for why this code exists?",
  "blast-radius":
    "This looks like a change-impact question. Want Blast Radius for what else is affected?",
  "understand-repo":
    "This looks like a repo-overview question. Want Understand Repo for architecture and key systems?",
  "knowledge-gaps":
    "This looks like a documentation-gap question. Want Knowledge Gaps for what's missing or unclear?"
};

/** Product names highlighted in clarifying copy (bold + slash purple). */
export const SUGGEST_ACTION_DISPLAY_NAMES = [
  "Find Owner",
  "Trace Decision",
  "Blast Radius",
  "Understand Repo",
  "Knowledge Gaps"
] as const;

const SLASH_TOKEN_BY_ACTION: Record<QuickActionId, string> = {
  "understand-repo": "understand",
  "trace-decision": "trace",
  "find-owner": "owner",
  "blast-radius": "blast",
  "knowledge-gaps": "gaps"
};

/** Chip label: Run /blast — teaches the slash command while confirming the action. */
export function suggestRunChipLabel(actionId: QuickActionId): string {
  return `Run /${SLASH_TOKEN_BY_ACTION[actionId]}`;
}

const AMBIGUOUS_CLARIFY =
  "This could use a guided Coop workflow. Which one should I run?";

/**
 * PRIMARY + SECONDARY phrase banks (agent-expanded paraphrases).
 * Keep golden corpus in quickActionSuggestIntent.test.ts in sync.
 */
const POSITIVE: Record<QuickActionId, RegExp[]> = {
  "find-owner": [
    // Primary
    /\bwho\s+owns\b/i,
    /\bwho(?:'s|\s+is)\s+(?:the\s+)?(?:primary\s+)?(?:owner|owners|maintainer|maintainers|expert|experts|poc|contact)\b/i,
    /\bwho\s+(?:should\s+(?:i|we)\s+)?(?:ask|ping|contact|reach\s+out(?:\s+to)?|talk\s+to|message)\b/i,
    /\bwho\s+(?:to\s+)?(?:ask|ping|contact|escalate(?:\s+to)?)\b/i,
    /\bfind\s+(?:the\s+)?(?:owner|owners|maintainer|maintainers|expert|experts|poc)\b/i,
    /\b(?:codeowners?|ownership\s+map|ownership\s+signals?)\b/i,
    /\bmaintainer(?:s)?\s+(?:for|of)\b/i,
    /\bprimary\s+(?:contact|owner|expert|poc)\b/i,
    /\bwho\s+maintains\b/i,
    // Secondary
    /\bwho\s+(?:knows|understands|wrote|built|touches)\s+(?:this|the|about)\b/i,
    /\bwho(?:'s|\s+is)\s+(?:responsible|accountable)\b/i,
    /\bwho(?:'s|\s+is)\s+(?:the\s+)?(?:right|best)\s+person\b/i,
    /\bpoint\s+(?:me\s+)?(?:to|at)\s+(?:the\s+)?(?:owner|expert|maintainer|right\s+person)\b/i,
    /\bownership\s+(?:of|for|on)\b/i,
    /\b(?:file|code|area|domain)\s+owner\b/i,
    /\bowner(?:ship)?\s+(?:for|of)\s+this\b/i,
    /\bescalat(?:e|ion)\s+(?:to|path|contact)\b/i,
    /\bwho\s+last\s+(?:touched|changed|modified|committed)\b/i,
    /\bsubject[- ]matter\s+expert\b|\bsme\b/i,
    /\b(?:who(?:'s|\s+is)\s+(?:the\s+)?)?dri\s+for\b/i,
    /\bon[- ]point\s+for\b/i,
    /\bloop\s+(?:me\s+)?in\s+on\b/i,
    /\bgo[- ]to\s+(?:person|for)\b/i,
    /\bshepherds?\s+this\b/i,
    /\b(?:commit|merge)\s+rights\s+on\b/i,
    /\breviews?\s+prs?\s+in\s+this\s+(?:area|domain)\b/i,
    /\bhow\s+do\s+i\s+find\s+(?:the\s+)?(?:owner|who\s+to\s+ask)\b/i,
    /\bdomain\s+expert\s+for\b/i,
    /\bpoint\s+of\s+contact\s+for\b/i,
    /\btechnical\s+lead\s+for\b/i,
    /\bon[- ]call\s+(?:owner|for)\b/i,
    /\bunblock\s+me\s+on\b/i,
    /\bwhose\s+backlog\b/i,
    /\bstaffed\s+on\s+this\b/i,
    /\braci\b.{0,40}\b(?:for|on)\b/i,
    /\baccountable\s+for\s+this\s+(?:service|area|module|code)\b/i,
    /\btagging\s+the\s+right\s+person\b/i,
    /\bwho\s+can\s+(?:approve|unblock)\b/i
  ],
  "trace-decision": [
    // Primary
    /\bwhy\s+(?:was|is|are|did|do|does)\s+(?:this|the|it)\b/i,
    /\bwhy\s+(?:we|did\s+we|do\s+we|are\s+we)\b/i,
    /\bwhy\s+(?:choose|chose|picking|picked|using|use)\b/i,
    /\btrace\s+(?:the\s+)?(?:decision|history|rationale)\b/i,
    /\bdecision\s+history\b/i,
    /\brationale\s+(?:for|behind|of)\b/i,
    /\bwhy\s+(?:this|the)\s+(?:code|approach|design|pattern|choice|model|structure|abstraction)\b/i,
    /\bhow\s+did\s+(?:this|we|the)\s+(?:come|end)\s+up\b/i,
    /\btrade.?offs?\s+(?:for|behind|of|around)\b/i,
    // Secondary
    /\bhow\s+(?:did|does)\s+this\s+(?:get|come)\s+(?:here|about|to\s+be)\b/i,
    /\bhistorical\s+(?:context|reason|rationale)\b/i,
    /\borigin\s+(?:story|of)\b/i,
    /\bwhat(?:'s|\s+is)\s+the\s+(?:backstory|history|context)\s+(?:for|behind|of)\b/i,
    /\bwhy\s+was\s+(?:it|this)\s+(?:designed|implemented|modeled|written|built)\b/i,
    /\bdesign\s+(?:decision|rationale|trade.?off|history)\b/i,
    /\bcommit\s+history\s+(?:for|behind|of)\s+(?:this|why)\b/i,
    /\bprs?\s+(?:that\s+)?(?:introduced|explain|motivated)\b/i,
    /\bthinking\s+behind\b/i,
    /\boriginal\s+intent\s+(?:of|behind|for)\b/i,
    /\bwhy\b.{0,40}\bland(?:ed)?\s+on\b|\bland(?:ed)?\s+on\b.{0,40}\bwhy\b/i,
    /\balternatives?\s+(?:were\s+)?considered\b/i,
    /\bintentional\s+or\s+accidental\b/i,
    /\b(?:code\s+)?archaeology\b/i,
    /\bdig\s+into\s+why\b/i,
    /\bproblem\s+(?:was\s+this|this\s+was)\s+solving\b/i,
    /\bhow\s+do\s+i\s+find\s+why\b/i,
    /\badr\b|\barchitecture\s+decision\s+records?\b/i,
    /\bwhy\b.{0,40}\bthe\s+way\s+it\s+is\b|\bthe\s+way\s+it\s+is\b.{0,20}\bwhy\b/i,
    /\bmotivated\s+this\s+(?:change|approach|design)\b/i,
    /\bconstraints?\s+drove\b/i,
    /\bdecision\s+trail\b/i,
    /\bstory\s+behind\s+this\b/i,
    /\bwhy\s+(?:keep|retained?)\s+this\s+legacy\b/i,
    /\bwhy\s+(?:wasn't|was\s+not|didn'?t\s+we\s+use)\b/i,
    /\bhow\s+we\s+arrived\s+at\b/i
  ],
  "blast-radius": [
    // Primary
    /\bwhat\s+breaks\s+if\b/i,
    /\bwhat\s+(?:would|will|might|could)\s+break\b/i,
    /\bblast\s+radius\b/i,
    /\bchange\s+impact\b/i,
    /\bimpact\s+(?:analysis|radius)\b/i,
    /\bwhat\s+(?:else\s+)?(?:is\s+|gets?\s+|would\s+be\s+)?affected\b/i,
    /\bwho\s+calls\b/i,
    /\bdependents?\s+(?:of|on)\b/i,
    /\bif\s+(?:i|we)\s+(?:change|modify|rename|delete|remove|refactor|touch)\b/i,
    /\bimpact\s+of\s+(?:changing|editing|renaming|deleting|removing|refactoring)\b/i,
    /\bcallers?\s+(?:of|for|to)\b/i,
    // Secondary
    /\bwhat\s+(?:depends\s+on|imports?|uses)\s+this\b/i,
    /\brisk\s+(?:of|from)\s+(?:changing|renaming|deleting|editing)\b/i,
    /\bside\s+effects?\s+(?:of|from)\s+(?:changing|editing|renaming)\b/i,
    /\bdownstream\s+(?:impact|effects?|callers?|breakage)\b/i,
    /\bwhat\s+(?:would|will)\s+(?:this\s+)?(?:change|rename|delete)\s+(?:break|affect)\b/i,
    /\bsafe\s+to\s+(?:change|rename|delete|remove)\b/i,
    /\breference(?:s|d)?\s+(?:to|of)\s+this\s+(?:symbol|function|class|type|file)\b/i,
    /\bripple\s+effects?\s+of\s+(?:changing|editing|renaming|deleting)\b/i,
    /\bfan[- ]out\s+of\s+(?:this\s+)?(?:change|edit|refactor)\b/i,
    /\bblast\s+zone\b/i,
    /\bhow\s+far\s+(?:does|will)\s+this\s+change\s+reach\b/i,
    /\bused\s+elsewhere\b/i,
    /\b(?:find\s+)?all\s+(?:usages|references)\b/i,
    /\breverse\s+dependenc(?:y|ies)\b/i,
    /\btransitive\s+(?:impact|dependenc(?:y|ies)|breakage)\b/i,
    /\bregression\s+risk\s+if\b/i,
    /\bcoupled\s+to\s+this\b/i,
    /\b(?:delete\s+this\s+safely|safely\s+delete\s+this)\b/i,
    /\bconsumes?\s+this\s+api\b/i,
    /\bclient\s+impact\s+of\s+changing\b/i,
    /\bsurface\s+area\s+of\s+(?:this\s+)?refactor\b/i,
    /\bhow\s+do\s+i\s+find\s+what\s+depends\b/i,
    /\bfallout\s+from\s+(?:changing|modifying|renaming)\b/i,
    /\bcollateral\s+damage\s+if\b/i,
    /\brely\s+on\s+this\b/i,
    /\bbreakages?\s+before\s+i\s+(?:edit|change|rename)\b/i,
    /\bwho\s+else\s+consumes\b/i
  ],
  "understand-repo": [
    // Primary
    /\bunderstand\s+(?:this\s+)?(?:repo|repository|codebase|project)\b/i,
    /\bhow\s+is\s+(?:this\s+)?(?:repo|repository|codebase|project|monorepo)\s+structured\b/i,
    /\b(?:repo|repository|codebase|project|monorepo)\s+(?:architecture|overview|structure|layout|map)\b/i,
    /\barchitecture\s+(?:of\s+(?:this\s+)?(?:repo|repository|codebase|project)|overview)\b/i,
    /\bexplain\s+(?:this\s+)?(?:repo|repository|codebase|project|monorepo)\b/i,
    /\bkey\s+systems?\s+in\s+(?:this\s+)?(?:repo|repository|codebase|project)\b/i,
    /\bgive\s+me\s+(?:an?\s+)?(?:high[- ]level\s+)?overview\s+of\s+(?:this\s+)?(?:repo|repository|codebase|project)\b/i,
    // Secondary
    /\bhow\s+(?:does|is)\s+(?:this\s+)?(?:repo|repository|codebase|project|monorepo)\s+(?:organized|laid\s+out|put\s+together|structured)\b/i,
    /\bwhat(?:'s|\s+is)\s+(?:in\s+)?(?:the\s+)?(?:top[- ]level|overall)\s+(?:structure|layout|architecture)\b/i,
    /\bpackage\s+(?:boundaries|structure|layout)\b/i,
    /\bhigh[- ]level\s+(?:tour|overview|tour\s+of)\s+(?:this\s+)?(?:repo|repository|codebase)?\b/i,
    /\bmap\s+(?:of\s+)?(?:the\s+)?(?:(?:key\s+)?systems?|repo|repository|codebase)\b/i,
    /\borient\s+me\s+(?:to|on|around)\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bhow\s+(?:do\s+)?(?:the\s+)?(?:apps?|packages?|services?)\s+(?:fit|relate|connect)\b/i,
    /\bbig[- ]picture\s+(?:tour|overview)\s+of\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bbird'?s[- ]eye\s+view\s+of\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bwhere\s+should\s+i\s+start\s+in\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bmental\s+model\s+of\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\blay\s+of\s+the\s+land\s+(?:in|of)\s+(?:this\s+)?(?:repo|project|codebase)\b/i,
    /\bshape\s+of\s+(?:this\s+)?(?:monorepo|codebase|repository)\b/i,
    /\bcarved\s+up\b.{0,20}\b(?:codebase|repo|packages?)\b/i,
    /\bdomain\s+map\s+of\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\b(?:service|system)\s+map\s+(?:for|of)\s+(?:this\s+)?(?:repo|repository)\b/i,
    /\bget\s+oriented\s+in\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bonboarding\s+overview\s+of\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\b(?:repo|codebase)\s+topology\b/i,
    /\b10,?000[- ]foot\s+view\b/i,
    /\bmajor\s+areas?\s+of\s+(?:the\s+)?(?:code|codebase|repo)\b/i,
    /\bwhich\s+packages?\s+exist\b/i,
    /\bentry\s+points?\s+of\s+(?:this\s+)?(?:repo|repository|codebase)\b/i,
    /\bbefore\s+i\s+dive\s+in\b.{0,40}\b(?:repo|codebase|structure|overview)\b/i,
    /\bguide\s+me\s+through\s+(?:the\s+)?(?:repository|repo|codebase)\s+layout\b/i
  ],
  "knowledge-gaps": [
    // Primary
    /\bknowledge\s+gaps?\b/i,
    /\bwhat(?:'s|\s+is|\s+are)\s+(?:missing|undocumented|unclear)\b/i,
    /\bmissing\s+docs?\b/i,
    /\bundocumented\b/i,
    /\bwhat\s+(?:don'?t\s+we|do\s+we\s+not)\s+know\b/i,
    /\bdocs?\s+gaps?\b/i,
    /\bdocumentation\s+gaps?\b/i,
    /\bopen\s+questions?\s+(?:about|in|on|for)\b/i,
    /\bwhere\s+are\s+(?:the\s+)?docs?\s+(?:thin|missing|weak|lacking|sparse)\b/i,
    // Secondary
    /\bwhat\s+(?:is|are)\s+(?:poorly|not)\s+documented\b/i,
    /\bwhere\s+(?:is|are)\s+(?:documentation|docs)\s+(?:missing|weak|thin)\b/i,
    /\bunknowns?\s+(?:in|about|around)\b/i,
    /\bblind\s+spots?\b/i,
    /\bcoverage\s+gaps?\s+(?:in\s+)?(?:docs?|documentation|knowledge)\b/i,
    /\bwhat\s+should\s+(?:we|i)\s+document\b/i,
    /\btribal\s+knowledge\b/i,
    /\bwhere\s+(?:is|are)\s+(?:ownership|docs?)\s+unclear\b/i,
    /\bbus\s+factor\b.{0,40}\b(?:docs?|documentation|knowledge)\b/i,
    /\bin\s+people'?s\s+heads\b/i,
    /\bdocumentation\s+debt\b/i,
    /\bunder[- ]?documented\b/i,
    /\bnew\s+hire\b.{0,40}\b(?:docs?|documentation|find)\b/i,
    /\boral\s+tradition\b/i,
    /\bdark\s+corners?\s+(?:of\s+)?(?:the\s+)?docs?\b/i,
    /\binstitutional\s+knowledge\s+(?:missing|gaps?)\b/i,
    /\bneeds?\s+a\s+runbook\b/i,
    /\breadme\s+gaps?\b/i,
    /\bhow\s+do\s+i\s+find\s+what(?:'s|\s+is)\s+undocumented\b/i,
    /\bdocs?\s+(?:that\s+)?don'?t\s+match\s+(?:the\s+)?code\b/i,
    /\bmissing\s+(?:adrs?|design\s+docs?)\b/i,
    /\bknowledge\s+silos?\b/i,
    /\bsparse\s+(?:wiki|docs?|documentation)\b/i,
    /\bwrite\s+down\s+before\s+someone\s+leaves\b/i,
    /\bunknown\s+unknowns?\b/i,
    /\bonboarding\s+faq\b.{0,20}\b(?:lack|missing|need)\b/i
  ]
};

/**
 * Suppress a hit or divert score. Applied after positives.
 * "who owns this decision" should not be Owner-only.
 */
const OWNER_DECISION_RE = /\bwho\s+owns\s+(?:this\s+)?decision\b/i;
const TRACE_DECISION_OWNERSHIP_RE =
  /\b(?:decision|rationale|trade.?off).{0,40}\b(?:owner|owns|who)\b|\b(?:owner|owns|who).{0,40}\b(?:decision|rationale)\b/i;

/** Leading slash tokens that mean the user already picked a command (incl. aliases). */
const EXPLICIT_SLASH_LEAD_RE =
  /^\/(?:understand|understandrepo|repo|architecture|explain|trace|why|decision|history|owner|who|find-owner|blast|impact|blast-radius|gaps|unknowns|knowledge-gaps)\b/i;

/** Product / schedule "impact" — not Blast Radius. */
const NON_CODE_IMPACT_RE =
  /\b(?:business|revenue|customer|timeline|sprint|headcount)\s+impact\b/i;

/** Test/code coverage gaps — not Knowledge Gaps docs. */
const TEST_COVERAGE_GAPS_RE = /\b(?:test|code)\s+coverage\s+gaps?\b/i;

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
    /\bwhat\s+does\s+(?:this\s+)?(?:file|function|class|method)\b/i.test(message) ||
    /\bwalk\s+me\s+through\s+(?:this\s+)?(?:file|function|class|method)\b/i.test(message)
  ) {
    scores.set("understand-repo", 0);
  }

  // Business / timeline impact is not code blast radius.
  if (NON_CODE_IMPACT_RE.test(message)) {
    scores.set("blast-radius", 0);
  }

  // Test coverage ≠ documentation knowledge gaps.
  if (TEST_COVERAGE_GAPS_RE.test(message)) {
    scores.set("knowledge-gaps", 0);
  }

  // Generic "impact" without change language should not force Blast.
  if ((scores.get("blast-radius") ?? 0) > 0) {
    const strongBlast =
      /\bwhat\s+(?:breaks|would\s+break|will\s+break)\b/i.test(message) ||
      /\bblast\s+(?:radius|zone)\b/i.test(message) ||
      /\bif\s+(?:i|we)\s+(?:change|modify|rename|delete|remove|refactor|touch)\b/i.test(message) ||
      /\bwho\s+calls\b/i.test(message) ||
      /\bdependents?\b/i.test(message) ||
      /\bcallers?\b/i.test(message) ||
      /\bchange\s+impact\b/i.test(message) ||
      /\bimpact\s+of\s+(?:changing|editing|renaming|deleting|removing|refactoring|modifying)\b/i.test(
        message
      ) ||
      /\bestimate\s+(?:the\s+)?(?:change\s+)?impact\b/i.test(message) ||
      /\baffected\b/i.test(message) ||
      /\bdownstream\b/i.test(message) ||
      /\bsafe\s+to\s+(?:change|rename|delete|remove)\b/i.test(message) ||
      /\bwhat\s+depends\s+on\b/i.test(message) ||
      /\bripple\s+effects?\b/i.test(message) ||
      /\bfan[- ]out\b/i.test(message) ||
      /\ball\s+(?:usages|references)\b/i.test(message);
    if (!strongBlast && /\bimpact\b/i.test(message) && !/\baffected\b/i.test(message)) {
      scores.set("blast-radius", Math.min(scores.get("blast-radius") ?? 0, 1));
    }
  }

  // Package-boundary / monorepo layout questions are Understand, not Gaps.
  if (
    /\bpackage\s+boundaries\b/i.test(message) ||
    /\btop[- ]level\s+(?:structure|package)\b/i.test(message)
  ) {
    const understand = scores.get("understand-repo") ?? 0;
    if (understand === 0) {
      scores.set("understand-repo", 2);
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

/** Build a suggest offer from a single model-classified action. */
export function offerFromActionId(
  actionId: QuickActionId,
  confidence: SuggestConfidence = "medium"
): SuggestQuickActionsResult {
  const suggestions: QuickActionSuggestion[] = [
    {
      actionId,
      score: confidence === "high" ? 5 : 3,
      label: labelFor(actionId)
    }
  ];
  return {
    confidence,
    suggestions,
    clarifyingPrompt: clarifyingPromptFor(suggestions)
  };
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
  if (EXPLICIT_SLASH_LEAD_RE.test(text)) {
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

/** Drop actions that cannot run from suggest chips in the current context. */
export function filterSuggestableActions(
  suggestions: QuickActionSuggestion[],
  context: RepoContext
): QuickActionSuggestion[] {
  return suggestions.filter((entry) => !isQuickActionBlockedForSuggest(entry.actionId, context));
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
