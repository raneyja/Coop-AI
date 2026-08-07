import assert from "node:assert/strict";
import { mapSearchProvenance } from "./searchProvenance";

void (async () => {
  assert.equal(mapSearchProvenance("hybrid"), "zoekt");
  assert.equal(mapSearchProvenance(undefined, { hasHits: true }), "embedding");
  assert.equal(mapSearchProvenance(undefined, { hasHits: false }), "fallback");
  assert.equal(mapSearchProvenance("zoekt"), "zoekt");
  assert.equal(mapSearchProvenance("embedding"), "embedding");

  console.log("searchProvenance: 1/1 tests passed");
})();
