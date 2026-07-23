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
assert.equal(chatModel.model, "gpt-4o-mini");

const editModel = resolveAssignedModelForUseCase("code_edit");
assert.equal(editModel.provider, "openai");
assert.equal(editModel.model, "gpt-5.1");

const quickActionModel = resolveAssignedModelForUseCase("blast_radius");
assert.equal(quickActionModel.provider, "anthropic");
assert.equal(quickActionModel.model, "claude-sonnet-4-6");

assert.equal(COOP_FEATURE_MODEL_ASSIGNMENTS.length, 4);
assert.ok(formatAssignedModelMeta(getFeatureModelAssignment("chat")).includes("OpenAI"));

const routedChat = resolveRuntimeModelForUseCase("chat", {
  devMode: false,
  llmProvider: "gemini",
  model: "gemini-2.0-flash"
});
assert.equal(routedChat.provider, "openai");
assert.equal(routedChat.model, "gpt-4o-mini");

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

console.log("featureModelAssignments: 1/1 tests passed");
