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
  allowedIntegrations: IntegrationChatProvider[] | undefined,
  allowedRepoTools: boolean
): value is AgentToolName {
  if (typeof value !== "string") {
    return false;
  }
  if (REPO_TOOLS.has(value as AgentToolName)) {
    return allowedRepoTools;
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
  options?: { allowedIntegrations?: IntegrationChatProvider[]; allowedRepoTools?: boolean }
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
  if (!isAllowedTool(obj.tool, options?.allowedIntegrations, options?.allowedRepoTools !== false)) {
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
  suggestedJobs?: Array<{
    capability: string;
    terms: string[];
    searchCriteria?: string[];
    evidenceClass?: string;
  }>;
  /** Quarterback purpose / done-looks-like — never a silent workflow. */
  intentPurpose?: string;
  /** False on named-product / slash turns unless locate is also in the ask. */
  allowedRepoTools?: boolean;
}): string {
  const prior =
    input.priorSummaries.length > 0
      ? input.priorSummaries.map((line, i) => `${i + 1}. ${line}`).join("\n")
      : "(none)";
  const last = input.lastToolResult?.slice(0, 8000) ?? "(none)";
  const integrationTools = (input.allowedIntegrations ?? [])
    .map((provider) => agentToolForIntegrationProvider(provider))
    .filter((tool): tool is AgentIntegrationToolName => Boolean(tool));
  const repoTools =
    input.allowedRepoTools === false
      ? []
      : ["search_code", "read_file", "list_directory", "git_blame", "propose_patch"];
  const allowedList = [...repoTools, ...integrationTools].join(", ");
  const writeRejectJob = (input.suggestedJobs ?? []).some(
    (job) => job.evidenceClass === "write-reject"
  );
  const writeSiteJob = (input.suggestedJobs ?? []).some(
    (job) => job.evidenceClass === "write-site"
  );
  const compoundWriteRejectJob = writeRejectJob && writeSiteJob;
  const jobHint =
    input.suggestedJobs && input.suggestedJobs.length > 0
      ? `Suggested queries, not a limit: ${input.suggestedJobs
          .map((job) => {
            const criteria =
              job.searchCriteria && job.searchCriteria.length > 0
                ? ` criteria=[${job.searchCriteria.join(", ")}]`
                : "";
            const evidence = job.evidenceClass ? ` evidence=${job.evidenceClass}` : "";
            return `${job.capability} [${job.terms.join(", ")}]${criteria}${evidence}`;
          })
          .join("; ")}.`
      : undefined;
  const purposeHint = input.intentPurpose?.trim()
    ? `Done-looks-like: ${input.intentPurpose.trim()}`
    : undefined;
  const rejectRules = writeRejectJob
    ? [
        "This is a write-reject job: find the server write/reject for the asked field.",
        compoundWriteRejectJob
          ? "This compound ask requires BOTH evidence floors: a remotely opened server write/update site and a remotely opened server-side ValidationError / raise / reject for the asked field. A reject alone is incomplete."
          : "Done = a remotely opened read_file body with ValidationError / raise / reject for that field attached — not a named-symbol locate.",
        "When preferredHits list a serializer or server-write path, read_file that path before another search_code.",
        "Prefer API serializers/views. Do not stop on web components, types, or bgtasks.",
        "Seed searchCriteria are optional hints — invent further queries from results.",
        "If the ask names create/update/assign/… and the first attached raise site does not mention those job words, search_code or read_file another sibling while budget remains — do not freeze on the first twin. Cap a shortlist (~2–4), then done.",
        "When the ask quotes an error string, search that Exact quote early (not bare ValidationError or field_id alone)."
      ]
    : [];
  const vendorLoopRules =
    integrationTools.length > 0
      ? [
          `Connected integration tools this turn: ${integrationTools.join(", ")}.`,
          "Search returns the full hit list (id, title, url). Do not assume rank 1 is the right Open.",
          `Open chosen hits with args.ids (ceiling 3). Pick by title, not rank. Hit 4 may Open; ranks 1–3 may be skipped.`,
          "If Search is empty or titles are off-topic, retry Search once with a nearby page title or topic. Then stop. Do not Open the wrong three.",
          "Strip the product word (Notion, Slack, …) from the Search query. Use the page title or topic.",
          "Do not call integrations that are not listed.",
          'Do not {"done":true} after Search while chosen pages still need Open.',
          "Never put tool JSON, HTTP codes, or timeouts in the later user-facing answer."
        ]
      : ["No integration tools are connected this turn. Do not call them."];
  const huntRules =
    input.allowedRepoTools === false
      ? [
          "Repo hunt tools are off this turn. Do not call search_code or read_file.",
          'After Open (or an honest empty Search retry), {"done":true} is allowed — you do not need to read a repo file.'
        ]
      : [
          'Call: {"tool":"search_code","args":{"query":"..."}}',
          "Call a discussion tool (search_slack, search_teams) only if the question needs chat or a decision.",
          "Call a ticket tool (search_jira) only if the question needs issues or a ticket.",
          "Call a docs tool (search_confluence, search_notion, search_google_docs) only if the question needs written docs.",
          "Discussion/ticket/docs query must be the suggested decision or docs terms (peel-auth, coop-backend, ticket key). Never search those tools for the locate symbol (requireAuth).",
          'Do not {"done":true} after a discussion, ticket, or docs tool alone when the user also asked where code lives.',
          'If the user asked two things, do not {"done":true} after a matching code read either — call the connected discussion, ticket, or docs tool the question still needs, then finish.',
          writeRejectJob
            ? compoundWriteRejectJob
              ? 'Or finish: {"done":true} — only after both the server write/update site and the server reject for the asked field are remotely opened and attached.'
              : 'Or finish: {"done":true} — only after a remotely opened write-reject for the asked field is attached.'
            : 'Or finish: {"done":true} — only after you have read a file whose body mentions the named symbol (or an alias), or the role the user named (middleware, handler).',
          "Search for identifiers; do not guess file paths.",
          writeRejectJob
            ? "For ordinary search_code queries use a short identifier or 2–4 word phrase; for an API reject ask, an exact quoted error string is an explicit exception and should be searched intact early. Never paste the whole question around it."
            : "search_code query must be a short identifier or 2–4 word phrase. Never paste the whole question.",
          "search_code: prefer an exact symbol name the user wrote (requireAuth, parse_token) over a prose phrase.",
          "If camelCase misses, retry snake_case (requireAuth → require_auth) or a nearby synonym — never stop after one empty search.",
          writeRejectJob
            ? compoundWriteRejectJob
              ? 'Never reply {"done":true} after an empty search_code, a skipNote, or a read until BOTH required evidence floors are attached; a read that satisfies one floor is progress, so gather only the missing floor. Read preferredHits before searching again.'
              : 'Never reply {"done":true} after an empty search_code, a skipNote, or a read that is not a write-reject for the asked field. Read preferredHits before searching again.'
            : 'Never reply {"done":true} after an empty search_code, a skipNote, or a read whose body does not mention the named symbol. Search or read a different path instead.',
          "Never read barrel index.ts, build output, or vendored code — they re-export, they do not define.",
          "If the first hit is a related UI, test, or form that does not define the symbol, do not treat it as the answer — search/read again.",
          "propose_patch emits File: + SEARCH/REPLACE only — it does not apply. Use it only when the user asked to change code, and only on a file you already read that mentions the symbol. Hunt/explain questions must not propose patches."
        ];
  const firstVendor = integrationTools[0];
  return [
    "You are Coop Agent on this Use-repo. This is one conversation: you pick tools, see results, then a later turn in this same conversation answers the user.",
    "Reply with JSON only this turn — not the user-facing answer.",
    `Use-repo: ${input.repoId}`,
    `Question: ${input.message}`,
    `Round: ${input.round + 1}`,
    `Allowed tools: ${allowedList}.`,
    firstVendor
      ? `Search: {"tool":"${firstVendor}","args":{"query":"Architecture Overview"}}`
      : undefined,
    firstVendor
      ? `Open: {"tool":"${firstVendor}","args":{"ids":["hit-id"]}} — max 3 ids from the Search list.`
      : undefined,
    ...vendorLoopRules,
    ...huntRules,
    ...rejectRules,
    purposeHint,
    jobHint,
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
  interpretNotes?: string;
}): string {
  const change =
    input.action === "change"
      ? "If propose_patch succeeded, briefly explain the change. The Apply card will show the patch — do not invent a different SEARCH/REPLACE. If no patch was accepted, say so and do not dump a guessed File: block."
      : "Do not emit SEARCH/REPLACE or propose a patch. Hunt/explain only.";
  const opened = input.openedEvidence?.trim();
  const notes = input.interpretNotes?.trim();
  return [
    "Write one talk track now — one user-facing answer, not three essays.",
    `Question: ${input.message}`,
    "Cite real paths with citation fences (numeric startLine:endLine:path).",
    "PASS: a plain fence whose first body line is `57:66:src/server/integrationApi.ts` then the verbatim lines.",
    "FAIL: ```typescript / ```javascript dumps of repo code, or `src/server/authMiddleware.ts:70-80` above a Copy fence.",
    "Never leave a **Heading** with an empty body. If budget is tight, fewer sections, all filled.",
    "Never write a heading whose only content is that path hits were found but bodies were not attached. Omit that section, or say you could not open those files.",
    "A ripple is a file whose attached body shows the same write (for example writeJson 401 with error unauthorized). Path-only search hits are not ripples — do not list them.",
    "Citation line numbers must be the N| prefixes from read_file (the real file lines), not 1-based offsets in the snippet.",
    "If Slack/Jira/docs results include permalink or htmlUrl, include that URL as a markdown link so the user can open the native app.",
    "If you never read a file that mentions a named symbol, say in 1–2 sentences that you couldn’t find that symbol in this repo, then suggest a more specific name or opening the file. Answer only from files you read. Do not use a **Your question** heading. Do not restate the user's ask.",
    "Never tell the user to clone, inspect a local copy, or search on disk. If only a state catalog, default rows, or a client post of state_id were read, say the API write/reject path was not in those bodies.",
    "Identify a rejection only when the attached body shows the requested field's failing guard and raise/error. A validate() method or another field's ValidationError alone does not establish that rejection. If the complete method filters the submitted IDs and returns the filtered data, explain that observed behavior and correct the assumed rejection. If the reported error is not shown, say its source is unverified; do not assert that another layer throws it. Never cite OpenAPI/swagger, a read_only serializer class, seed JSON, or a view that only checks permissions and fetches a row as the requested write/reject.",
    ...(input.action === "locate" ? ["Lead with the verified location and behavior in one short paragraph. Include only the relevant verbatim code lines in a citation fence; avoid restating the same explanation after the code."] : []),
    "Empty vendor Search after retry: “No mention in {vendor} of {topic}.” If a page/ticket was named but the body could not be opened, say that — quote Body when present.",
    "When Slack/Jira/docs findings sit next to a code hunt, put them after the code answer (or after the honest miss). Name disagreements once.",
    "Never mention gather budget, timed out searching, tool names like search_notion, HTTP 401, stack traces, evidence bundles, or indexed search. Teammate English only.",
    ...(notes
      ? ["Per-page interpret notes (fold into one talk track; do not paste as separate essays):", notes]
      : []),
    ...(opened
      ? ["Opened artifacts (quote or paraphrase Body; cite title + url):", opened]
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
