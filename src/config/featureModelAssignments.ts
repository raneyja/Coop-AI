import type { UseCase } from "../api/types";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import {
  formatModelOptionLabel,
  getCatalogModelById,
  getModelDefinition,
  isAutoModelSelection,
  isPickerCatalogModel
} from "./llmModels";
import {
  FIM_MISTRAL_MODEL,
  type InlineModelPresetId,
  INLINE_MODEL_PRESETS,
  resolveChatModelPreset,
  resolveInlineModelPreset
} from "./inlineModelPresets";

export type CoopFeatureId =
  | "chat"
  | "quickActions"
  | "edit"
  | "autocomplete"
  | "intentSuggest"
  | "evidencePreview"
  | "prSummary";

export type FeatureModelAssignment = {
  feature: CoopFeatureId;
  label: string;
  provider: LlmProvider;
  model: string;
};

/** Operator-controlled model routing — not user-configurable in production. */
export const COOP_FEATURE_MODEL_ASSIGNMENTS: FeatureModelAssignment[] = [
  {
    feature: "chat",
    label: "Chat",
    provider: "openai",
    model: "gpt-5-mini"
  },
  {
    feature: "quickActions",
    label: "Quick actions",
    provider: "anthropic",
    model: "claude-sonnet-4-6"
  },
  {
    feature: "edit",
    label: "/edit patches",
    provider: "openai",
    model: "gpt-5.1"
  },
  {
    feature: "autocomplete",
    label: "Autocomplete",
    provider: "mistral",
    model: FIM_MISTRAL_MODEL
  },
  {
    feature: "intentSuggest",
    label: "Intent suggest",
    provider: "openai",
    model: "gpt-4o-mini"
  },
  {
    feature: "evidencePreview",
    label: "Sources expand preview",
    provider: "openai",
    model: "gpt-4o-mini"
  },
  {
    feature: "prSummary",
    label: "PR notes",
    provider: "openai",
    model: "gpt-4o-mini"
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
  usageTier?: string | null;
  plan?: "free" | "pro" | "enterprise";
};

export function canUserSelectModels(options: {
  devMode?: boolean;
  usageTier?: string | null;
  plan?: "free" | "pro" | "enterprise";
}): boolean {
  if (options.devMode === true) {
    return true;
  }
  if (options.plan === "enterprise" || options.plan === "pro") {
    return true;
  }
  return Boolean(options.usageTier);
}

/** Strip user model/provider writes when production routing is locked. */
export function stripUserModelPreferenceUpdates<T extends { model?: string; llmProvider?: string }>(
  updates: T,
  options: { devMode?: boolean; usageTier?: string | null; plan?: "free" | "pro" | "enterprise" }
): T {
  if (canUserSelectModels(options)) {
    return updates;
  }
  const next = { ...updates };
  delete next.model;
  delete next.llmProvider;
  return next;
}

/** Chat, quick actions, and /edit honor the global picker. Other features stay assigned. */
export function pickerAppliesToUseCase(useCase: UseCase): boolean {
  const feature = resolveFeatureFromUseCase(useCase);
  return feature === "chat" || feature === "quickActions" || feature === "edit";
}

export function resolveRuntimeModelForUseCase(
  useCase: UseCase,
  prefs: RuntimeModelPrefs
): { provider: LlmProvider; model: string } {
  if (prefs.devMode === true && !isAutoModelSelection(prefs.model) && prefs.model?.trim()) {
    return {
      provider: (prefs.llmProvider ?? "openai") as LlmProvider,
      model: prefs.model.trim()
    };
  }
  if (
    pickerAppliesToUseCase(useCase) &&
    canUserSelectModels(prefs) &&
    !isAutoModelSelection(prefs.model)
  ) {
    const catalog = getCatalogModelById(prefs.model ?? "");
    if (catalog && isPickerCatalogModel(catalog)) {
      return { provider: catalog.provider, model: catalog.id };
    }
  }
  return resolveAssignedModelForUseCase(useCase);
}

export function resolveHonoredChatModel(input: {
  allowUnapprovedProvider: boolean;
  plan: "free" | "pro" | "enterprise";
  useCase: UseCase;
  clientProvider?: LlmProvider;
  clientModel?: string;
}): { provider: LlmProvider; model: string; selection: string } {
  const assigned = resolveAssignedModelForUseCase(input.useCase);
  if (input.allowUnapprovedProvider && input.clientModel && !isAutoModelSelection(input.clientModel)) {
    return {
      provider: input.clientProvider ?? assigned.provider,
      model: input.clientModel,
      selection: input.clientModel
    };
  }
  if (
    !pickerAppliesToUseCase(input.useCase) ||
    isAutoModelSelection(input.clientModel) ||
    input.plan === "free"
  ) {
    return { provider: assigned.provider, model: assigned.model, selection: "auto" };
  }
  const catalog = getCatalogModelById(input.clientModel ?? "");
  if (catalog && isPickerCatalogModel(catalog)) {
    return { provider: catalog.provider, model: catalog.id, selection: catalog.id };
  }
  return { provider: assigned.provider, model: assigned.model, selection: "auto" };
}

export function resolveRuntimeAutocompleteModel(
  preset: InlineModelPresetId,
  customModel: string,
  prefs: RuntimeModelPrefs
): { provider: LlmProvider; model: string; fallback?: { provider: LlmProvider; model: string } } {
  if (prefs.devMode === true) {
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
  autocompleteEnabled: boolean;
}): string {
  const autocomplete = options.autocompleteEnabled ? "Autocomplete on" : "Autocomplete off";
  return `Assigned models · ${autocomplete}`;
}

export function resolveFeatureFromUseCase(useCase: UseCase): CoopFeatureId {
  if (useCase === "code_edit") {
    return "edit";
  }
  if (useCase === "inline_completion") {
    return "autocomplete";
  }
  if (useCase === "intent_suggest") {
    return "intentSuggest";
  }
  if (useCase === "evidence_preview") {
    return "evidencePreview";
  }
  if (useCase === "pr_summary") {
    return "prSummary";
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
