/**
 * Cheap OpenAI mini classifier for quick-action suggest chips.
 * Used only when the local phrase classifier is weak/none (hybrid path).
 * Fail-open: any parse/API/timeout error → no chips (plain chat).
 */
import type { QuickActionId } from "../webview/types";
import { getFeatureModelAssignment } from "../config/featureModelAssignments";
import type { SuggestConfidence, SuggestQuickActionsResult } from "./quickActionSuggestIntent";
import { offerFromActionId } from "./quickActionSuggestIntent";
import type { LlmProviderPreference } from "./types";

export const INTENT_SUGGEST_TIMEOUT_MS = 2500;
export const INTENT_SUGGEST_MAX_TOKENS = 64;

const ACTIONS = new Set<string>([
  "none",
  "find-owner",
  "trace-decision",
  "blast-radius",
  "understand-repo",
  "knowledge-gaps"
]);

const CONFIDENCES = new Set<string>(["high", "medium", "low"]);

export type IntentSuggestAction = QuickActionId | "none";

export type IntentSuggestClassification = {
  action: IntentSuggestAction;
  confidence: SuggestConfidence;
};

export type IntentSuggestCompleteParams = {
  message: string;
  model: string;
  provider: LlmProviderPreference;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
};

export type IntentSuggestCompleteFn = (params: IntentSuggestCompleteParams) => Promise<string>;

export function resolveIntentSuggestModel(): { provider: LlmProviderPreference; model: string } {
  const assignment = getFeatureModelAssignment("intentSuggest");
  return {
    provider: assignment.provider,
    model: assignment.model
  };
}

/** User turn for the classify call — includes schema so older APIs without intent_suggest still work. */
export function buildIntentSuggestUserMessage(
  question: string,
  options?: { activeFile?: string }
): string {
  const trimmed = question.trim();
  const file = options?.activeFile?.trim();
  const lines = [
    "Classify this developer question for Coop quick-action chips.",
    "Reply with ONLY a JSON object (no markdown, no prose):",
    '{"action":"none"|"find-owner"|"trace-decision"|"blast-radius"|"understand-repo"|"knowledge-gaps","confidence":"high"|"medium"|"low"}',
    'Prefer "none" when unsure or for normal code explanations.',
    '"none" for factual inventory ("how many files"), "where is X defined", and simple file/function explanations.',
    '"blast-radius" = change impact / what breaks / callers of a change.',
    '"find-owner" = who owns or maintains this.',
    '"trace-decision" = why this was written / decision history.',
    '"understand-repo" = whole-repo architecture overview (not a single file-count fact).',
    '"knowledge-gaps" = missing docs / undocumented areas (not "where is this constant defined").',
    'Compound "what does this do and who calls it" → "none".'
  ];
  if (file) {
    lines.push(`Active file: ${file}`);
  }
  lines.push("", "Question:", trimmed);
  return lines.join("\n");
}

/**
 * Parse model output into a classification. Invalid / empty → none + low (fail-open).
 */
export function parseIntentSuggestResponse(raw: string): IntentSuggestClassification {
  const text = raw.trim();
  if (!text) {
    return { action: "none", confidence: "low" };
  }

  const jsonSlice = extractJsonObject(text);
  if (!jsonSlice) {
    return { action: "none", confidence: "low" };
  }

  try {
    const parsed = JSON.parse(jsonSlice) as { action?: unknown; confidence?: unknown };
    const actionRaw = typeof parsed.action === "string" ? parsed.action.trim() : "";
    const confidenceRaw =
      typeof parsed.confidence === "string" ? parsed.confidence.trim().toLowerCase() : "";

    if (!ACTIONS.has(actionRaw) || !CONFIDENCES.has(confidenceRaw)) {
      return { action: "none", confidence: "low" };
    }

    return {
      action: actionRaw as IntentSuggestAction,
      confidence: confidenceRaw as SuggestConfidence
    };
  } catch {
    return { action: "none", confidence: "low" };
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

/** True when the model wants chips (action + medium/high). */
export function shouldOfferFromModelClassification(
  classification: IntentSuggestClassification
): classification is IntentSuggestClassification & { action: QuickActionId } {
  return (
    classification.action !== "none" &&
    classification.confidence !== "low"
  );
}

/**
 * Run the cheap classify call. Returns undefined on none/low/error/timeout (fail-open).
 */
export async function classifyQuickActionIntent(
  question: string,
  complete: IntentSuggestCompleteFn,
  options?: {
    activeFile?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<SuggestQuickActionsResult | undefined> {
  const timeoutMs = options?.timeoutMs ?? INTENT_SUGGEST_TIMEOUT_MS;
  const model = resolveIntentSuggestModel();
  const message = buildIntentSuggestUserMessage(question, { activeFile: options?.activeFile });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = combineAbortSignals(options?.signal, timeoutController.signal);

  try {
    const raw = await complete({
      message,
      model: model.model,
      provider: model.provider,
      maxTokens: INTENT_SUGGEST_MAX_TOKENS,
      temperature: 0,
      signal
    });
    const classification = parseIntentSuggestResponse(raw);
    if (!shouldOfferFromModelClassification(classification)) {
      return undefined;
    }
    return offerFromActionId(classification.action, classification.confidence);
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
