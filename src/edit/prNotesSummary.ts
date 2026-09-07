/**
 * Cheap OpenAI mini summary for Create PR notes.
 * Fail-open: empty notes if the model errors or times out.
 */
import { getFeatureModelAssignment } from "../config/featureModelAssignments";
import type { LlmProviderPreference } from "../chat/types";

export const PR_NOTES_TIMEOUT_MS = 4000;
export const PR_NOTES_MAX_TOKENS = 220;
export const PR_NOTES_MAX_CHARS = 1200;

export type PrNotesCompleteParams = {
  message: string;
  model: string;
  provider: LlmProviderPreference;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
};

export type PrNotesCompleteFn = (params: PrNotesCompleteParams) => Promise<string>;

export function resolvePrNotesModel(): { provider: LlmProviderPreference; model: string } {
  const assignment = getFeatureModelAssignment("prSummary");
  return {
    provider: assignment.provider,
    model: assignment.model
  };
}

export function buildPrNotesUserMessage(options: { title: string; diff: string }): string {
  return [
    "Write pull request notes for this applied change.",
    "Rules:",
    "- 2–4 short sentences, or a short paragraph plus up to 4 bullets.",
    "- Name the files. Describe the behavior change.",
    "- Do not invent tickets, reviewers, tests, or motivation missing from the diff.",
    `- Keep under ${PR_NOTES_MAX_CHARS} characters.`,
    "- Reply with ONLY the notes text.",
    `Title: ${options.title.trim() || "Coop patch"}`,
    "",
    "Diff:",
    options.diff.trim().slice(0, 4000) || "(no diff preview)"
  ].join("\n");
}

export function sanitizePrNotes(raw: string): string | undefined {
  const cleaned = raw
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 12) {
    return undefined;
  }
  if (cleaned.length > PR_NOTES_MAX_CHARS) {
    return `${cleaned.slice(0, PR_NOTES_MAX_CHARS - 1).trimEnd()}…`;
  }
  return cleaned;
}

export async function summarizePrNotes(options: {
  title: string;
  diff: string;
  complete: PrNotesCompleteFn;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string | undefined> {
  if (!options.diff.trim() && !options.title.trim()) {
    return undefined;
  }

  const timeoutMs = options.timeoutMs ?? PR_NOTES_TIMEOUT_MS;
  const model = resolvePrNotesModel();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = combineAbortSignals(options.signal, timeoutController.signal);

  try {
    const raw = await options.complete({
      message: buildPrNotesUserMessage({ title: options.title, diff: options.diff }),
      model: model.model,
      provider: model.provider,
      maxTokens: PR_NOTES_MAX_TOKENS,
      temperature: 0.2,
      signal
    });
    return sanitizePrNotes(raw);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineAbortSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
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
