/**
 * Chat Intent Planner — shared plan shape for the chat front door.
 *
 * Every user ask (plain chat, slash, Workflows) is interpreted once, then
 * handed to an existing tool. A slash command is a constraint, not a bypass.
 *
 * Phases:
 * 1) tools[] allowlist → fetch connected integrations without slash
 * 2) workflow is set only by an explicit slash / Workflows / grid constraint
 * 3) trust UX → activity + status copy from the plan (never "plain chat was routed")
 * 4) jobs[] + terms → existing fetchers (Slack/Jira/docs/index)
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
 * One gather job. `capability` selects today's search machine;
 * `verb` is the work to run (search a topic, or list newest items);
 * `terms` are that job's topic (empty is valid for `latest`);
 * `searchCriteria` are index-ready queries invented for this ask (code jobs).
 */
export type ChatIntentJobCapability = "locate" | "decision" | "docs" | "code-host";

/** Shared assignment — not a per-vendor field and not a magic terms[] sentinel. */
export type ChatIntentJobVerb = "search" | "latest";

/**
 * Evidence class hint for rails (rank/finish). Not a workflow — never promotes
 * Blast/Owner/Trace from plain English.
 */
export type ChatIntentEvidenceClass =
  | "write-reject"
  | "definition-locate"
  | "decision"
  | "docs"
  | "code-host";

export type ChatIntentJob = {
  capability: ChatIntentJobCapability;
  verb?: ChatIntentJobVerb;
  terms: string[];
  /**
   * Index-ready search strings invented for this ask (symbols, field names,
   * ValidationError-shaped phrases). Prefer these over slogan banks when present.
   */
  searchCriteria?: string[];
  /** Hint for hunt/finish rails — never sets execution/workflow. */
  evidenceClass?: ChatIntentEvidenceClass;
};

/** One executable step derived from a job (repo hunt, Jira search, …). */
export type ChatIntentTaskKind = "search-repo" | "search-integration" | "search-code-host";

export type ChatIntentTask = {
  id: string;
  job: ChatIntentJobCapability;
  kind: ChatIntentTaskKind;
  title: string;
  query: string;
  verb?: ChatIntentJobVerb;
  tool?: IntegrationChatProvider | "repo" | "code-host";
};

/** Planned checklist item. Status lives in the activity UI as work completes. */
export type ChatIntentTodo = {
  id: string;
  content: string;
};

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
  /**
   * How to execute. `silent` / `confirm` are valid only after an explicit
   * command constraint. Unconstrained English must stay `none`.
   */
  execution: ChatIntentExecution;
  /** Human-readable reason (debug / activity). */
  reason?: string;
  /**
   * Short purpose / done-looks-like from the quarterback (debug + synthesis grounding).
   * Never drives silent workflow promotion.
   */
  purpose?: string;
  /**
   * Whether the turn needs the repository's own code, and what for.
   * Set when no workflow claims the turn — this is what lets the agent loop run
   * on ordinary code questions instead of only on hunt-shaped wording.
   */
  codeIntent?: RepoCodeIntent;
  /**
   * Interpreter job list. Empty/omitted = fail open into today's search.
   * Named tools stay on `tools`; implied jobs still run.
   */
  jobs?: ChatIntentJob[];
  /** Concrete steps created from jobs + tools. */
  tasks?: ChatIntentTask[];
  /** Planned todos shown while those tasks run. */
  todos?: ChatIntentTodo[];
};

/** Slash / Workflows / palette pin. Narrows tools; does not skip interpretation. */
export type ChatCommandConstraint =
  | { kind: "none" }
  | { kind: "integration"; provider: IntegrationChatProvider }
  | { kind: "workflow"; workflow: ChatIntentWorkflow }
  | { kind: "edit" }
  | { kind: "compare" };

export type ChatIntentPlannerInput = {
  message: string;
  activeFile?: string;
  /** Only tools the org/user has connected. */
  connectedTools: IntegrationChatProvider[];
  /** Command constraint from slash / Workflows / palette. */
  constraint?: ChatCommandConstraint;
  /** Active Use-repo `owner/repo` — never a search term when the ask has a topic. */
  useRepo?: string;
  /** When true, skip planner (already planned re-entry). */
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
    jobs: [],
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
