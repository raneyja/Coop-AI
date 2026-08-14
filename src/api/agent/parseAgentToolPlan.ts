import type { AgentToolName } from "./agentTypes";

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

function isRepoTool(value: unknown): value is AgentToolName {
  return typeof value === "string" && REPO_TOOLS.has(value as AgentToolName);
}

/**
 * Parse one model-chosen repo tool call. Fail-open: garbage → invalid (caller synthesizes).
 * Integrations (Slack/Jira/…) are never valid here — planner allowlist owns those.
 */
export function parseAgentToolPlan(raw: string): ParsedAgentToolPlan {
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
  if (!isRepoTool(obj.tool)) {
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
}): string {
  const prior =
    input.priorSummaries.length > 0
      ? input.priorSummaries.map((line, i) => `${i + 1}. ${line}`).join("\n")
      : "(none)";
  const last = input.lastToolResult?.slice(0, 4000) ?? "(none)";
  return [
    "You pick the next repo tool for Coop. Reply with JSON only.",
    `Use-repo: ${input.repoId}`,
    `Question: ${input.message}`,
    `Round: ${input.round + 1}`,
    "Allowed tools: search_code, read_file, list_directory, git_blame, propose_patch.",
    'Call: {"tool":"search_code","args":{"query":"..."}}',
    'Or finish: {"done":true}',
    "Do not call Slack, Jira, or any integration. Do not invent file paths.",
    "search_code query must be a short identifier or 2–4 word phrase. Never paste the whole question.",
    "Prefer an exact symbol name the user wrote (requireAuth, parse_token) over a prose phrase.",
    "Never read barrel index.ts, build output, or vendored code — they re-export, they do not define.",
    "If the hits do not answer the question, search again with a different term instead of reading a weak hit.",
    "propose_patch emits File: + SEARCH/REPLACE only — it does not apply. Use it only when the user asked to change code, then {\"done\":true}. Hunt/explain questions must not propose patches.",
    "Prior steps:",
    prior,
    "Last tool result (truncated):",
    last
  ].join("\n");
}
