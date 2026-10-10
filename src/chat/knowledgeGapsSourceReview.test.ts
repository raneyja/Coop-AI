import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeGapsEvidence } from "../context/contextBundleEvidence";
import { KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER } from "../prompts/knowledgeGapsSynthesis";
import { enrichKnowledgeGapsResponse, enrichIntegrationDocsResponse, KNOWLEDGE_GAPS_SOURCE_SCOPE_LIMIT, scopeKnowledgeGapsSourceAudit } from "../prompts/knowledgeGapsEnrichment";
import { mapMarkdownProse, splitMarkdownBlocks } from "../prompts/markdownProse";
import { stripDisallowedNarrativeSourceCitations, stripTemplateSectionHeadings } from "../prompts/evidenceSynthesis";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import { buildKnowledgeGapsContinuationMessage, streamSourceReviewedKnowledgeGaps } from "./knowledgeGapsSourceReview";
import { LENGTH_CONTINUE_PROMPT } from "./lengthContinue";
import { rewriteCustomerFacingProse } from "./customerFacingAnswer";
import { enrichSourcesFooter, hasSourcesFooterSection } from "../prompts/sourcesFooterEnrichment";
import { verifySourceCitationQuotes } from "../prompts/sourceCitationIntegrity";

const source = "if (enabled && allowed) {\n  reject('invalid');\n}";
const request: StreamChatParams = {
  message: `${KNOWLEDGE_GAPS_CODE_RULE_AUDIT_MARKER}\nWhat behavior is established and what remains unknown?\nL10: if (enabled && allowed) {\nL11:   reject('invalid');\nL12: }`,
  context: { owner: "org", repo: "sample", branch: "release" },
  history: [{ role: "assistant", content: "An earlier task discussion", timestamp: 0 }],
  model: "claude-sonnet-4-6", provider: "anthropic", useCase: "knowledge_gaps",
  temperature: 0.5, maxTokens: 16000, enableThinking: true, quotaTurnId: "original-turn"
};
const evidence: KnowledgeGapsEvidence = { focusFiles: [{
  path: "handler.ts", content: source, repoId: "github:org/sample", startLine: 10, truncated: false
}] };
const usage = { inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.1, provider: "anthropic", model: "claude-sonnet-4-6" };
const citation = "```10:12:handler.ts\n" + source + "\n```";
const audit = (quote = citation) => `**Source-grounded review**\n\nWhen this check is reached, both conditions are required for the shown rejection.\n\n${quote}\n\n**Open questions**\n\nWhich inputs should reach this check? Verify that contract with documentation or tests.`;
const publish = (content = audit()) => scopeKnowledgeGapsSourceAudit(content);

test("source synthesis has one necessary model call and preserves original task, history, ref, model, reasoning, quota and budget", async () => {
  const calls: StreamChatParams[] = [], visible: string[] = [], roles: string[] = [];
  let synthesis: StreamChatParams | undefined;
  let validated: { windows: unknown; quotes: number } | undefined;
  const controller = new AbortController(), thinking: string[] = [];
  const stream: SecureApiClient["streamChat"] = async (body, onChunk, baseUrl, signal, onThinking) => {
    calls.push(body);
    assert.equal(baseUrl, "https://api.example.test"); assert.equal(signal, controller.signal);
    onChunk("private partial"); assert.deepEqual(visible, []); onThinking?.("Checking the source.");
    return { message: { role: "assistant", content: audit(), timestamp: 1 }, usage, finishReason: "stop" };
  };
  const result = await streamSourceReviewedKnowledgeGaps({ stream, request, evidence,
    onChunk: c => { assert.ok(validated, "capture the validated source before publishing"); visible.push(c); },
    onValidated: (windows, quotes) => { validated = { windows, quotes }; },
    onThinking: c => thinking.push(c), signal: controller.signal,
    onReview: body => synthesis = body, onCallComplete: role => roles.push(role), baseUrl: "https://api.example.test" });
  assert.equal(calls.length, 1); assert.equal(synthesis, calls[0]);
  assert.deepEqual(roles, ["source-synthesis"]); assert.deepEqual(visible, [publish()]);
  assert.deepEqual(thinking, ["Checking the source."]); assert.equal(result.message.content, visible[0]); assert.deepEqual(result.usage, usage);
  assert.ok(calls[0].message.includes(request.message)); assert.ok(calls[0].message.includes(JSON.stringify(request.history)));
  assert.deepEqual(calls[0].history, []);
  for (const field of ["context", "model", "provider", "enableThinking", "quotaTurnId", "maxTokens", "temperature"] as const) assert.deepEqual(calls[0][field], request[field]);
  assert.equal(request.history?.length, 1);
  assert.equal(validated!.quotes, 1);
  assert.deepEqual(validated!.windows, evidence.focusFiles);
  assert.notEqual(validated!.windows, evidence.focusFiles);
  assert.notEqual((validated!.windows as unknown[])[0], evidence.focusFiles![0]);
  assert.ok(calls[0].message.includes("cannot establish exhaustive coverage or absence"));
  assert.ok(calls[0].message.includes("Leave behavior beyond the reviewed bodies unknown"));
});

test("a generated opening cannot inflate evidence scope or turn missing evidence into established absence", async () => {
  for (const opening of ["Every file was reviewed and no tests exist.", "All callers are affected.", "No intended policy exists."]) {
    let visible = "", calls = 0;
    const stream: SecureApiClient["streamChat"] = async () => {
      calls++; return { message: { role: "assistant", content: opening + "\n\n" + audit(), timestamp: 1 }, finishReason: "stop" };
    };
    await streamSourceReviewedKnowledgeGaps({ stream, request, evidence, onChunk: c => visible += c, baseUrl: "https://api.example.test" });
    assert.equal(calls, 1); assert.ok(!visible.includes(opening)); assert.ok(visible.startsWith(KNOWLEDGE_GAPS_SOURCE_SCOPE_LIMIT));
    assert.ok(visible.includes(citation)); assert.equal(scopeKnowledgeGapsSourceAudit(visible), visible);
  }
});

test("code bytes survive source review, shared action enrichment and answer serialization across languages and line endings", async () => {
  for (const [path, body] of [
    ["arbitrary.py", "def first():\n    return True\n\n\ndef second():\n    return False"],
    ["unrelated.ts", "export const first = true;\n\n\nexport const second = false;"],
    ["notes.md", "**Summary**\n\n\n**Documentation gaps**\nOpen question: keep these exact bytes\n[Sources: Unknown]\n\"Attached page\"\n**Sources**\n- [Sources: Unknown] — evidence bundle"],
    ["sample.rs", "fn first() {\r\n    work();\r\n}\r\n\r\n\r\nfn second() {}"]
  ]) {
    const quote = `\`\`\`10:${9 + body.split("\n").length}:${path}\n${body}\n\`\`\``;
    const facts: KnowledgeGapsEvidence = { userFocus: "Which source rules and unknowns apply?", focusFiles: [{ path, content: body, startLine: 10, repoId: "github:org/sample" }] };
    const stream: SecureApiClient["streamChat"] = async () => ({ message: { role: "assistant", content: audit(quote), timestamp: 1 }, finishReason: "stop" });
    let visible = "";
    await streamSourceReviewedKnowledgeGaps({ stream, request, evidence: facts, onChunk: c => visible += c, baseUrl: "https://api.example.test" });
    const options = { quickAction: "knowledge-gaps" as const, owner: "org", repo: "sample", activeRepoId: "github:org/sample",
      contextBundle: [{ type: "knowledge_gaps", data: facts }] };
    const final = enrichChatResponseForAction({ ...options, content: visible });
    assert.ok(final.includes(quote), path); assert.ok(!final.includes("could not be matched"), path);
    assert.equal(enrichChatResponseForAction({ ...options, content: final }), final);
    assert.ok(JSON.parse(JSON.stringify({ content: final })).content.includes(quote));
  }
});

test("shared narrative formatters preserve opaque code, longer fences, tildes, CRLF and incomplete blocks", () => {
  for (const code of [
    "```text\n**Summary**\n\n\n[Sources: Unknown]\nOpen question: unchanged\n```",
    "````text\r\n```\r\n\r\n\r\n\"Attached page\"\r\n````",
    "~~~text\n**Sources**\n[Sources: Unknown]\n\n\nevidence bundle\n~~~",
    "```text\n**Summary**\n\n\nunfinished evidence bundle   \n\n"
  ]) {
    const input = "**Summary**\n\n\nProse [Sources: Unknown].\n\n" + code;
    let final = enrichIntegrationDocsResponse(input, { confluencePages: [{ title: "Attached page", htmlUrl: "https://example.test/page" }] });
    final = stripDisallowedNarrativeSourceCitations(final, { allowedCitationKeys: ["Sources: Allowed"] });
    final = stripTemplateSectionHeadings(final);
    final = rewriteCustomerFacingProse(final);
    final = enrichSourcesFooter(final);
    assert.ok(final.includes(code)); assert.equal(splitMarkdownBlocks(input).map(block => block.text).join(""), input);
    assert.ok(mapMarkdownProse(input, () => "").includes(code));
    assert.equal(hasSourcesFooterSection(code), false);
  }
});

test("generic Gaps section rebuilding never interprets headings or fields inside code", () => {
  const body = "**Summary**\n\n\n**Documentation gaps**\nOpen question: source text\n**Recommended next steps**\n- source text";
  const quote = `\`\`\`1:7:notes.md\n${body}\n\`\`\``;
  const final = enrichKnowledgeGapsResponse("**Summary**\n\nAttached documentation is available.\n\n**Source-grounded review**\n\n" + quote, {
    confluencePages: [{ title: "Unrelated doc", excerpt: "Some documentation", htmlUrl: "https://example.test/doc" }],
    focusFiles: [{ path: "notes.md", content: body, startLine: 1 }],
    jobScanGaps: [{ type: "missing_docs", message: "No scan match" }, { type: "missing_owner", message: "No owner match" }]
  });
  assert.ok(final.includes(quote)); assert.ok(final.includes("not proof of absence"));
});

test("shared source integrity rejects altered whitespace, malformed/unopened locators and ambiguous spans without promoting anonymous code", () => {
  const windows = [{ path: "opaque.source", content: "    keep();\n\n    keep();", startLine: 20 }];
  for (const info of ["90:90:opaque.source", "20:20:unopened.source", "start:end:opaque.source"]) {
    const result = verifySourceCitationQuotes(`\`\`\`${info}\n    keep();\n\`\`\``, windows);
    assert.equal(result.invalidQuotes, 1); assert.equal(result.verifiedQuotes, 0);
  }
  const altered = verifySourceCitationQuotes("```20:20:opaque.source\nkeep();\n```", windows);
  assert.equal(altered.invalidQuotes, 1);
  const exact = verifySourceCitationQuotes("```22:22:opaque.source\n    keep();\n```", windows);
  assert.equal(exact.verifiedQuotes, 1); assert.ok(exact.content.startsWith("```22:22:opaque.source"));
  const anonymous = "```ts\n    keep();\n```";
  assert.deepEqual(verifySourceCitationQuotes(anonymous, windows), { content: anonymous, verifiedQuotes: 0, invalidQuotes: 0 });
  assert.equal(verifySourceCitationQuotes("```22:99:opaque.source\n    keep();\n```", windows).invalidQuotes, 1);
  const badBodyLocator = verifySourceCitationQuotes("```ts\n9:2:opaque.source\n    keep();\n```\nAfter", windows);
  assert.equal(badBodyLocator.invalidQuotes, 1); assert.ok(badBodyLocator.content.endsWith("source.\nAfter"));
  const body = "```\nbody\n```";
  const longQuote = "````90:92:notes.md\n" + body + "\n````";
  const long = verifySourceCitationQuotes(longQuote, [{path: "notes.md",content: body,startLine: 1}]);
  assert.equal(long.verifiedQuotes, 1); assert.equal(long.content, "````1:3:notes.md\n" + body + "\n````");
});

test("incomplete answers and unsupported quotes get at most one private replacement with original source and accounting", async () => {
  const failures = ["", "**Open questions**", "```10:12:handler.ts\npartial", audit(citation.replace("&&", "||")),
    audit(citation.replace("enabled", "invented")), audit(citation.replace("handler.ts", "unread.ts")),
    audit("```10:12:handler.ts\nif (enabled && allowed) {\n...\n}\n```"),
    audit("Uncited finding."), audit(citation + "\n```ts\nmadeUp();\n```"),
    audit() + "\n```ts\nmadeUp();\n```",
    audit().replace("\n\n**Open questions**", "\n\nAll callers are affected, without cited evidence.\n\n**Open questions**")];
  for (const failed of failures) {
    const calls: StreamChatParams[] = [], visible: string[] = [], roles: string[] = []; let reason = "";
    const stream: SecureApiClient["streamChat"] = async (body, onChunk) => {
      calls.push(body); assert.deepEqual(visible, []); const content = calls.length === 1 ? failed : audit(); onChunk(content);
      return { message: { role: "assistant", content, timestamp: 1 }, usage, finishReason: "stop" };
    };
    const result = await streamSourceReviewedKnowledgeGaps({ stream, request, evidence, onChunk: c => visible.push(c),
      onRecovery: (_chars, why, body) => { reason = why; assert.equal(body.quotaTurnId, request.quotaTurnId); },
      onCallComplete: role => roles.push(role), baseUrl: "https://api.example.test" });
    assert.equal(calls.length, 2); assert.ok(["incomplete", "unverified-citation"].includes(reason));
    assert.deepEqual(roles, ["source-synthesis", "replacement"]); assert.deepEqual(visible, [publish()]);
    assert.ok(calls[1].message.includes(request.message)); assert.ok(calls[1].message.includes(JSON.stringify(failed)));
    for (const field of ["context", "model", "provider", "enableThinking", "quotaTurnId", "maxTokens"] as const) assert.deepEqual(calls[1][field], request[field]);
    assert.deepEqual(result.usage, { ...usage, inputTokens: 200, outputTokens: 40, estimatedCostUsd: 0.2 });
  }
});

test("a length stop inside a citation replaces the whole private answer, never appending or publishing it", async () => {
  let calls = 0, visible = ""; const partial = "**Source-grounded review**\n```10:12:handler.ts\nif (enabled &&";
  const stream: SecureApiClient["streamChat"] = async () => ({ message: { role: "assistant", content: ++calls === 1 ? partial : audit(), timestamp: 1 },
    usage, finishReason: calls === 1 ? "length" : "stop" });
  await streamSourceReviewedKnowledgeGaps({ stream, request, evidence, onChunk: c => visible += c, baseUrl: "https://api.example.test" });
  assert.equal(calls, 2); assert.equal(visible, publish());
});

test("second-invalid and replacement-error outcomes publish nothing and retain known completed-call cost", async () => {
  for (const throwOnReplacement of [false, true]) {
    let calls = 0, visible = "", charged: typeof usage | undefined;
    const stream: SecureApiClient["streamChat"] = async () => {
      if (++calls === 2 && throwOnReplacement) throw Error("provider failure");
      return { message: { role: "assistant", content: audit(citation.replace("&&", "||")), timestamp: 1 }, usage, finishReason: "stop" };
    };
    await assert.rejects(streamSourceReviewedKnowledgeGaps({ stream, request, evidence,
      onChunk: c => visible += c, onFailureUsage: used => charged = used, baseUrl: "https://api.example.test" }),
      throwOnReplacement ? /provider failure/ : /could not verify its source quotes/);
    assert.equal(calls, 2); assert.equal(visible, ""); assert.equal(charged?.estimatedCostUsd, throwOnReplacement ? 0.1 : 0.2);
  }
});

test("known cost survives a missing usage result without fabricating the missing measurement", async () => {
  let calls = 0;
  const stream: SecureApiClient["streamChat"] = async () => ({ message: { role: "assistant", content: ++calls === 1 ? "" : audit(), timestamp: 1 },
    ...(calls === 1 ? { usage } : {}), finishReason: "stop" });
  const result = await streamSourceReviewedKnowledgeGaps({ stream, request, evidence, onChunk: () => undefined, baseUrl: "https://api.example.test" });
  assert.deepEqual(result.usage, usage);
});

test("a publication error never counts completed-call usage twice", async () => {
  let calls = 0, knownCost = 0;
  const stream: SecureApiClient["streamChat"] = async () => ({ message: { role: "assistant", content: ++calls === 1 ? "" : audit(), timestamp: 1 }, usage, finishReason: "stop" });
  await assert.rejects(streamSourceReviewedKnowledgeGaps({ stream, request, evidence,
    onChunk: () => { throw Error("publication failed"); }, onFailureUsage: used => knownCost = used.estimatedCostUsd,
    baseUrl: "https://api.example.test" }), /publication failed/);
  assert.equal(calls, 2); assert.equal(knownCost, 0.2);
});

test("exact quotes with incorrect offsets rebind to frozen source without another model call", async () => {
  let calls = 0, visible = "";
  const stream: SecureApiClient["streamChat"] = async () => {
    calls++; return { message: { role: "assistant", content: audit(citation.replace("10:12:", "90:92:")), timestamp: 1 }, finishReason: "stop" };
  };
  await streamSourceReviewedKnowledgeGaps({ stream, request, evidence, onChunk: c => visible += c, baseUrl: "https://api.example.test" });
  assert.equal(calls, 1); assert.equal(visible, publish());
});

test("Stop before a request, after synthesis or during replacement never publishes or initiates a further call", async () => {
  for (const stopAt of [0, 1, 2]) {
    const controller = new AbortController(); let calls = 0, visible = "", knownCost = 0;
    if (stopAt === 0) controller.abort();
    const stream: SecureApiClient["streamChat"] = async () => {
      calls++; if (calls === stopAt) controller.abort();
      return { message: { role: "assistant", content: calls === 1 ? "" : audit(), timestamp: 1 }, usage, finishReason: "stop" };
    };
    await assert.rejects(streamSourceReviewedKnowledgeGaps({ stream, request, evidence, signal: controller.signal,
      onChunk: c => visible += c, onFailureUsage: used => knownCost = used.estimatedCostUsd, baseUrl: "https://api.example.test" }), { name: "AbortError" });
    assert.equal(calls, stopAt); assert.equal(visible, ""); assert.equal(knownCost, stopAt * 0.1);
  }
});

test("thin evidence, generic Gaps and other use cases retain direct streaming without extra audit calls", async () => {
  for (const variant of [{ request, evidence: undefined }, { request, evidence: { focusFiles: [{ path: "unknown.file", content: " " }] } },
    { request: { ...request, message: "Find knowledge gaps" }, evidence }, { request: { ...request, useCase: "blast_radius" as const }, evidence }]) {
    let calls = 0, visible = "";
    const stream: SecureApiClient["streamChat"] = async (body, onChunk) => {
      assert.equal(body, variant.request); calls++; onChunk("Available evidence is insufficient.");
      return { message: { role: "assistant", content: "Available evidence is insufficient.", timestamp: 1 } };
    };
    await streamSourceReviewedKnowledgeGaps({ stream, ...variant, onChunk: c => visible += c,
      onReview: () => assert.fail("No audit for absent source or another task"), baseUrl: "https://api.example.test" });
    assert.equal(calls, 1); assert.equal(visible, "Available evidence is insufficient.");
  }
  const final = enrichKnowledgeGapsResponse("Invented architecture and policy.", { userFocus: "An arbitrary unavailable topic", focusFiles: [] });
  assert.ok(final.includes("can’t establish")); assert.ok(!final.includes("Invented"));
});

test("replacement retains source and original task; generic continuation policy remains unchanged", () => {
  const message = buildKnowledgeGapsContinuationMessage(request.message, "");
  assert.ok(message.startsWith(request.message)); assert.ok(message.includes("one complete replacement answer"));
  assert.ok(message.includes("Do not ask for a prior response"));
  assert.equal(buildKnowledgeGapsContinuationMessage("Find owners", "partial"), LENGTH_CONTINUE_PROMPT);
});
