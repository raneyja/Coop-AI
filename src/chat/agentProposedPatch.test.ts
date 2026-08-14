/**
 * Bridge tests — agent propose_patch → answer → Patch card.
 * Catches the failure mode where the tool succeeds but Apply never appears.
 */
import assert from "node:assert/strict";
import {
  extractAgentProposedPatchText,
  mergeAnswerWithAgentPatch
} from "./agentProposedPatch";
import { buildUserMessageWithContext } from "../prompts/systemPrompts";

const PATCH = [
  "File: `server/auth/middleware.py`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "def require_auth(view):",
  "=======",
  "def require_auth(view, *, optional=False):",
  ">>>>>>> REPLACE",
  "```"
].join("\n");

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

test("extracts patchText from agentTools in the context bundle", () => {
  const text = extractAgentProposedPatchText([
    {
      data: {
        agentTools: {
          propose_patch: { ok: true, patchText: PATCH }
        }
      }
    }
  ]);
  assert.equal(text, PATCH);
});

test("ignores a propose_patch result with no SEARCH markers", () => {
  assert.equal(
    extractAgentProposedPatchText([
      { data: { agentTools: { propose_patch: { ok: true, patchText: "not a patch" } } } }
    ]),
    undefined
  );
});

test("merge appends the agent patch when the answer forgot it", () => {
  const merged = mergeAnswerWithAgentPatch("Here is the null check.", PATCH);
  assert.match(merged, /Here is the null check/);
  assert.match(merged, /<<<<<<< SEARCH/);
});

test("merge does not duplicate when the answer already has SEARCH/REPLACE", () => {
  const answer = `Done.\n\n${PATCH}`;
  assert.equal(mergeAnswerWithAgentPatch(answer, PATCH), answer);
});

test("merge is a no-op without an agent patch", () => {
  assert.equal(mergeAnswerWithAgentPatch("plain answer", undefined), "plain answer");
});

test("synthesis prompt includes the agent patch so the model can echo it", () => {
  const prompt = buildUserMessageWithContext("Add a null check", {
    contextBundle: [
      {
        data: {
          agentTools: {
            propose_patch: { ok: true, patchText: PATCH }
          }
        }
      }
    ]
  });
  assert.match(prompt, /<agent_proposed_patch>/);
  assert.match(prompt, /<<<<<<< SEARCH/);
  assert.match(prompt, /Include it verbatim/);
});

console.log(`\nagentProposedPatch: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
