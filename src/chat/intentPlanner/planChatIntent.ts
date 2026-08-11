/**
 * Rules-based Chat Intent Planner (phrase-first).
 * Model classification is optional and layered in planChatIntentModel.ts.
 */
import type { IntegrationChatProvider } from "../types";
import {
  CHAT_INTENT_TOOL_PROVIDERS,
  emptyChatIntentPlan,
  type ChatIntentPlan,
  type ChatIntentPlannerInput,
  type ChatIntentWorkflow
} from "./types";
import { wantsJiraContext } from "../../context/jiraContext";
import { wantsSlackContext } from "../../context/slackContext";
import { wantsTeamsContext } from "../../context/teamsContext";
import { wantsConfluenceContext } from "../../context/confluenceContext";
import { wantsNotionContext } from "../../context/notionContext";
import { wantsGoogleDocsContext } from "../../context/googleDocsContext";
import { isIncidentShapedQuery } from "../../context/incidentIntent";

const WORKFLOW_PATTERNS: Array<{
  workflow: ChatIntentWorkflow;
  patterns: RegExp[];
  confidence: "high" | "medium";
}> = [
  {
    workflow: "blast-radius",
    confidence: "high",
    patterns: [
      /\bblast\s*radius\b/i,
      /\b(files?|code|callers?|dependents?)\b.{0,40}\b(impact|impacted|affected|break|breaks|breaking)\b/i,
      /\b(impact|impacted|affected)\b.{0,40}\b(files?|change|changes|callers?|dependents?)\b/i,
      /\bwhat\s+(breaks|is\s+affected|will\s+break)\b/i,
      /\bwho\s+calls?\b/i,
      /\bchange\s+impact\b/i
    ]
  },
  {
    workflow: "trace-decision",
    confidence: "high",
    patterns: [
      /\btrace\s+(the\s+)?decision\b/i,
      /\bwhy\s+(was|is|did)\b.{0,60}\b(written|added|changed|decided|introduced)\b/i,
      /\bdecision\s+history\b/i,
      /\bwho\s+decided\b/i
    ]
  },
  {
    workflow: "find-owner",
    confidence: "high",
    patterns: [
      /\bwho\s+(owns|maintains|is\s+responsible)\b/i,
      /\b(code\s+)?owners?\b/i,
      /\bfind\s+owner\b/i
    ]
  },
  {
    workflow: "understand-repo",
    confidence: "medium",
    patterns: [
      /\bunderstand\s+(this\s+)?(repo|repository|codebase)\b/i,
      /\b(repo|repository|codebase)\s+(overview|architecture|structure)\b/i,
      /\bhow\s+is\s+(this\s+)?(repo|repository|codebase)\s+organized\b/i
    ]
  },
  {
    workflow: "knowledge-gaps",
    confidence: "medium",
    patterns: [
      /\bknowledge\s+gaps?\b/i,
      /\b(missing|undocumented)\s+(docs?|documentation)\b/i,
      /\bwhere\s+are\s+(we|docs?)\s+thin\b/i
    ]
  }
];

const TOOL_NAME_PATTERNS: Array<{ provider: IntegrationChatProvider; pattern: RegExp }> = [
  { provider: "jira", pattern: /\bjira\b/i },
  { provider: "slack", pattern: /\bslack\b/i },
  { provider: "teams", pattern: /\b(ms\s*)?teams\b/i },
  { provider: "confluence", pattern: /\bconfluence\b/i },
  { provider: "notion", pattern: /\bnotion\b/i },
  { provider: "google-docs", pattern: /\b(google\s*docs?|gdocs?)\b/i }
];

const EXPLAIN_ONLY =
  /^(what\s+does\s+this\s+(function|method|class|file)\s+do\b|explain\s+this\s+(function|method|class|file|code)\b)/i;

/**
 * Detect named tools in the user ask, filtered to connected tools.
 */
export function detectRequestedTools(
  message: string,
  connectedTools: IntegrationChatProvider[]
): IntegrationChatProvider[] {
  const connected = new Set(connectedTools);
  const found: IntegrationChatProvider[] = [];
  for (const { provider, pattern } of TOOL_NAME_PATTERNS) {
    if (!connected.has(provider)) {
      continue;
    }
    if (pattern.test(message) || legacyWants(provider, message)) {
      found.push(provider);
    }
  }
  // Preserve stable priority matching single-route order when multiple match.
  return CHAT_INTENT_TOOL_PROVIDERS.filter((p) => found.includes(p));
}

function legacyWants(provider: IntegrationChatProvider, message: string): boolean {
  switch (provider) {
    case "jira":
      return wantsJiraContext(message);
    case "slack":
      return wantsSlackContext(message);
    case "teams":
      return wantsTeamsContext(message);
    case "confluence":
      return wantsConfluenceContext(message);
    case "notion":
      return wantsNotionContext(message);
    case "google-docs":
      return wantsGoogleDocsContext(message);
    default:
      return false;
  }
}

export function detectWorkflow(message: string): {
  workflow?: ChatIntentWorkflow;
  confidence: "high" | "medium" | "low";
} {
  for (const entry of WORKFLOW_PATTERNS) {
    if (entry.patterns.some((re) => re.test(message))) {
      return { workflow: entry.workflow, confidence: entry.confidence };
    }
  }
  return { confidence: "low" };
}

/**
 * Phrase-first planner. Does not call the LLM.
 * Incident-shaped asks leave workflow empty (incident path owns multi-tool synthesis)
 * but may still list tools when explicitly named.
 */
export function planChatIntentFromRules(input: ChatIntentPlannerInput): ChatIntentPlan {
  const message = input.message?.trim() ?? "";
  if (input.disabled || message.length < 8) {
    return emptyChatIntentPlan(message);
  }

  const focus = message;
  const tools = detectRequestedTools(message, input.connectedTools);
  const incident = isIncidentShapedQuery(message);
  const { workflow, confidence: workflowConfidence } = detectWorkflow(message);

  // Keep incident reconstruction as the multi-tool owner unless a clear workflow wins.
  if (incident && !workflow) {
    return {
      mode: tools.length > 0 ? "tools-only" : "none",
      tools,
      confidence: tools.length > 0 ? "high" : "low",
      focus,
      execution: "none",
      reason: "incident-shaped — defer to incident synthesis; tools if named"
    };
  }

  if (EXPLAIN_ONLY.test(message) && tools.length === 0 && !workflow) {
    return {
      ...emptyChatIntentPlan(focus),
      reason: "local code explanation — no tools"
    };
  }

  if (workflow && (workflowConfidence === "high" || tools.length > 0)) {
    const confidence =
      workflowConfidence === "high" && (tools.length > 0 || Boolean(input.activeFile))
        ? "high"
        : workflowConfidence === "high"
          ? "high"
          : tools.length > 0
            ? "medium"
            : workflowConfidence;

    // Phase 2: high → silent; medium → confirm; low → none
    const execution =
      confidence === "high" ? "silent" : confidence === "medium" ? "confirm" : "none";

    return {
      mode: execution === "confirm" ? "suggest-chips" : "run-workflow",
      workflow,
      tools,
      confidence,
      focus,
      execution,
      reason: `workflow:${workflow}`
    };
  }

  if (tools.length > 0) {
    return {
      mode: "tools-only",
      tools,
      confidence: "high",
      focus,
      execution: "none",
      reason: "named connected tools"
    };
  }

  if (workflow && workflowConfidence === "medium") {
    return {
      mode: "suggest-chips",
      workflow,
      tools: [],
      confidence: "medium",
      focus,
      execution: "confirm",
      reason: `workflow-medium:${workflow}`
    };
  }

  return emptyChatIntentPlan(focus);
}

/**
 * Filter plan tools to currently connected providers (defense in depth).
 */
export function filterPlanToConnected(
  plan: ChatIntentPlan,
  connectedTools: IntegrationChatProvider[]
): ChatIntentPlan {
  const connected = new Set(connectedTools);
  return {
    ...plan,
    tools: plan.tools.filter((t) => connected.has(t))
  };
}
