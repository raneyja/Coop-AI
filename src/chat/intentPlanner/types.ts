/**
 * Chat Intent Planner — shared plan shape for plain-chat tool + workflow routing.
 *
 * Phases:
 * 1) tools[] allowlist → fetch connected integrations without slash
 * 2) workflow + execution → silent/confirm quick-action promotion
 * 3) trust UX → activity + status copy from the plan
 */
import type { IntegrationChatProvider } from "../types";
import type { QuickActionId } from "../../webview/types";
import type { SuggestConfidence } from "../quickActionSuggestIntent";
import type { RepoCodeIntent } from "../repoCodeIntent";

export type ChatIntentWorkflow = QuickActionId;

export type ChatIntentExecution = "silent" | "confirm" | "none";

export type ChatIntentPlanMode =
  | "none"
  | "plain"
  | "tools-only"
  | "run-workflow"
  | "suggest-chips";

/**
 * Deterministic plan produced before gather / synthesis.
 * Always fail-open to `mode: "none"` when unsure.
 * `mode: "plain"` locks local explain — model must not promote a workflow.
 */
export type ChatIntentPlan = {
  mode: ChatIntentPlanMode;
  /** Primary workflow (0 or 1). Maps onto existing quick-action pipelines. */
  workflow?: ChatIntentWorkflow;
  /**
   * Tools named (or clearly needed) for this turn.
   * Named tools stay even when disconnected so the fetch path can surface a not-connected error.
   */
  tools: IntegrationChatProvider[];
  confidence: SuggestConfidence;
  /** Short focus string for search / slashUserArgs. */
  focus: string;
  /** How to execute: silent run, confirm chips, or plain. */
  execution: ChatIntentExecution;
  /** Human-readable reason (debug / activity). */
  reason?: string;
  /**
   * Whether the turn needs the repository's own code, and what for.
   * Set when no workflow claims the turn — this is what lets the agent loop run
   * on ordinary code questions instead of only on hunt-shaped wording.
   */
  codeIntent?: RepoCodeIntent;
};

export type ChatIntentPlannerInput = {
  message: string;
  activeFile?: string;
  /** Only tools the org/user has connected. */
  connectedTools: IntegrationChatProvider[];
  /** When true, skip planner (slash / already-routed). */
  disabled?: boolean;
};

export const CHAT_INTENT_TOOL_PROVIDERS: IntegrationChatProvider[] = [
  "jira",
  "slack",
  "teams",
  "confluence",
  "notion",
  "google-docs"
];

export function emptyChatIntentPlan(focus = ""): ChatIntentPlan {
  return {
    mode: "none",
    tools: [],
    confidence: "low",
    focus,
    execution: "none"
  };
}

export function isChatIntentWorkflow(value: string | undefined): value is ChatIntentWorkflow {
  return (
    value === "blast-radius" ||
    value === "trace-decision" ||
    value === "find-owner" ||
    value === "understand-repo" ||
    value === "knowledge-gaps"
  );
}
