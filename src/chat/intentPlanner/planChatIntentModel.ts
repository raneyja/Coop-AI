/**
 * Optional cheap-model layer for Chat Intent Planner (intent quarterback).
 * Names jobs, tools, and index-ready search criteria invented for this ask.
 * Does not search, cite, or answer. Fail-open: any error → undefined
 * (caller keeps the rules plan).
 */
import type { IntegrationChatProvider } from "../types";
import {
  INTENT_SUGGEST_MAX_TOKENS,
  INTENT_SUGGEST_TIMEOUT_MS,
  resolveIntentSuggestModel,
  type IntentSuggestCompleteFn
} from "../quickActionIntentModel";
import {
  emptyChatIntentPlan,
  type ChatCommandConstraint,
  type ChatIntentEvidenceClass,
  type ChatIntentJob,
  type ChatIntentJobCapability,
  type ChatIntentPlan,
  type ChatIntentPlannerInput
} from "./types";
import { filterPlanToConnected, detectNamedTools } from "./planChatIntent";
import {
  decisionPhrasePresent,
  detectExplicitlyNamedTools,
  mergeChatIntentTools,
  planChatJobs,
  planChatTasks,
  planChatTodos,
  toolsImpliedByJobs
} from "./planChatJobs";

const TOOLS = new Set<string>([
  "jira",
  "slack",
  "teams",
  "confluence",
  "notion",
  "google-docs"
]);

const CONFIDENCES = new Set(["high", "medium", "low"]);

const EVIDENCE_CLASSES = new Set<ChatIntentEvidenceClass>([
  "write-reject",
  "definition-locate",
  "decision",
  "docs",
  "code-host"
]);

export function buildChatIntentPlanUserMessage(
  question: string,
  options?: {
    activeFile?: string;
    connectedTools?: IntegrationChatProvider[];
    constraint?: ChatCommandConstraint;
  }
): string {
  const trimmed = question.trim();
  const file = options?.activeFile?.trim();
  const connected = (options?.connectedTools ?? []).join("|") || "none";
  const lines = [
    "You are Coop's intent quarterback. Interpret this developer ask for gather planning.",
    "You invent jobs and search criteria for THIS ask. You do not search, cite, or answer.",
    "Reply with ONLY a JSON object (no markdown, no prose):",
    '{"workflow":"none","tools":["jira"|"slack"|"teams"|"confluence"|"notion"|"google-docs"],"confidence":"high"|"medium"|"low","purpose":"short done-looks-like","jobs":[{"capability":"locate"|"decision"|"docs"|"code-host","verb":"search"|"latest","terms":["topic"],"searchCriteria":["index query"],"evidenceClass":"write-reject"|"definition-locate"|"decision"|"docs"|"code-host"}]}',
    "Rules:",
    '- Prefer workflow "none". Workflow is only for an explicit slash/Workflows command constraint.',
    "- Do not set blast-radius, find-owner, trace-decision, understand-repo, or knowledge-gaps from plain English.",
    "- Jobs + named tools stay. Compound asks may name tools (e.g. Jira) without a workflow.",
    "- purpose = one short sentence: what done looks like for this paste.",
    "- jobs[].terms = the topic in a few words. Hyphens become spaces (SQL-injection → SQL injection).",
    "- For locate/code jobs: jobs[].searchCriteria = 2-6 index-ready queries invented from THIS ask (field names, symbols, ValidationError-shaped phrases, distinctive error wording the user used). Not Slack chit-chat topics.",
    '- For API error / reject / bad field pastes: evidenceClass "write-reject". searchCriteria MUST be index phrases that hit a server raise/ValidationError/get("field") — never calm locate topics like "work item state" or English slogans like "reject a bad transition".',
    '- For calm "where is X defined/live" pastes: evidenceClass "definition-locate".',
    "- Compound pastes → multiple jobs with distinct terms/searchCriteria.",
    "- jobs[].verb = search (topic) or latest (newest items, no topic). Recency words are not the query.",
    "- Recency-only (most recent, latest, last post, newest) with no real topic → verb latest and terms [].",
    "- A real topic (SQL-injection, a ticket key, a file) → verb search with that topic, even if the user also said latest.",
    "- Do not put search, recent, latest, post, message, ticket, page, or doc in terms.",
    "- Do not use the repo name, the whole sentence, or a filename as a search term (filename only on locate).",
    "- Leading labels like Pager: and On-call: are not search terms.",
    "- Only include tools the user named or clearly needs from: " + connected,
    "- Never invent tools that are not in the connected list."
  ];
  const constraintLine = constraintPromptLine(options?.constraint);
  if (constraintLine) {
    lines.push(constraintLine);
  }
  if (file) {
    lines.push(`Active file: ${file}`);
  }
  lines.push(`Connected tools: ${connected}`, "", "Question:", trimmed);
  return lines.join("\n");
}

function constraintPromptLine(constraint: ChatCommandConstraint | undefined): string | undefined {
  if (!constraint || constraint.kind === "none") {
    return undefined;
  }
  if (constraint.kind === "integration") {
    return `Command constraint: ${constraint.provider} only. Do not add other tools. Do not plan a locate/repo-hunt job. Recency-only asks use verb latest with empty terms. A real topic uses verb search.`;
  }
  if (constraint.kind === "workflow") {
    return `Command constraint: run workflow ${constraint.workflow}. Still name topic terms when the user added focus text.`;
  }
  if (constraint.kind === "edit") {
    return "Command constraint: edit/patch. Still name topic terms; do not search tools yourself.";
  }
  return "Command constraint: compare two repos. Still name the topic.";
}

export function parseChatIntentPlanResponse(
  raw: string,
  connectedTools: IntegrationChatProvider[],
  focus: string
): ChatIntentPlan {
  const text = raw.trim();
  if (!text) {
    return emptyChatIntentPlan(focus);
  }
  const jsonSlice = extractJsonObject(text);
  if (!jsonSlice) {
    return emptyChatIntentPlan(focus);
  }
  try {
    const parsed = JSON.parse(jsonSlice) as {
      tools?: unknown;
      confidence?: unknown;
      jobs?: unknown;
      purpose?: unknown;
    };
    const confidenceRaw =
      typeof parsed.confidence === "string"
        ? parsed.confidence.trim().toLowerCase()
        : "low";
    if (!CONFIDENCES.has(confidenceRaw)) {
      return emptyChatIntentPlan(focus);
    }
    const confidence = confidenceRaw as ChatIntentPlan["confidence"];
    const tools: IntegrationChatProvider[] = [];
    if (Array.isArray(parsed.tools)) {
      for (const item of parsed.tools) {
        if (typeof item !== "string") {
          continue;
        }
        const key = item.trim().toLowerCase();
        if (TOOLS.has(key)) {
          tools.push(key as IntegrationChatProvider);
        }
      }
    }
    const jobs = parseModelJobs(parsed.jobs);
    const purpose =
      typeof parsed.purpose === "string"
        ? parsed.purpose.replace(/\s+/g, " ").trim().slice(0, 160)
        : undefined;

    if (tools.length === 0 && jobs.length === 0) {
      return emptyChatIntentPlan(focus);
    }

    return filterPlanToConnected(
      {
        mode: "tools-only",
        tools,
        jobs,
        confidence: confidence === "low" ? "medium" : confidence,
        focus,
        execution: "none",
        purpose: purpose || undefined,
        reason: jobs.length > 0 ? "model-jobs" : "model-tools"
      },
      connectedTools,
      focus
    );
  } catch {
    return emptyChatIntentPlan(focus);
  }
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

const JOB_CAPABILITIES = new Set<ChatIntentJobCapability>([
  "locate",
  "decision",
  "docs",
  "code-host"
]);

function parseModelJobs(raw: unknown): ChatIntentJob[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const jobs: ChatIntentJob[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      capability?: unknown;
      verb?: unknown;
      terms?: unknown;
      searchCriteria?: unknown;
      evidenceClass?: unknown;
    };
    if (typeof row.capability !== "string" || !JOB_CAPABILITIES.has(row.capability as ChatIntentJobCapability)) {
      continue;
    }
    const verb = row.verb === "latest" ? "latest" : "search";
    const terms = parseStringList(row.terms, { maxLen: 48, maxWords: 6 });
    const searchCriteria = parseStringList(row.searchCriteria, { maxLen: 64, maxWords: 8, maxItems: 8 });
    const evidenceRaw =
      typeof row.evidenceClass === "string" ? row.evidenceClass.trim().toLowerCase() : "";
    const evidenceClass = EVIDENCE_CLASSES.has(evidenceRaw as ChatIntentEvidenceClass)
      ? (evidenceRaw as ChatIntentEvidenceClass)
      : undefined;
    if (terms.length === 0 && verb !== "latest" && searchCriteria.length === 0) {
      continue;
    }
    const job: ChatIntentJob = {
      capability: row.capability as ChatIntentJobCapability,
      verb: terms.length > 0 || searchCriteria.length > 0 ? "search" : verb,
      terms
    };
    if (searchCriteria.length > 0) {
      job.searchCriteria = searchCriteria;
    }
    if (evidenceClass) {
      job.evidenceClass = evidenceClass;
    }
    jobs.push(job);
  }
  return jobs;
}

function parseStringList(
  raw: unknown,
  options: { maxLen: number; maxWords: number; maxItems?: number }
): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const term of raw) {
    if (typeof term !== "string") {
      continue;
    }
    const trimmed = term.replace(/\s+/g, " ").trim();
    if (
      trimmed.length >= 2 &&
      trimmed.length <= options.maxLen &&
      trimmed.split(/\s+/).length <= options.maxWords
    ) {
      out.push(trimmed);
    }
    if (options.maxItems && out.length >= options.maxItems) {
      break;
    }
  }
  return out;
}

/**
 * Call the cheap quarterback when rules found nothing, when a command constraint
 * still needs topic terms, or when a locate/change ask needs index criteria
 * invented for this wording (not a slogan bank).
 */
export function shouldCallChatIntentModel(
  plan: ChatIntentPlan,
  input?: Pick<ChatIntentPlannerInput, "constraint" | "message">
): boolean {
  const constraint = input?.constraint;
  if (constraint && constraint.kind !== "none" && (input?.message?.trim().length ?? 0) >= 8) {
    return true;
  }
  if (needsCodeCriteriaQuarterback(plan)) {
    return true;
  }
  return (
    plan.mode === "none" &&
    (plan.jobs?.length ?? 0) === 0 &&
    (plan.codeIntent?.action ?? "none") === "none"
  );
}

/** Locate / change asks need invented index criteria even when rules already planned jobs. */
export function needsCodeCriteriaQuarterback(plan: ChatIntentPlan): boolean {
  if ((plan.jobs ?? []).some((job) => job.capability === "locate")) {
    return true;
  }
  const action = plan.codeIntent?.action;
  return action === "locate" || action === "change";
}

/**
 * Run cheap classify. Returns undefined on none/error/timeout (fail-open).
 */
export async function classifyChatIntentPlan(
  input: ChatIntentPlannerInput,
  complete: IntentSuggestCompleteFn,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<ChatIntentPlan | undefined> {
  const message = input.message?.trim() ?? "";
  if (input.disabled || message.length < 8) {
    return undefined;
  }
  const timeoutMs = options?.timeoutMs ?? INTENT_SUGGEST_TIMEOUT_MS;
  const model = resolveIntentSuggestModel();
  const prompt = buildChatIntentPlanUserMessage(message, {
    activeFile: input.activeFile,
    connectedTools: input.connectedTools,
    constraint: input.constraint
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = combineAbortSignals(options?.signal, timeoutController.signal);

  try {
    const raw = await complete({
      message: prompt,
      model: model.model,
      provider: model.provider,
      maxTokens: Math.max(INTENT_SUGGEST_MAX_TOKENS, 192),
      temperature: 0,
      signal
    });
    const plan = parseChatIntentPlanResponse(raw, input.connectedTools, message);
    if (plan.mode === "none" && (plan.jobs?.length ?? 0) === 0) {
      return undefined;
    }
    const rulesJobs = planChatJobs({
      message,
      activeFile: input.activeFile,
      connectedTools: input.connectedTools
    });
    const jobs = preferModelJobTerms(rulesJobs, plan.jobs);
    if (jobs.length === 0) {
      return plan.mode === "none" ? undefined : plan;
    }
    const named = detectNamedTools(message);
    const implied = toolsImpliedByJobs({
      jobs,
      namedTools: named,
      namedProducts: detectExplicitlyNamedTools(message),
      connectedTools: input.connectedTools,
      decisionImplied: decisionPhrasePresent(message)
    });
    const tools = mergeChatIntentTools(plan.tools, implied);
    const tasks = planChatTasks({ jobs, tools });
    return {
      ...plan,
      mode: plan.mode === "none" ? "tools-only" : plan.mode,
      jobs,
      tasks,
      todos: planChatTodos(tasks),
      tools,
      purpose: plan.purpose
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

function preferModelJobTerms(
  rulesJobs: ChatIntentJob[],
  modelJobs: ChatIntentJob[] | undefined
): ChatIntentJob[] {
  const merged = new Map<ChatIntentJobCapability, ChatIntentJob>();
  for (const job of rulesJobs) {
    merged.set(job.capability, job);
  }
  for (const job of modelJobs ?? []) {
    const existing = merged.get(job.capability);
    const hasCriteria = (job.searchCriteria?.length ?? 0) > 0;
    if (!existing) {
      if (job.terms.length > 0 || hasCriteria) {
        merged.set(job.capability, { ...job, verb: "search" });
      } else if (job.verb === "latest") {
        merged.set(job.capability, job);
      }
      continue;
    }
    merged.set(job.capability, {
      ...existing,
      terms: job.terms.length > 0 ? job.terms : existing.terms,
      searchCriteria: hasCriteria ? job.searchCriteria : existing.searchCriteria,
      evidenceClass: job.evidenceClass ?? existing.evidenceClass,
      verb:
        job.terms.length > 0 || hasCriteria
          ? "search"
          : job.verb === "latest"
            ? "latest"
            : existing.verb
    });
  }
  return [...merged.values()];
}

function combineAbortSignals(
  a: AbortSignal | undefined,
  b: AbortSignal
): AbortSignal {
  if (!a) {
    return b;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const combined = new AbortController();
  const forward = () => combined.abort();
  if (a.aborted || b.aborted) {
    combined.abort();
    return combined.signal;
  }
  a.addEventListener("abort", forward, { once: true });
  b.addEventListener("abort", forward, { once: true });
  return combined.signal;
}
