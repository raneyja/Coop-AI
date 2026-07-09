import assert from "node:assert/strict";
import { quickActionLabelFromEventType } from "./quickActionLabels";

assert.equal(quickActionLabelFromEventType("quick_action.understand_repo"), "Understand Repo");
assert.equal(quickActionLabelFromEventType("quick_action.blast_radius"), "Blast Radius");
assert.equal(quickActionLabelFromEventType("quick_action.unknown_legacy"), "Unknown Legacy");

console.log("quickActionLabels.test.ts: ok");
