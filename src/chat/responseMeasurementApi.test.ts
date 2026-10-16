import assert from "node:assert/strict";
import test from "node:test";
import { SecureApiClient, type StreamChatParams } from "./SecureApiClient";
import { ResponseTimingTrace, registerResponseTiming, type ResponseTimingEvent } from "./chatResponseTiming";

const request: StreamChatParams = { message: "Synthetic source question", context: {}, history: [], model: "fixture",
  provider: "anthropic", useCase: "chat", temperature: 0.5, maxTokens: 1000, enableThinking: true };
const secrets = { get: async () => "fixture-token", store: async () => undefined, delete: async () => undefined };

test("real client rejects forged timing identity and distinguishes complete, incomplete, failure and Stop", async () => {
  const original = globalThis.fetch;
  try {
    for (const mode of ["completed", "incomplete", "failed", "canceled"] as const) {
      const events: ResponseTimingEvent[] = [], controller = new AbortController();
      const trace = new ResponseTimingTrace({ traceId: mode }, event => events.push(event));
      registerResponseTiming(controller.signal, trace);
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.enableThinking, true);
        assert.equal(body.responseTiming.traceId, mode);
        if (mode === "canceled") { controller.abort(); throw new DOMException("Stopped", "AbortError"); }
        const timing = { type: "response-timing", ...body.responseTiming, requestId: "server-id", elapsedMs: 5, event: "accepted" };
        const chunks: unknown[] = [{ ...timing, callId: "other-call" }, { ...timing, traceId: "other-turn" },
          { ...timing, elapsedMs: -1 }, { ...timing, event: "credential=bad" }, timing,
          { type: "thinking", text: "Private thinking" }, { type: "delta", text: "Answer." }];
        if (mode === "completed") chunks.push({ type: "done", usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }, model: "fixture", provider: "anthropic", finishReason: "stop" });
        if (mode === "failed") chunks.push({ type: "error", message: "Synthetic failure" });
        return new Response(chunks.map(chunk => "data: " + JSON.stringify(chunk) + "\n\n").join(""));
      };
      const output: string[] = [];
      const promise = new SecureApiClient(secrets as never).streamChat(request, c => output.push(c), "https://fixture.invalid", controller.signal);
      if (mode === "failed" || mode === "canceled") await assert.rejects(promise);
      else await promise;
      trace.finish(mode === "failed" ? "failed" : "completed");
      assert.equal(events.find(e => e.phase === "ai" && e.event === "phase-end")?.outcome, mode);
      assert.equal(events.find(e => e.event === "turn-end")?.outcome, mode);
      assert.equal(events.filter(e => e.event === "backend").length, mode === "canceled" ? 0 : 1);
      assert.equal(events.some(e => e.event === "display"), false, "API token is never a display measurement");
      assert.ok(!JSON.stringify(events).includes("Private thinking"));
      assert.ok(!JSON.stringify(events).includes("fixture-token"));
    }
  } finally { globalThis.fetch = original; }
});
