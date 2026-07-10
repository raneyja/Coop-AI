import assert from "node:assert/strict";
import {
  COOP_FEATURE_MODEL_ASSIGNMENTS,
  canUserSelectModels,
  formatAssignedModelMeta,
  getFeatureModelAssignment,
  resolveAssignedModelForUseCase,
  resolveFeatureFromUseCase
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
assert.equal(editModel.model, "gpt-5-mini");

const quickActionModel = resolveAssignedModelForUseCase("blast_radius");
assert.equal(quickActionModel.provider, "anthropic");
assert.equal(quickActionModel.model, "claude-sonnet-4-6");

assert.equal(COOP_FEATURE_MODEL_ASSIGNMENTS.length, 4);
assert.ok(formatAssignedModelMeta(getFeatureModelAssignment("chat")).includes("OpenAI"));

console.log("featureModelAssignments: 1/1 tests passed");
