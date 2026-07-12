import type { UseCase } from "../api/types";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import { formatModelOptionLabel, getModelDefinition } from "./llmModels";
import {
  FIM_MISTRAL_MODEL,
  type InlineModelPresetId,
  INLINE_MODEL_PRESETS,
  resolveChatModelPreset,
  resolveInlineModelPreset
} from "./inlineModelPresets";

export type CoopFeatureId = "chat" | "quickActions" | "edit" | "autocomplete";

export type FeatureModelAssignment = {
  feature: CoopFeatureId;
  label: string;
  provider: LlmProvider;
  model: string;
  note?: string;
};

/** Operator-controlled model routing — not user-configurable in production. */
export const COOP_FEATURE_MODEL_ASSIGNMENTS: FeatureModelAssignment[] = [
  {
    feature: "chat",
    label: "Chat",
    provider: "openai",
    model: "gpt-4o-mini"
  },
  {
    feature: "quickActions",
    label: "Quick actions",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    note: "Trace, owner, blast radius, and related actions"
  },
  {
    feature: "edit",
    label: "/edit patches",
    provider: "openai",
    model: "gpt-5-mini"
  },
  {
    feature: "autocomplete",
    label: "Autocomplete",
    provider: "mistral",
    model: FIM_MISTRAL_MODEL,
    note: "Codestral FIM when available on the server"
  }
];

const assignmentByFeature = new Map(
  COOP_FEATURE_MODEL_ASSIGNMENTS.map((entry) => [entry.feature, entry] as const)
);

const QUICK_ACTION_USE_CASES = new Set<UseCase>([
  "comprehension",
  "decision_archaeology",
  "ownership",
  "blast_radius",
  "knowledge_gaps",
  "integration"
]);

export type RuntimeModelPrefs = {
  devMode?: boolean;
  llmProvider?: LlmProvider;
  model?: string;
};

export function canUserSelectModels(options: { devMode?: boolean }): boolean {
  return options.devMode === true;
}

/** Strip user model/provider writes when production routing is locked. */
export function stripUserModelPreferenceUpdates<T extends { model?: string; llmProvider?: string }>(
  updates: T,
  options: { devMode?: boolean }
): T {
  if (canUserSelectModels(options)) {
    return updates;
  }
  const next = { ...updates };
  delete next.model;
  delete next.llmProvider;
  return next;
}

export function resolveRuntimeModelForUseCase(
  useCase: UseCase,
  prefs: RuntimeModelPrefs
): { provider: LlmProvider; model: string } {
  if (canUserSelectModels(prefs)) {
    const provider = (prefs.llmProvider ?? "openai") as LlmProvider;
    const model = prefs.model?.trim() || getFeatureModelAssignment("chat").model;
    return { provider, model };
  }
  return resolveAssignedModelForUseCase(useCase);
}

export function resolveRuntimeAutocompleteModel(
  preset: InlineModelPresetId,
  customModel: string,
  prefs: RuntimeModelPrefs
): { provider: LlmProvider; model: string; fallback?: { provider: LlmProvider; model: string } } {
  if (canUserSelectModels(prefs)) {
    const provider = (prefs.llmProvider ?? "anthropic") as LlmProvider;
    if (preset === "chat") {
      return resolveChatModelPreset(provider, prefs.model ?? "");
    }
    return resolveInlineModelPreset(preset, customModel, provider);
  }
  const assignment = getFeatureModelAssignment("autocomplete");
  return {
    provider: assignment.provider,
    model: assignment.model,
    fallback: INLINE_MODEL_PRESETS.haiku.fallback
  };
}

export function assignedModelsHubSubtitle(options: {
  llmEnabled: boolean;
  autocompleteEnabled: boolean;
}): string {
  const chat = options.llmEnabled ? "Chat on" : "Chat off";
  const autocomplete = options.autocompleteEnabled ? "Autocomplete on" : "Autocomplete off";
  return `Assigned models · ${chat} · ${autocomplete}`;
}

export function resolveFeatureFromUseCase(useCase: UseCase): CoopFeatureId {
  if (useCase === "code_edit") {
    return "edit";
  }
  if (useCase === "inline_completion") {
    return "autocomplete";
  }
  if (useCase === "chat") {
    return "chat";
  }
  if (QUICK_ACTION_USE_CASES.has(useCase)) {
    return "quickActions";
  }
  return "chat";
}

export function getFeatureModelAssignment(feature: CoopFeatureId): FeatureModelAssignment {
  const assignment = assignmentByFeature.get(feature);
  if (!assignment) {
    throw new Error(`Missing model assignment for feature ${feature}`);
  }
  return assignment;
}

export function resolveAssignedModelForUseCase(useCase: UseCase): {
  provider: LlmProvider;
  model: string;
} {
  const feature = resolveFeatureFromUseCase(useCase);
  const assignment = getFeatureModelAssignment(feature);
  return { provider: assignment.provider, model: assignment.model };
}

export function formatAssignedModelDisplay(assignment: FeatureModelAssignment): string {
  const definition = getModelDefinition(assignment.provider, assignment.model);
  if (definition) {
    return definition.label;
  }
  return assignment.model;
}

export function formatAssignedModelMeta(assignment: FeatureModelAssignment): string {
  const providerLabel =
    assignment.provider === "openai"
      ? "OpenAI"
      : assignment.provider === "anthropic"
        ? "Anthropic"
        : assignment.provider === "mistral"
          ? "Mistral"
          : assignment.provider === "gemini"
            ? "Gemini"
            : assignment.provider === "deepseek"
              ? "DeepSeek"
              : assignment.provider;
  return `${providerLabel} · ${formatAssignedModelDisplay(assignment)}`;
}
