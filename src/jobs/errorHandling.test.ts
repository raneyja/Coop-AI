import assert from "node:assert/strict";
import { classifyError } from "./errorHandling";

void (async () => {
  assert.equal(
    classifyError(new Error('duplicate key value violates unique constraint "repo_symbol_index_pkey"')),
    "permanent"
  );
  assert.equal(classifyError(new Error("429 rate limit exceeded")), "transient");

  console.log("errorHandling: 1/1 tests passed");
})();
