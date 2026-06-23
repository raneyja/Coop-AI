import assert from "node:assert/strict";
import { resolveFeatureForRequest } from "./resolveFeatureForRequest";

assert.equal(resolveFeatureForRequest("knowledge-gaps", "ownership"), "ownership_map");
assert.equal(resolveFeatureForRequest("knowledge-gaps", "dependencies"), "blast_radius");
assert.equal(resolveFeatureForRequest("knowledge-gaps", "knowledge_gaps"), "knowledge_gaps");
assert.equal(resolveFeatureForRequest("blast-radius", "dependencies"), "blast_radius");

console.log("degradation/features/index: ok");
