import assert from "node:assert/strict";
import test from "node:test";
import { ModelRouter } from "./ModelRouter";
import type { CompletionRequest, UseCase } from "./types";
import { KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER } from "../prompts/knowledgeGapsSynthesis";
import { buildKnowledgeGapsContinuationMessage } from "../chat/knowledgeGapsSourceReview";

test("provider requests select the focused Gaps contract without changing other use cases", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<{system: string | Array<{text: string}>}> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response([
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Verified answer."}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      'data: {"type":"message_stop"}', ""
    ].join("\n\n"), {status: 200, headers: {"content-type": "text/event-stream"}});
  };
  try {
    const router = new ModelRouter({config: {defaultProvider: "anthropic", mockMode: false,
      allowUnapprovedProvider: true, apiKeys: {anthropic: "test-key"}}});
    const focusedMessage = `<attached_context>repo: org/fixture</attached_context>\n${KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER}\nWhich rules need tests?\nL42: frozen-source if (state && !allowed) reject();`;
    for (const [useCase, message, focused] of [
      ["knowledge_gaps", focusedMessage, true],
      ["knowledge_gaps", buildKnowledgeGapsContinuationMessage(focusedMessage, ""), true],
      ["knowledge_gaps", buildKnowledgeGapsContinuationMessage(focusedMessage, "**Source-grounded review**"), true],
      ["knowledge_gaps", "Audit repository documentation and ownership", false],
      ["chat", KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER, false],
      ["blast_radius", "## Opened selected-ref source bodies", false]
    ] as Array<[UseCase, string, boolean]>) {
      const request: CompletionRequest = {requestId: "focused-contract", orgId: "test", plan: "pro", message,
        useCase, history: [], context: {owner: "org", repo: "fixture", branch: "preview"},
        modelConfig: {provider: "anthropic", model: "claude-sonnet-4-6", temperature: 0, maxTokens: 4096},
        allowUnapprovedProvider: true, enableThinking: false};
      const chunks = [];
      for await (const chunk of router.stream(request)) chunks.push(chunk);
      assert(chunks.some(chunk => chunk.type === "delta" && chunk.text === "Verified answer."));
      assert(!chunks.some(chunk => chunk.type === "error"));
      const system = bodies.at(-1)!.system;
      const prompt = typeof system === "string" ? system : system.map(block => block.text).join("\n");
      assert.equal(prompt.includes("Required response structure — focused code rules"), focused);
      if (focused) {
        assert(JSON.stringify(bodies.at(-1)).includes("frozen-source if (state && !allowed) reject();"));
        assert(!prompt.includes("Group each gap as a subsection"));
        assert(!prompt.includes("**Ownership & maintenance**"));
        assert(!prompt.includes("Numbered list of 2-4 concrete actions"));
        assert(prompt.includes("Delegation alone does not prove"));
        assert(prompt.includes("quoted **verbatim**") || prompt.includes("copied **verbatim**"));
      } else if (useCase === "knowledge_gaps") {
        assert(prompt.includes("**Ownership & maintenance**"));
      } else if (useCase === "blast_radius") {
        assert(prompt.includes("Required response policy — opened source"));
      }
    }
    assert.equal(bodies.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
