/**
 * Optional cheap-model layer for Chat Intent Planner.
 * Names workflow, tools, and job search terms (the topic in a few words).
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
  isChatIntentWorkflow,
  type ChatCommandConstraint,
  type ChatIntentJob,
  type ChatIntentJobCapability,
  type ChatIntentPlan,
  type ChatIntentPlannerInput
} from "./types";
import { filterPlanToConnected, detectNamedTools } from "./planChatIntent";
import {
  decisionPhrasePresent,
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
    "Classify this developer question for Coop chat intent planning.",
    "You name the jobs and the search words. You do not search, cite, or answer.",
    "Reply with ONLY a JSON object (no markdown, no prose):",
    '{"workflow":"none"|"find-owner"|"trace-decision"|"blast-radius"|"understand-repo"|"knowledge-gaps","tools":["jira"|"slack"|"teams"|"confluence"|"notion"|"google-docs"],"confidence":"high"|"medium"|"low","jobs":[{"capability":"locate"|"decision"|"docs"|"code-host","verb":"search"|"latest","terms":["topic"]}]}',
    "Rules:",
    '- Prefer workflow "none" and tools [] for normal code explanations.',
    '- "blast-radius" = change impact / what breaks / callers of a change.',
    '- "find-owner" = who owns or maintains this.',
    '- "trace-decision" = why this was written / decision history.',
    '- "understand-repo" = whole-repo architecture overview.',
    '- "knowledge-gaps" = missing docs / undocumented areas.',
    "- Compound asks MAY set both workflow and tools (e.g. blast-radius + jira).",
    "- jobs[].terms = the topic in a few words. Hyphens become spaces (SQL-injection → SQL injection).",
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
      workflow?: unknown;
      tools?: unknown;
      confidence?: unknown;
      jobs?: unknown;
    };
    const workflowRaw =
      typeof parsed.workflow === "string" ? parsed.workflow.trim() : "none";
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
    const workflow =
      workflowRaw === "none" || !isChatIntentWorkflow(workflowRaw)
        ? undefined
        : workflowRaw;
    const jobs = parseModelJobs(parsed.jobs);

    if (!workflow && tools.length === 0 && jobs.length === 0) {
      return emptyChatIntentPlan(focus);
    }

    if (workflow) {
      const execution =
        confidence === "high" ? "silent" : confidence === "medium" ? "confirm" : "none";
      const plan: ChatIntentPlan = {
        mode: execution === "confirm" ? "suggest-chips" : execution === "silent" ? "run-workflow" : "none",
        workflow,
        tools,
        jobs,
        confidence,
        focus,
        execution,
        reason: "model-plan"
      };
      return filterPlanToConnected(plan, connectedTools, focus);
    }

    return filterPlanToConnected(
      {
        mode: "tools-only",
        tools,
        jobs,
        confidence: confidence === "low" ? "medium" : confidence,
        focus,
        execution: "none",
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
    const row = item as { capability?: unknown; verb?: unknown; terms?: unknown };
    if (typeof row.capability !== "string" || !JOB_CAPABILITIES.has(row.capability as ChatIntentJobCapability)) {
      continue;
    }
    const verb = row.verb === "latest" ? "latest" : "search";
    const terms: string[] = [];
    if (Array.isArray(row.terms)) {
      for (const term of row.terms) {
        if (typeof term !== "string") {
          continue;
        }
        const trimmed = term.replace(/\s+/g, " ").trim();
        if (trimmed.length >= 2 && trimmed.length <= 48 && trimmed.split(/\s+/).length <= 6) {
          terms.push(trimmed);
        }
      }
    }
    if (terms.length === 0 && verb !== "latest") {
      continue;
    }
    jobs.push({
      capability: row.capability as ChatIntentJobCapability,
      verb: terms.length > 0 ? "search" : verb,
      terms
    });
  }
  return jobs;
}

/**
 * Call the cheap model when rules found nothing, or when a command constraint
 * still needs the interpreter to name the topic. Rules stay the fail-open plan.
 */
export function shouldCallChatIntentModel(
  plan: ChatIntentPlan,
  input?: Pick<ChatIntentPlannerInput, "constraint" | "message">
): boolean {
  const constraint = input?.constraint;
  if (constraint && constraint.kind !== "none" && (input?.message?.trim().length ?? 0) >= 8) {
    return true;
  }
  return (
    plan.mode === "none" &&
    (plan.jobs?.length ?? 0) === 0 &&
    (plan.codeIntent?.action ?? "none") === "none"
  );
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
      tools
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
    if (job.terms.length > 0) {
      merged.set(job.capability, { ...job, verb: "search" });
      continue;
    }
    if (job.verb === "latest" && !merged.has(job.capability)) {
      merged.set(job.capability, job);
    }
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
