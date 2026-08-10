/**
 * Cheap OpenAI mini summaries for Sources expand panels.
 * Fail-open: any error → deterministic preview only.
 */
import { getFeatureModelAssignment } from "../config/featureModelAssignments";
import type { LlmProviderPreference } from "../chat/types";
import {
  buildDeterministicEvidencePreview,
  EVIDENCE_PREVIEW_MAX_CHARS,
  shouldRequestEvidenceAiPreview
} from "./evidenceBodyPreview";

export const EVIDENCE_PREVIEW_TIMEOUT_MS = 2500;
export const EVIDENCE_PREVIEW_MAX_TOKENS = 120;

export type EvidencePreviewCompleteParams = {
  message: string;
  model: string;
  provider: LlmProviderPreference;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
};

export type EvidencePreviewCompleteFn = (params: EvidencePreviewCompleteParams) => Promise<string>;

export type EvidencePreviewKind = "commit" | "pull_request" | "slack" | "teams" | "jira" | "generic";

export function resolveEvidencePreviewModel(): { provider: LlmProviderPreference; model: string } {
  const assignment = getFeatureModelAssignment("evidencePreview");
  return {
    provider: assignment.provider,
    model: assignment.model
  };
}

export function buildEvidencePreviewUserMessage(options: {
  kind: EvidencePreviewKind;
  text: string;
  title?: string;
}): string {
  const kindLabel =
    options.kind === "commit"
      ? "git commit message"
      : options.kind === "pull_request"
        ? "pull request description"
        : options.kind === "slack"
          ? "Slack thread"
          : options.kind === "teams"
            ? "Teams thread"
            : options.kind === "jira"
              ? "Jira ticket"
              : "source text";
  const lines = [
    `Summarize this ${kindLabel} for a software engineer in a Sources panel.`,
    "Rules:",
    "- 1–3 short sentences or up to 4 short lines.",
    "- Say what changed / what the discussion decided — not a changelog dump.",
    "- No markdown headings, no bullet lists longer than 4 items.",
    "- Do not invent facts that are not in the text.",
    `- Keep under ${EVIDENCE_PREVIEW_MAX_CHARS} characters.`,
    "- Reply with ONLY the summary text (no JSON, no quotes wrapper)."
  ];
  if (options.title?.trim()) {
    lines.push(`Title: ${options.title.trim()}`);
  }
  lines.push("", "Source text:", options.text.trim().slice(0, 6000));
  return lines.join("\n");
}

export function sanitizeEvidenceAiOverview(raw: string): string | undefined {
  const cleaned = raw
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 12) {
    return undefined;
  }
  // Reject obvious dumps that ignored instructions.
  if (cleaned.length > EVIDENCE_PREVIEW_MAX_CHARS * 2) {
    return buildDeterministicEvidencePreview(cleaned);
  }
  if (cleaned.length > EVIDENCE_PREVIEW_MAX_CHARS) {
    return `${cleaned.slice(0, EVIDENCE_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
  }
  return cleaned;
}

/**
 * Summarize one body. Returns AI overview or deterministic fallback.
 */
export async function summarizeEvidenceBody(
  options: {
    kind: EvidencePreviewKind;
    text: string;
    title?: string;
    complete: EvidencePreviewCompleteFn;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<string> {
  const fallback = buildDeterministicEvidencePreview(options.text);
  if (!shouldRequestEvidenceAiPreview(options.text)) {
    return fallback;
  }

  const timeoutMs = options.timeoutMs ?? EVIDENCE_PREVIEW_TIMEOUT_MS;
  const model = resolveEvidencePreviewModel();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = combineAbortSignals(options.signal, timeoutController.signal);

  try {
    const raw = await options.complete({
      message: buildEvidencePreviewUserMessage({
        kind: options.kind,
        text: options.text,
        title: options.title
      }),
      model: model.model,
      provider: model.provider,
      maxTokens: EVIDENCE_PREVIEW_MAX_TOKENS,
      temperature: 0.2,
      signal
    });
    return sanitizeEvidenceAiOverview(raw) ?? fallback;
  } catch {
    return fallback;
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
