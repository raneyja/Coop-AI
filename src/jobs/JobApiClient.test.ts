import assert from "node:assert/strict";
import { JobType } from "./types";
import { jobTypeForQuickAction, shouldUseAsyncJob } from "./JobApiClient";

assert.equal(jobTypeForQuickAction("knowledge-gaps"), JobType.SCAN_KNOWLEDGE_GAPS);
assert.equal(shouldUseAsyncJob("knowledge-gaps"), true);

// Blast Radius must not block the IDE on BUILD_DEPENDENCY_GRAPH (~120s estimate).
assert.equal(jobTypeForQuickAction("blast-radius"), undefined);
assert.equal(shouldUseAsyncJob("blast-radius"), false);

assert.equal(jobTypeForQuickAction("understand-repo"), undefined);
assert.equal(shouldUseAsyncJob("trace-decision"), false);

console.log("JobApiClient: ok");
