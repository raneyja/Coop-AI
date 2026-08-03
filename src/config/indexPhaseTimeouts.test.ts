import assert from "node:assert/strict";
import { readIndexPhaseTimeouts } from "./indexPhaseTimeouts";

void (async () => {
  const defaults = readIndexPhaseTimeouts({});
  assert.equal(defaults.cloneMs, 600_000);
  assert.equal(defaults.scipMs, 900_000);

  const custom = readIndexPhaseTimeouts({
    INDEX_CLONE_TIMEOUT_MS: "120000",
    INDEX_SCIP_TIMEOUT_MS: "bogus"
  } as NodeJS.ProcessEnv);
  assert.equal(custom.cloneMs, 120_000);
  assert.equal(custom.scipMs, 900_000);

  console.log("indexPhaseTimeouts: 1/1 tests passed");
})();
