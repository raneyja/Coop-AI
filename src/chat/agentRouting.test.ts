import assert from "node:assert/strict";
import { shouldUseAgentMode } from "./agentRouting";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("shouldUseAgentMode is false when setting is off", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "how does auth work across the codebase?",
      hasQuickAction: false,
      agentModeSetting: "off"
    }),
    false
  );
});

test("shouldUseAgentMode is true when setting is on for plain chat", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "how does auth work?",
      hasQuickAction: false,
      agentModeSetting: "on"
    }),
    true
  );
});

test("shouldUseAgentMode rejects quick actions even when on", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "blast radius",
      hasQuickAction: true,
      agentModeSetting: "on"
    }),
    false
  );
});

test("shouldUseAgentMode auto triggers on repo-wide search keywords when query is long enough", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "Where is the session token validated across the codebase?",
      hasQuickAction: false,
      agentModeSetting: "auto"
    }),
    true
  );
});

test("shouldUseAgentMode auto ignores short keyword-only queries when bundle has repo context", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "find auth",
      hasQuickAction: false,
      agentModeSetting: "auto",
      contextBundle: [
        {
          requestId: "1",
          type: "chat_context",
          fetchedAt: new Date(),
          data: { localFiles: { files: [{ path: "src/auth.ts", content: "" }] } }
        }
      ]
    }),
    false
  );
});

test("shouldUseAgentMode auto triggers when context bundle lacks repo search and local files", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "summarize recent changes",
      hasQuickAction: false,
      agentModeSetting: "auto",
      contextBundle: [{ requestId: "1", type: "chat_context", fetchedAt: new Date(), data: {} }]
    }),
    true
  );
});

test("shouldUseAgentMode auto stays off when bundle has localFiles", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "summarize recent changes",
      hasQuickAction: false,
      agentModeSetting: "auto",
      contextBundle: [
        {
          requestId: "1",
          type: "chat_context",
          fetchedAt: new Date(),
          data: { localFiles: { files: [{ path: "src/a.ts", content: "" }] } }
        }
      ]
    }),
    false
  );
});

console.log(`\nagentRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
