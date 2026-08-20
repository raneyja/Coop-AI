import assert from "node:assert/strict";
import {
  assignedModelsHubSubtitle,
  COOP_FEATURE_MODEL_ASSIGNMENTS,
  canUserSelectModels,
  formatAssignedModelMeta,
  getFeatureModelAssignment,
  resolveAssignedModelForUseCase,
  resolveFeatureFromUseCase,
  resolveRuntimeAutocompleteModel,
  resolveRuntimeModelForUseCase,
  stripUserModelPreferenceUpdates
} from "./featureModelAssignments";

assert.equal(canUserSelectModels({ devMode: false }), false);
assert.equal(canUserSelectModels({ devMode: true }), true);

assert.equal(resolveFeatureFromUseCase("chat"), "chat");
assert.equal(resolveFeatureFromUseCase("code_edit"), "edit");
assert.equal(resolveFeatureFromUseCase("ownership"), "quickActions");
assert.equal(resolveFeatureFromUseCase("inline_completion"), "autocomplete");

const chatModel = resolveAssignedModelForUseCase("chat");
assert.equal(chatModel.provider, "openai");
assert.equal(chatModel.model, "gpt-5-mini");

const editModel = resolveAssignedModelForUseCase("code_edit");
assert.equal(editModel.provider, "openai");
assert.equal(editModel.model, "gpt-5.1");

const quickActionModel = resolveAssignedModelForUseCase("blast_radius");
assert.equal(quickActionModel.provider, "anthropic");
assert.equal(quickActionModel.model, "claude-sonnet-4-6");

assert.equal(COOP_FEATURE_MODEL_ASSIGNMENTS.length, 7);
assert.ok(formatAssignedModelMeta(getFeatureModelAssignment("chat")).includes("OpenAI"));

assert.equal(resolveFeatureFromUseCase("intent_suggest"), "intentSuggest");
const intentSuggest = resolveAssignedModelForUseCase("intent_suggest");
assert.equal(intentSuggest.provider, "openai");
assert.equal(intentSuggest.model, "gpt-4o-mini");
assert.ok(formatAssignedModelMeta(getFeatureModelAssignment("intentSuggest")).includes("mini"));

assert.equal(resolveFeatureFromUseCase("evidence_preview"), "evidencePreview");
const evidencePreview = resolveAssignedModelForUseCase("evidence_preview");
assert.equal(evidencePreview.provider, "openai");
assert.equal(evidencePreview.model, "gpt-4o-mini");
assert.ok(formatAssignedModelMeta(getFeatureModelAssignment("evidencePreview")).includes("mini"));

assert.equal(resolveFeatureFromUseCase("pr_summary"), "prSummary");
const prSummary = resolveAssignedModelForUseCase("pr_summary");
assert.equal(prSummary.provider, "openai");
assert.equal(prSummary.model, "gpt-4o-mini");
assert.ok(formatAssignedModelMeta(getFeatureModelAssignment("prSummary")).includes("mini"));

const routedChat = resolveRuntimeModelForUseCase("chat", {
  devMode: false,
  llmProvider: "gemini",
  model: "gemini-2.0-flash"
});
assert.equal(routedChat.provider, "openai");
assert.equal(routedChat.model, "gpt-5-mini");

const devChat = resolveRuntimeModelForUseCase("chat", {
  devMode: true,
  llmProvider: "gemini",
  model: "gemini-2.0-flash"
});
assert.equal(devChat.provider, "gemini");
assert.equal(devChat.model, "gemini-2.0-flash");

const routedAutocomplete = resolveRuntimeAutocompleteModel("chat", "", {
  devMode: false,
  llmProvider: "openai",
  model: "gpt-4o"
});
assert.equal(routedAutocomplete.provider, "mistral");
assert.equal(routedAutocomplete.model, "codestral-latest");

const stripped = stripUserModelPreferenceUpdates(
  { llmProvider: "gemini", model: "gemini-2.0-flash", llmEnabled: true },
  { devMode: false }
);
assert.equal(stripped.llmProvider, undefined);
assert.equal(stripped.model, undefined);
assert.equal(stripped.llmEnabled, true);

assert.equal(
  assignedModelsHubSubtitle({ autocompleteEnabled: false }),
  "Assigned models · Autocomplete off"
);
assert.equal(
  assignedModelsHubSubtitle({ autocompleteEnabled: true }),
  "Assigned models · Autocomplete on"
);

console.log("featureModelAssignments: 1/1 tests passed");
