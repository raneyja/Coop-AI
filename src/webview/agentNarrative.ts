import type { IntentFeedbackState, JobProgressState } from "./types";
import {
  buildThinkingMessageSequence,
  THINKING_ROTATION_STEP_MS,
  type ThinkingRotationOptions
} from "./thinkingMessageRotation";

export { THINKING_ROTATION_STEP_MS };

export type NarrativeStepStatus = "pending" | "active" | "done";

export type NarrativeIconKind = "search" | "read" | "loading" | "generic";

export type NarrativeStep = {
  id: string;
  label: string;
  status: NarrativeStepStatus;
  icon: NarrativeIconKind;
};

/**
 * Progressive timeline: earlier steps stay done; current index is active; rest pending.
 * Unlike single-line rotation, completed steps do not cycle back.
 */
export function buildNarrativeTimeline(messages: string[], step: number): NarrativeStep[] {
  if (!messages.length) {
    return [];
  }
  const activeIndex = Math.min(Math.max(0, step), messages.length - 1);
  return messages.map((label, index) => ({
    id: `${index}:${label}`,
    label,
    status: (index < activeIndex ? "done" : index === activeIndex ? "active" : "pending") as NarrativeStepStatus,
    icon: narrativeIconForLabel(label, index === activeIndex)
  }));
}

/** Copilot/Cursor only show completed tools + the current step — never a full pending todo list. */
export function visibleNarrativeSteps(steps: NarrativeStep[]): NarrativeStep[] {
  return steps.filter((step) => step.status !== "pending");
}

export function narrativeIconForLabel(label: string, isActive = false): NarrativeIconKind {
  const lower = label.toLowerCase();
  if (
    /\b(search|searching|searched|finding|scanning|looking)\b/.test(lower) ||
    lower.includes("estate index")
  ) {
    return "search";
  }
  if (/\b(read|reading|file|metadata|open)\b/.test(lower)) {
    return "read";
  }
  if (
    isActive ||
    /\b(loading|processing|preparing|awaiting|gathering)\b/.test(lower)
  ) {
    return "loading";
  }
  return "generic";
}

export function buildNarrativeStepsFromFeedback(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ThinkingRotationOptions,
  step: number
): NarrativeStep[] {
  const sequence = buildThinkingMessageSequence(intentFeedback, jobProgress, options);
  return visibleNarrativeSteps(buildNarrativeTimeline(sequence, step));
}

/** Prefer timeline when there is more than a single generic status line. */
export function shouldUseNarrativeTimeline(steps: NarrativeStep[]): boolean {
  return steps.length > 0;
}

/** Split a status label so `code` spans render as inline chips (Copilot-style). */
export function splitNarrativeLabelParts(label: string): Array<{ type: "text" | "code"; value: string }> {
  const parts: Array<{ type: "text" | "code"; value: string }> = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(label)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: label.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", value: match[1] ?? "" });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < label.length) {
    parts.push({ type: "text", value: label.slice(lastIndex) });
  }
  return parts.length ? parts : [{ type: "text", value: label }];
}
