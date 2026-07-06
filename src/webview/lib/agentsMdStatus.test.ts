import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentsMdAttached,
  shouldPromptForAgentsMd
} from "./agentsMdStatus";

test("agentsMdAttached is true only when hasAgentsMd is set", () => {
  assert.equal(agentsMdAttached({ status: "loaded", hasAgentsMd: true }), true);
  assert.equal(agentsMdAttached({ status: "loaded", hasAgentsMd: false }), false);
});

test("shouldPromptForAgentsMd when AGENTS.md is missing", () => {
  assert.equal(
    shouldPromptForAgentsMd({ status: "loaded", gitRoot: "/repo", hasAgentsMd: false }),
    true
  );
  assert.equal(
    shouldPromptForAgentsMd({ status: "loaded", gitRoot: "/repo", hasAgentsMd: true }),
    false
  );
  assert.equal(shouldPromptForAgentsMd({ status: "no_git", hasAgentsMd: false }), true);
  assert.equal(shouldPromptForAgentsMd({ status: "disabled" }), false);
});
