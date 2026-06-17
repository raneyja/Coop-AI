import assert from "node:assert/strict";
import { parseGraphSearchScope } from "./graphSearchScope";

void (async () => {
  assert.equal(parseGraphSearchScope("indexed"), "indexed");
  assert.equal(parseGraphSearchScope("org"), "org");
  assert.equal(parseGraphSearchScope("repo"), undefined);
  assert.equal(parseGraphSearchScope(null), undefined);
  assert.equal(parseGraphSearchScope(""), undefined);

  console.log("graphSearchScope: 1/1 tests passed");
})();
