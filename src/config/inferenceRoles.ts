import type { UseCase } from "../api/types";

/** Attribution at the existing API boundary. Assignment policy stays in featureModelAssignments. */
export const INFERENCE_ROLES = {
  intent: "intent_suggest",
  tool_plan: "code_edit",
  opened_source_interpretation: "intent_suggest",
  answer: undefined,
  continuation: undefined,
  source_validation: undefined,
  source_repair: undefined,
  evidence_preview: "evidence_preview",
  pr_summary: "pr_summary",
  autocomplete: "inline_completion"
} as const satisfies Record<string, UseCase | undefined>;

export type InferenceRole = keyof typeof INFERENCE_ROLES;
export type InferenceCall = { role: InferenceRole; provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number };

export function isInferenceRole(value: unknown): value is InferenceRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INFERENCE_ROLES, value);
}

export function inferencePolicyUseCase(role: InferenceRole | undefined, useCase: UseCase): UseCase {
  return role ? INFERENCE_ROLES[role] ?? useCase : useCase;
}

export function defaultInferenceRole(useCase: UseCase): InferenceRole {
  if (useCase === "intent_suggest") return "intent";
  if (useCase === "evidence_preview") return "evidence_preview";
  if (useCase === "pr_summary") return "pr_summary";
  if (useCase === "inline_completion") return "autocomplete";
  return "answer";
}
