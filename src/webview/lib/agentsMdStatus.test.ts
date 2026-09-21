import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsMdAttached, canDetachAgentsMd, shouldPromptForAgentsMd } from "./agentsMdStatus";

test("agentsMdAttached is true only when hasAgentsMd is set", () => {
  assert.equal(agentsMdAttached({ status: "loaded", hasAgentsMd: true }), true);
  assert.equal(agentsMdAttached({ status: "loaded", hasAgentsMd: false }), false);
});

test("shouldPromptForAgentsMd stays off for Use-repo and for an L file with no upload", () => {
  assert.equal(
    shouldPromptForAgentsMd({ status: "missing", source: "repo", hasAgentsMd: false, canMutate: false }),
    false
  );
  assert.equal(
    shouldPromptForAgentsMd({ status: "loaded", source: "repo", hasAgentsMd: true, canMutate: false }),
    false
  );
  assert.equal(
    shouldPromptForAgentsMd({
      status: "missing",
      source: "attached",
      hasAgentsMd: false,
      canMutate: false
    }),
    false
  );
  assert.equal(
    shouldPromptForAgentsMd({
      status: "loaded",
      source: "attached",
      hasAgentsMd: true,
      canMutate: true
    }),
    false
  );
  assert.equal(
    shouldPromptForAgentsMd({
      status: "missing",
      source: "attached",
      hasAgentsMd: false,
      canMutate: true
    }),
    true
  );
});

test("canDetachAgentsMd only for a personal attached file", () => {
  assert.equal(
    canDetachAgentsMd({ status: "loaded", source: "attached", hasAgentsMd: true, canMutate: true }),
    true
  );
  assert.equal(
    canDetachAgentsMd({ status: "loaded", source: "attached", hasAgentsMd: false, canMutate: true }),
    false
  );
  assert.equal(
    canDetachAgentsMd({ status: "loaded", source: "repo", hasAgentsMd: true, canMutate: false }),
    false
  );
  assert.equal(
    canDetachAgentsMd({ status: "loaded", source: "attached", hasAgentsMd: true, canMutate: false }),
    false
  );
});
