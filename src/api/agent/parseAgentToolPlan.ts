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
  const last = input.lastToolResult?.slice(0, 8000) ?? "(none)";
  return [
    "You are Coop Agent on this Use-repo. This is one conversation: you pick tools, see results, then a later turn in this same conversation answers the user.",
    "Reply with JSON only this turn — not the user-facing answer.",
    `Use-repo: ${input.repoId}`,
    `Question: ${input.message}`,
    `Round: ${input.round + 1}`,
    "Allowed tools: search_code, read_file, list_directory, git_blame, propose_patch.",
    'Call: {"tool":"search_code","args":{"query":"..."}}',
    'Or finish: {"done":true} — only after you have read a file whose body mentions the named symbol (or an alias), or the role the user named (middleware, handler).',
    "Do not call Slack, Jira, or any integration. Do not invent file paths.",
    "search_code query must be a short identifier or 2–4 word phrase. Never paste the whole question.",
    "Prefer an exact symbol name the user wrote (requireAuth, parse_token) over a prose phrase.",
    "If camelCase misses, retry snake_case (requireAuth → require_auth) or a nearby synonym — never stop after one empty search.",
    "Never reply {\"done\":true} after an empty search_code, a skipNote, or a read whose body does not mention the named symbol. Search or read a different path instead.",
    "Never read barrel index.ts, build output, or vendored code — they re-export, they do not define.",
    "If the first hit is a related UI, test, or form that does not define the symbol, do not treat it as the answer — search/read again.",
    "propose_patch emits File: + SEARCH/REPLACE only — it does not apply. Use it only when the user asked to change code, and only on a file you already read that mentions the symbol. Hunt/explain questions must not propose patches.",
    "Prior steps:",
    prior,
    "Last tool result (truncated):",
    last
  ].join("\n");
}

/** Same conversation, after tools: write the user-visible answer. */
export function buildAgentAnswerPrompt(input: {
  message: string;
  action?: "locate" | "understand" | "change" | "none";
}): string {
  const change =
    input.action === "change"
      ? "If propose_patch succeeded, briefly explain the change. The Apply card will show the patch — do not invent a different SEARCH/REPLACE. If no patch was accepted, say so and do not dump a guessed File: block."
      : "Do not emit SEARCH/REPLACE or propose a patch. Hunt/explain only.";
  return [
    "Write the user-facing answer now from the tool results in this conversation.",
    `Question: ${input.message}`,
    "Cite real paths with citation fences (numeric startLine:endLine:path).",
    "If you never read a file that mentions a named symbol, say in 1–2 sentences that the index returned no usable match. Do not invent a path. Do not answer from a related UI/test/collab file. Do not use a **Your question** heading. Do not restate the user's ask.",
    "Do not emit tool JSON.",
    change
  ].join("\n");
}
