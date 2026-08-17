/**
 * propose_patch was unreachable for most of its life: change requests never
 * matched the hunt regex that gated the agent loop, so the only thing that ever
 * called this tool was its own unit test. These cases cover both halves of the
 * fix — a change request reaches the loop, and the patch it writes is anchored
 * to real file content.
 */
import assert from "node:assert/strict";
import { handleProposePatch } from "./proposePatch";
import type { AgentToolContext } from "../agentToolContext";
import { agentTurnAction } from "../../../chat/agentRouting";
import { planChatIntentFromRules } from "../../../chat/intentPlanner/planChatIntent";

const FILE = "src/auth/middleware.ts";
const CONTENT = [
  "import { verify } from './jwt';",
  "",
  "export function requireAuth(req, res, next) {",
  "  const token = req.headers.authorization;",
  "  return verify(token) ? next() : res.status(401).end();",
  "}"
].join("\n");

function ctx(): AgentToolContext {
  return {
    indexBackend: {} as AgentToolContext["indexBackend"],
    resolveAbsolutePath: () => undefined,
    readRemoteFile: async ({ path }) =>
      path === FILE ? { path, content: CONTENT } : undefined
  };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
function test(name: string, fn: () => Promise<void> | void) {
  tests.push([name, fn]);
}

test("a change request reaches the agent loop and asks for a patch", () => {
  const q = "Add a null check to requireAuth in the auth middleware";
  const action = agentTurnAction({
    query: q,
    hasQuickAction: false,
    intentPlan: planChatIntentFromRules({ message: q, connectedTools: [] })
  });
  assert.equal(action, "change", "change requests must reach the loop so a patch can be proposed");
});

test("a patch anchored to real lines is emitted", async () => {
  const result = JSON.parse(
    await handleProposePatch(ctx(), {
      files: [
        {
          path: FILE,
          search: "  const token = req.headers.authorization;",
          replace: "  const token = req.headers?.authorization ?? '';"
        }
      ]
    })
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.applied, false, "propose_patch must never apply on its own");
  assert.match(result.patchText, /<<<<<<< SEARCH/);
});

test("a SEARCH block that is not in the file is rejected before the user can Apply", async () => {
  const result = JSON.parse(
    await handleProposePatch(ctx(), {
      files: [
        {
          path: FILE,
          search: "  const token = request.get('Authorization');",
          replace: "  const token = '';"
        }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /not found in/i);
});

test("REPLACE that duplicates SEARCH is rejected", async () => {
  const result = JSON.parse(
    await handleProposePatch(ctx(), {
      files: [
        {
          path: FILE,
          search: "export function requireAuth(req, res, next) {",
          replace:
            "export function requireAuth(req, res, next) {\n  // comment\nexport function requireAuth(req, res, next) {"
        }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /duplicates the SEARCH/i);
});

test("line-number prefixes from read_file are stripped before matching", async () => {
  const result = JSON.parse(
    await handleProposePatch(ctx(), {
      files: [
        {
          path: FILE,
          search: "3|export function requireAuth(req, res, next) {",
          replace: "// gate every request\nexport function requireAuth(req, res, next) {"
        }
      ]
    })
  );
  assert.equal(result.ok, true, result.error);
});

test("indentation drift is accepted because Apply matches it fuzzily", async () => {
  const result = JSON.parse(
    await handleProposePatch(ctx(), {
      files: [
        {
          path: FILE,
          search: "const token = req.headers.authorization;",
          replace: "const token = '';"
        }
      ]
    })
  );
  assert.equal(result.ok, true, "validation must never be stricter than Apply");
});

test("an unreadable file does not block the patch", async () => {
  const result = JSON.parse(
    await handleProposePatch(
      { ...ctx(), readRemoteFile: async () => undefined },
      { files: [{ path: FILE, search: "anything", replace: "else" }] }
    )
  );
  assert.equal(result.ok, true, result.error);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${(error as Error).message}`);
    }
  }
  console.log(`\nproposePatch: ${passed}/${tests.length} tests passed`);
  if (passed !== tests.length) {
    process.exit(1);
  }
})();
