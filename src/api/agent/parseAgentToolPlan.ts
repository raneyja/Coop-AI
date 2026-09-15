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
 * Integration tools are valid only when on this turn's connected allowlist.
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
  /** Planner job terms — hints, not a limit on which tools may run. */
  suggestedJobs?: Array<{ capability: string; terms: string[] }>;
}): string {
  const prior =
    input.priorSummaries.length > 0
      ? input.priorSummaries.map((line, i) => `${i + 1}. ${line}`).join("\n")
      : "(none)";
  const last = input.lastToolResult?.slice(0, 8000) ?? "(none)";
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
  const jobHint =
    input.suggestedJobs && input.suggestedJobs.length > 0
      ? `Suggested queries, not a limit: ${input.suggestedJobs
          .map((job) => `${job.capability} [${job.terms.join(", ")}]`)
          .join("; ")}.`
      : undefined;
  const integrationRules =
    integrationTools.length > 0
      ? [
          `Connected integration tools this turn: ${integrationTools.join(", ")}.`,
          "Call a discussion tool (search_slack, search_teams) only if the question needs chat or a decision.",
          "Call a ticket tool (search_jira) only if the question needs issues or a ticket.",
          "Call a docs tool (search_confluence, search_notion, search_google_docs) only if the question needs written docs.",
          "Use a short focused query — not the whole question.",
          "Discussion/ticket/docs query must be the suggested decision or docs terms (peel-auth, coop-backend, ticket key). Never search those tools for the locate symbol (requireAuth).",
          "Do not {\"done\":true} after a discussion, ticket, or docs tool alone when the user also asked where code lives.",
          "If the user asked two things, do not {\"done\":true} after a matching code read either — call the connected discussion, ticket, or docs tool the question still needs, then finish.",
          "Do not call integrations that are not listed."
        ]
      : ["No integration tools are connected this turn. Do not call them."];
  return [
    "You are Coop Agent on this Use-repo. This is one conversation: you pick tools, see results, then a later turn in this same conversation answers the user.",
    "Reply with JSON only this turn — not the user-facing answer.",
    `Use-repo: ${input.repoId}`,
    `Question: ${input.message}`,
    `Round: ${input.round + 1}`,
    `Allowed tools: ${allowedList}.`,
    'Call: {"tool":"search_code","args":{"query":"..."}}',
    integrationTools.length
      ? `Or: {"tool":"${integrationTools[0]}","args":{"query":"PROJ-123"}}`
      : undefined,
    'Or finish: {"done":true} — only after you have read a file whose body mentions the named symbol (or an alias), or the role the user named (middleware, handler).',
    ...integrationRules,
    jobHint,
    "Search for identifiers; do not guess file paths.",
    "search_code query must be a short identifier or 2–4 word phrase. Never paste the whole question.",
    "search_code: prefer an exact symbol name the user wrote (requireAuth, parse_token) over a prose phrase.",
    "If camelCase misses, retry snake_case (requireAuth → require_auth) or a nearby synonym — never stop after one empty search.",
    "Never reply {\"done\":true} after an empty search_code, a skipNote, or a read whose body does not mention the named symbol. Search or read a different path instead.",
    "Never read barrel index.ts, build output, or vendored code — they re-export, they do not define.",
    "If the first hit is a related UI, test, or form that does not define the symbol, do not treat it as the answer — search/read again.",
    "propose_patch emits File: + SEARCH/REPLACE only — it does not apply. Use it only when the user asked to change code, and only on a file you already read that mentions the symbol. Hunt/explain questions must not propose patches.",
    "Prior steps:",
    prior,
    "Last tool result (truncated):",
    last
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/** Same conversation, after tools: write the user-visible answer. */
export function buildAgentAnswerPrompt(input: {
  message: string;
  action?: "locate" | "understand" | "change" | "none";
  openedEvidence?: string;
}): string {
  const change =
    input.action === "change"
      ? "If propose_patch succeeded, briefly explain the change. The Apply card will show the patch — do not invent a different SEARCH/REPLACE. If no patch was accepted, say so and do not dump a guessed File: block."
      : "Do not emit SEARCH/REPLACE or propose a patch. Hunt/explain only.";
  const opened = input.openedEvidence?.trim();
  return [
    "Write the user-facing answer now from the tool results in this conversation.",
    `Question: ${input.message}`,
    "Cite real paths with citation fences (numeric startLine:endLine:path).",
    "Citation line numbers must be the N| prefixes from read_file (the real file lines), not 1-based offsets in the snippet.",
    "If Slack/Jira/docs results include permalink or htmlUrl, include that URL as a markdown link so the user can open the native app.",
    "If you never read a file that mentions a named symbol, say in 1–2 sentences that you couldn’t find that symbol in this repo, then suggest a more specific name or opening the file. Answer only from files you read. Do not use a **Your question** heading. Do not restate the user's ask.",
    "Never tell the user to clone, inspect a local copy, or search on disk. If only a state catalog, default rows, or a client post of state_id were read, say the API write/reject path was not in those bodies.",
    "If a read_file body contains validate() or ValidationError for the field the user asked about, that is the write/reject. Cite that. Never cite OpenAPI/swagger, a read_only serializer class, seed JSON, or a view that only checks permissions and fetches a row.",
    "When Slack/Jira/docs ran: empty Slack/Teams is only “no mention in Slack,” not “no decision.” A Jira issue `description` or a Confluence/docs `excerpt` is the documented decision — quote or paraphrase that body. Do not infer a decision from title and status alone. If issues have no description, say the ticket was found but its body was not attached.",
    "When Slack/Jira ran, put those findings after the code answer (or after the honest miss). Do not stretch an unrelated ticket into the definition.",
    ...(opened
      ? [
          "Opened integration artifacts for this answer (required — quote or paraphrase Body lines; never infer a decision from title/status when Body is present):",
          opened
        ]
      : []),
    "Do not emit tool JSON.",
    change
  ].join("\n");
}

/** Writer-facing skip note when search_code exhausted queries with no readable hits. */
export function agentSearchSkipNote(tried: string[], lastError?: string): string {
  if (lastError) {
    return `search_code failed: ${lastError}. Do not claim the symbol is missing from the repo — say you couldn’t find it in this repo.`;
  }
  return `Tried ${tried.map((q) => JSON.stringify(q)).join(", ")} with no readable hits. Say you couldn’t find that symbol in this repo.`;
}
