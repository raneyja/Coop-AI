/**
 * Optional cheap-model layer for Chat Intent Planner.
 * Extends the chip classifier schema with tools[] + compound workflow support.
 * Fail-open: any error → undefined (caller keeps rules-only plan).
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
  type ChatIntentPlan,
  type ChatIntentPlannerInput
} from "./types";
import { filterPlanToConnected } from "./planChatIntent";

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
  options?: { activeFile?: string; connectedTools?: IntegrationChatProvider[] }
): string {
  const trimmed = question.trim();
  const file = options?.activeFile?.trim();
  const connected = (options?.connectedTools ?? []).join("|") || "none";
  const lines = [
    "Classify this developer question for Coop chat intent planning.",
    "Reply with ONLY a JSON object (no markdown, no prose):",
    '{"workflow":"none"|"find-owner"|"trace-decision"|"blast-radius"|"understand-repo"|"knowledge-gaps","tools":["jira"|"slack"|"teams"|"confluence"|"notion"|"google-docs"],"confidence":"high"|"medium"|"low"}',
    "Rules:",
    '- Prefer workflow "none" and tools [] for normal code explanations.',
    '- "blast-radius" = change impact / what breaks / callers of a change.',
    '- "find-owner" = who owns or maintains this.',
    '- "trace-decision" = why this was written / decision history.',
    '- "understand-repo" = whole-repo architecture overview.',
    '- "knowledge-gaps" = missing docs / undocumented areas.',
    "- Compound asks MAY set both workflow and tools (e.g. blast-radius + jira).",
    "- Only include tools the user named or clearly needs from: " + connected,
    "- Never invent tools that are not in the connected list."
  ];
  if (file) {
    lines.push(`Active file: ${file}`);
  }
  lines.push(`Connected tools: ${connected}`, "", "Question:", trimmed);
  return lines.join("\n");
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

    if (!workflow && tools.length === 0) {
      return emptyChatIntentPlan(focus);
    }

    if (workflow) {
      const execution =
        confidence === "high" ? "silent" : confidence === "medium" ? "confirm" : "none";
      const plan: ChatIntentPlan = {
        mode: execution === "confirm" ? "suggest-chips" : execution === "silent" ? "run-workflow" : "none",
        workflow,
        tools,
        confidence,
        focus,
        execution,
        reason: "model-plan"
      };
      return filterPlanToConnected(plan, connectedTools);
    }

    return filterPlanToConnected(
      {
        mode: "tools-only",
        tools,
        confidence: confidence === "low" ? "medium" : confidence,
        focus,
        execution: "none",
        reason: "model-tools"
      },
      connectedTools
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
    connectedTools: input.connectedTools
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = combineAbortSignals(options?.signal, timeoutController.signal);

  try {
    const raw = await complete({
      message: prompt,
      model: model.model,
      provider: model.provider,
      maxTokens: Math.max(INTENT_SUGGEST_MAX_TOKENS, 96),
      temperature: 0,
      signal
    });
    const plan = parseChatIntentPlanResponse(raw, input.connectedTools, message);
    if (plan.mode === "none") {
      return undefined;
    }
    return plan;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
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
