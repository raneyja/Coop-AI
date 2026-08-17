import type { AgentToolName } from "./agentTypes";
import type { IntegrationChatProvider } from "../../chat/types";
import {
  agentToolForIntegrationProvider,
  isAgentIntegrationTool,
  providerForAgentIntegrationTool,
  type AgentIntegrationToolName
} from "./integrationTools";

const REPO_TOOLS = new Set<AgentToolName>([
  "search_code",
  "read_file",
  "list_directory",
  "git_blame",
  "propose_patch"
]);

export type ParsedAgentToolPlan =
  | { kind: "call"; tool: AgentToolName; args: Record<string, unknown> }
  | { kind: "done" }
  | { kind: "invalid" };

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return text;
  }
  return text.slice(start, end + 1);
}

function isAllowedTool(
  value: unknown,
  allowedIntegrations: IntegrationChatProvider[] | undefined
): value is AgentToolName {
  if (typeof value !== "string") {
    return false;
  }
  if (REPO_TOOLS.has(value as AgentToolName)) {
    return true;
  }
  if (!isAgentIntegrationTool(value)) {
    return false;
  }
  const allowed = new Set(allowedIntegrations ?? []);
  if (allowed.size === 0) {
    return false;
  }
  return allowed.has(providerForAgentIntegrationTool(value));
}

/**
 * Parse one model-chosen tool call. Fail-open: garbage → invalid.
 * Integration tools are valid only when on this turn's planner allowlist.
 */
export function parseAgentToolPlan(
  raw: string,
  options?: { allowedIntegrations?: IntegrationChatProvider[] }
): ParsedAgentToolPlan {
  const text = extractJsonObject(stripFence(raw));
  if (!text) {
    return { kind: "invalid" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid" };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.done === true || obj.tool === null) {
    return { kind: "done" };
  }
  if (!isAllowedTool(obj.tool, options?.allowedIntegrations)) {
    return { kind: "invalid" };
  }
  const args =
    obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
      ? { ...(obj.args as Record<string, unknown>) }
      : {};
  return { kind: "call", tool: obj.tool, args };
}

export function buildAgentToolPlanPrompt(input: {
  message: string;
  repoId: string;
  round: number;
  priorSummaries: string[];
  lastToolResult?: string;
  allowedIntegrations?: IntegrationChatProvider[];
}): string {
  const prior =
    input.priorSummaries.length > 0
      ? input.priorSummaries.map((line, i) => `${i + 1}. ${line}`).join("\n")
      : "(none)";
  const last = input.lastToolResult?.slice(0, 4000) ?? "(none)";
  const integrationTools = (input.allowedIntegrations ?? [])
    .map((provider) => agentToolForIntegrationProvider(provider))
    .filter((tool): tool is AgentIntegrationToolName => Boolean(tool));
  const allowedList = [
    "search_code",
    "read_file",
    "list_directory",
    "git_blame",
    "propose_patch",
    ...integrationTools
  ].join(", ");
  const integrationRules =
    integrationTools.length > 0
      ? [
          `Integration tools on this turn only: ${integrationTools.join(", ")}.`,
          "Use them when code evidence reveals a ticket key, thread topic, or doc name — pass a short focused query.",
          "Do not call integrations that are not listed. Prefetch may already have first-pass results."
        ]
      : [
          "Do not call Slack, Jira, or any integration tool this turn — none are on the allowlist."
        ];
  return [
    "You pick the next tool for Coop. Reply with JSON only.",
    `Use-repo: ${input.repoId}`,
    `Question: ${input.message}`,
    `Round: ${input.round + 1}`,
    `Allowed tools: ${allowedList}.`,
    'Call: {"tool":"search_code","args":{"query":"..."}}',
    integrationTools.length
      ? `Or: {"tool":"${integrationTools[0]}","args":{"query":"PROJ-123"}}`
      : undefined,
    'Or finish: {"done":true}',
    ...integrationRules,
    "Do not invent file paths.",
    "search_code query must be a short identifier or 2–4 word phrase. Never paste the whole question.",
    "Prefer an exact symbol name the user wrote (requireAuth, parse_token) over a prose phrase.",
    "Never read barrel index.ts, build output, or vendored code — they re-export, they do not define.",
    "If the hits do not answer the question, search again with a different term instead of reading a weak hit.",
    "propose_patch emits File: + SEARCH/REPLACE only — it does not apply. Use it only when the user asked to change code, then {\"done\":true}. Hunt/explain questions must not propose patches.",
    "Prior steps:",
    prior,
    "Last tool result (truncated):",
    last
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
