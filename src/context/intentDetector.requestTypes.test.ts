import assert from "node:assert/strict";
import { requestTypesForIntent, UserIntent, type IntentEvent } from "./intentDetector";

function event(action: string, file?: string): IntentEvent {
  return {
    id: "test",
    intent: UserIntent.QUICK_ACTION_CLICKED,
    timestamp: new Date(),
    costEstimate: "expensive",
    context: {
      buttonClicked: action,
      ...(file ? { file } : {})
    }
  };
}

assert.deepEqual(requestTypesForIntent(event("blast-radius", "src/a.ts")), ["dependencies"]);
assert.deepEqual(requestTypesForIntent(event("find-owner", "src/a.ts")), ["ownership"]);
assert.deepEqual(requestTypesForIntent(event("trace-decision", "src/a.ts")), ["decision_history"]);
assert.deepEqual(requestTypesForIntent(event("knowledge-gaps", "src/a.ts")), ["knowledge_gaps"]);
assert.deepEqual(requestTypesForIntent(event("understand-repo")), ["file_metadata"]);
assert.deepEqual(requestTypesForIntent(event("understand-repo", "src/a.ts")), ["file_metadata"]);

console.log("intentDetector.requestTypes: ok");
