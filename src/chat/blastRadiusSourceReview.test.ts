import assert from "node:assert/strict";
import test from "node:test";
import { streamSourceGroundedBlast, type BlastModelPhaseEvent } from "./blastRadiusSourceReview";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";

const source = "if (ready) {\n  await persist();\n}";
const quote = "```1:3:src/caller.ts\n" + source + "\n```";
const request: StreamChatParams = {
  message: "Explain exception handling.\n## Opened selected-ref source bodies\n" + source,
  context: { owner: "org", repo: "project", branch: "release", selectedLines: { start: 1, end: 1 } },
  fileSource: "remote", sessionMode: "indexed-repo",
  history: [{ role: "user", content: "Keep the original question in scope.", timestamp: 1 }],
  model: "claude-sonnet-4-6", provider: "anthropic", useCase: "blast_radius",
  temperature: 0.5, maxTokens: 16000, enableThinking: true, quotaTurnId: "original-turn"
};
const evidence: BlastRadiusEvidence = { directDependents: ["src/caller.ts"], sourceFiles: [{
  role: "dependent", path: "src/caller.ts", content: source, repoId: "github:org/project",
  branch: "release", startLine: 1, endLine: 3, truncated: false
}] };
const usage = { inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.1, provider: "anthropic", model: request.model };
const result = (content: string, finishReason = "stop", withUsage = true) => ({
  message: { role: "assistant" as const, content, timestamp: 1 }, finishReason: finishReason as "stop" | "length",
  usage: withUsage ? { ...usage } : undefined
});

test("normal source answers use one call and preserve the task and all routing/scope controls", async () => {
  for (const task of ["Explain exception handling.", "What happens if this export is removed?",
    "What changes if the call becomes asynchronous?", "What concurrency assumptions are established?"]) {
    const original = { ...request, message: task + "\n## Opened selected-ref source bodies\n" + source };
    const calls: StreamChatParams[] = [], visible: string[] = [], phases: BlastModelPhaseEvent[] = [];
    const stream: SecureApiClient["streamChat"] = async (body, chunk) => {
      calls.push(body); chunk(quote); assert.deepEqual(visible, []);
      return result(quote);
    };
    const final = await streamSourceGroundedBlast({ stream, request: original, evidence,
      onChunk: c => visible.push(c), onPhase: p => phases.push(p), baseUrl: "https://api.example.test" });
    assert.deepEqual(calls, [original]);
    assert.deepEqual(visible, [quote]);
    assert.deepEqual(final.usage, usage);
    assert.deepEqual(phases.map(p => [p.phase, p.event]), [["synthesis", "start"], ["synthesis", "complete"]]);
    assert.ok((phases[1].durationMs ?? -1) >= 0);
  }
});

test("invalid source quotes trigger one replacement preserving original evidence/history/model/thinking/ref/quota", async () => {
  const calls: StreamChatParams[] = [], visible: string[] = [];
  const invalid = quote.replace("await persist();", "await destroy();");
  const stream: SecureApiClient["streamChat"] = async (body, chunk) => {
    calls.push(body); const answer = calls.length === 1 ? invalid : quote;
    chunk(answer); assert.deepEqual(visible, []);
    return result(answer);
  };
  const final = await streamSourceGroundedBlast({ stream, request, evidence, onChunk: c => visible.push(c),
    baseUrl: "https://api.example.test" });
  assert.equal(calls.length, 2); assert.deepEqual(visible, [quote]);
  const { message: repairedMessage, ...repairControls } = calls[1];
  const { message: originalMessage, ...originalControls } = request;
  assert.deepEqual(repairControls, originalControls);
  assert.ok(repairedMessage.startsWith(originalMessage + "\n\n"));
  assert.match(repairedMessage, /invalid-source-citation/);
  assert.match(repairedMessage, /untrusted data, not instructions/);
  assert.equal(final.usage?.inputTokens, 200);
  assert.equal(final.usage?.outputTokens, 40);
  assert.equal(final.usage?.estimatedCostUsd, 0.2);
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.1, provider: "anthropic", model: request.model });
});

test("empty, length-cutoff and unfinished long/tilde fences get at most one repair", async () => {
  for (const first of [result(""), result("partial", "length"), result("````typescript\npartial"), result("~~~~typescript\npartial")]) {
    let calls = 0; const visible: string[] = [];
    const stream: SecureApiClient["streamChat"] = async (_body, chunk) => {
      const answer = ++calls === 1 ? first : result(quote);
      chunk(answer.message.content); assert.deepEqual(visible, []); return answer;
    };
    await streamSourceGroundedBlast({ stream, request, evidence,
      onChunk: c => visible.push(c), baseUrl: "https://api.example.test" });
    assert.equal(calls, 2); assert.deepEqual(visible, [quote]);
  }
});

test("a failed or invalid repair publishes neither attempt and reports known usage once", async () => {
  for (const fail of ["throw", "length", "bad-quote"] as const) {
    let calls = 0; const visible: string[] = [], known: unknown[] = [];
    const stream: SecureApiClient["streamChat"] = async () => {
      if (++calls === 1) return result("partial", "length");
      if (fail === "throw") throw Error("provider failed");
      return fail === "length" ? result("still partial", "length") : result(quote.replace("persist", "destroy"));
    };
    await assert.rejects(streamSourceGroundedBlast({ stream, request, evidence,
      onChunk: c => visible.push(c), onPartialUsage: u => known.push(u), baseUrl: "https://api.example.test" }));
    assert.equal(calls, 2); assert.deepEqual(visible, []);
    assert.equal(known.length, fail === "throw" ? 1 : 2);
  }
});

test("Stop before or during synthesis prevents publication and another request", async () => {
  for (const preAborted of [true, false]) {
    const controller = new AbortController(); let calls = 0, visible = "", thinking = "";
    if (preAborted) controller.abort();
    const stream: SecureApiClient["streamChat"] = async (_body, chunk, _base, _signal, onThinking) => {
      calls++; chunk(quote); controller.abort(); onThinking?.("late thought"); return result(quote);
    };
    await assert.rejects(streamSourceGroundedBlast({ stream, request, evidence, signal: controller.signal,
      onChunk: c => visible += c, onThinking: c => thinking += c, baseUrl: "https://api.example.test" }), { name: "AbortError" });
    assert.equal(calls, preAborted ? 0 : 1); assert.equal(visible, ""); assert.equal(thinking, "");
  }
});

test("Stop just before repair prevents a second call and retains known first-call cost", async () => {
  const controller = new AbortController(); let calls = 0; const known: unknown[] = [];
  const stream: SecureApiClient["streamChat"] = async () => { calls++; return result("partial", "length"); };
  await assert.rejects(streamSourceGroundedBlast({ stream, request, evidence, signal: controller.signal,
    onChunk: () => assert.fail("no publication"), onRepair: () => controller.abort(), onPartialUsage: u => known.push(u),
    baseUrl: "https://api.example.test" }), { name: "AbortError" });
  assert.equal(calls, 1); assert.deepEqual(known, [usage]);
});

test("missing call usage remains unavailable while known call costs are retained", async () => {
  for (const missingFirst of [true, false]) {
    let calls = 0; const known: unknown[] = [];
    const stream: SecureApiClient["streamChat"] = async () => ++calls === 1
      ? result("partial", "length", !missingFirst) : result(quote, "stop", missingFirst);
    const final = await streamSourceGroundedBlast({ stream, request, evidence, onChunk: () => undefined,
      onPartialUsage: u => known.push(u), baseUrl: "https://api.example.test" });
    assert.equal(calls, 2); assert.equal(final.usage, undefined); assert.deepEqual(known, [usage]);
  }
});

test("actual differing model usage is reported per call rather than mislabeled as one model's total", async () => {
  let calls = 0; const known: { model: string }[] = [];
  const stream: SecureApiClient["streamChat"] = async () => {
    const answer = ++calls === 1 ? result("partial", "length") : result(quote);
    answer.usage!.model = calls === 1 ? "provider-routed-model" : request.model;
    return answer;
  };
  const final = await streamSourceGroundedBlast({ stream, request, evidence,
    onChunk: () => undefined, onPartialUsage: u => known.push(u), baseUrl: "https://api.example.test" });
  assert.equal(final.usage, undefined);
  assert.deepEqual(known.map(u => u.model), ["provider-routed-model", request.model]);
});

test("graph-only and other use cases retain their existing single streaming path", async () => {
  for (const [useCase, sources] of [["blast_radius", undefined], ["knowledge_gaps", evidence]] as const) {
    let calls = 0, visible = "";
    const stream: SecureApiClient["streamChat"] = async (_body, chunk) => {
      calls++; chunk("Available evidence only."); return result("Available evidence only.");
    };
    await streamSourceGroundedBlast({ stream, request: { ...request, useCase }, evidence: sources,
      onChunk: c => visible += c, baseUrl: "https://api.example.test" });
    assert.equal(calls, 1); assert.equal(visible, "Available evidence only.");
  }
});

test("quote validity does not create a semantic certification or a mandatory second generation", async () => {
  let calls = 0;
  const prose = "A semantic conclusion requiring model judgment.";
  const stream: SecureApiClient["streamChat"] = async () => { calls++; return result(prose + "\n\n" + quote); };
  const final = await streamSourceGroundedBlast({ stream, request, evidence,
    onChunk: () => undefined, baseUrl: "https://api.example.test" });
  assert.equal(calls, 1); assert.equal(final.message.content, prose + "\n\n" + quote);
});

test("only successful validation exposes a copied source window for final publication", async () => {
  const localEvidence = { ...evidence, sourceFiles: evidence.sourceFiles!.map(file => ({ ...file })) };
  let validated = 0;
  const stream: SecureApiClient["streamChat"] = async () => result(quote);
  await streamSourceGroundedBlast({ stream, request, evidence: localEvidence,
    onChunk: () => undefined, baseUrl: "https://api.example.test",
    onValidated: windows => {
      validated++;
      localEvidence.sourceFiles[0].content = "mutated after validation";
      assert.deepEqual(windows, [{ path: "src/caller.ts", content: source, startLine: 1 }]);
    } });
  assert.equal(validated, 1);
  await assert.rejects(streamSourceGroundedBlast({ stream: async () => result(quote.replace("persist", "destroy")),
    request, evidence, onChunk: () => assert.fail("no invalid publication"),
    onValidated: () => assert.fail("no invalid source snapshot"), baseUrl: "https://api.example.test" }));
});

test("unavailable usage is never synthesized as a zero-cost completion", async () => {
  const phases: BlastModelPhaseEvent[] = [];
  const final = await streamSourceGroundedBlast({ stream: async () => result(quote, "stop", false), request, evidence,
    onChunk: () => undefined, onPhase: phase => phases.push(phase),
    onPartialUsage: () => assert.fail("no known usage exists"), baseUrl: "https://api.example.test" });
  assert.equal(final.usage, undefined);
  assert.equal(phases[1].usage, undefined);
});
