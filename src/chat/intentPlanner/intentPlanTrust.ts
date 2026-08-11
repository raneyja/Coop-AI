/**
 * Phase 3 — trust UX copy derived from a ChatIntentPlan.
 * Activity checklist + short status line for Sources / answer preamble.
 */
import type { ChatIntentPlan, ChatIntentWorkflow } from "./types";
import type { IntegrationChatProvider } from "../types";

const WORKFLOW_LABEL: Record<ChatIntentWorkflow, string> = {
  "blast-radius": "change impact",
  "trace-decision": "decision history",
  "find-owner": "ownership",
  "understand-repo": "repo overview",
  "knowledge-gaps": "knowledge gaps"
};

const TOOL_LABEL: Record<IntegrationChatProvider, string> = {
  jira: "Jira",
  slack: "Slack",
  teams: "Teams",
  confluence: "Confluence",
  notion: "Notion",
  "google-docs": "Google Docs"
};

export function workflowActivityMessage(workflow: ChatIntentWorkflow): string {
  switch (workflow) {
    case "blast-radius":
      return "Mapping change impact…";
    case "trace-decision":
      return "Tracing decision evidence…";
    case "find-owner":
      return "Finding code owners…";
    case "understand-repo":
      return "Building repository overview…";
    case "knowledge-gaps":
      return "Scanning for knowledge gaps…";
    default:
      return "Gathering workspace context…";
  }
}

export function toolActivityMessage(tool: IntegrationChatProvider): string {
  switch (tool) {
    case "jira":
      return "Reviewing Jira tickets…";
    case "slack":
      return "Pulling in Slack messages…";
    case "teams":
      return "Searching Teams conversations…";
    case "confluence":
      return "Searching Confluence pages…";
    case "notion":
      return "Searching Notion pages…";
    case "google-docs":
      return "Searching Google Docs…";
    default:
      return "Gathering integration context…";
  }
}

/** Checklist lines shown while gathering for a planned plain-chat turn. */
export function buildIntentPlanActivityMessages(plan: ChatIntentPlan): string[] {
  if (plan.mode === "none") {
    return [];
  }
  const messages: string[] = [];
  if (plan.workflow) {
    messages.push(workflowActivityMessage(plan.workflow));
  }
  for (const tool of plan.tools) {
    messages.push(toolActivityMessage(tool));
  }
  return messages;
}

/**
 * Short status line for the turn (Sources chrome / answer preamble).
 * Example: "Checking change impact + Jira"
 */
export function buildIntentPlanStatusLine(plan: ChatIntentPlan): string | undefined {
  if (plan.mode === "none") {
    return undefined;
  }
  const parts: string[] = [];
  if (plan.workflow) {
    parts.push(WORKFLOW_LABEL[plan.workflow]);
  }
  for (const tool of plan.tools) {
    parts.push(TOOL_LABEL[tool]);
  }
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return `Checking ${parts[0]}`;
  }
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(", ");
  return `Checking ${head} + ${last}`;
}

/**
 * Optional markdown preamble prepended to assistant synthesis context (not user-visible bubble alone).
 */
export function buildIntentPlanTrustPreamble(plan: ChatIntentPlan): string | undefined {
  const status = buildIntentPlanStatusLine(plan);
  if (!status) {
    return undefined;
  }
  return [
    `<coop_intent_plan>`,
    status + ".",
    plan.execution === "silent" && plan.workflow
      ? `Plain chat was routed to the ${plan.workflow} workflow automatically.`
      : undefined,
    plan.tools.length > 0
      ? `Connected tools in scope: ${plan.tools.map((t) => TOOL_LABEL[t]).join(", ")}.`
      : undefined,
    `</coop_intent_plan>`
  ]
    .filter(Boolean)
    .join("\n");
}
