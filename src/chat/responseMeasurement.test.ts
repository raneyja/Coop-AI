import assert from "node:assert/strict";
import test from "node:test";
import { ResponseTimingTrace, registerResponseTiming, responseTiming, timeResponseWork, validDisplayElapsed, type ResponseTimingEvent } from "./chatResponseTiming";
import { streamSourceGroundedBlast } from "./blastRadiusSourceReview";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";

test("monotonic local durations retain identity across concurrent turns and private repairs", async () => {
  let clock = 100;
  const events: ResponseTimingEvent[] = [], other: ResponseTimingEvent[] = [];
  const trace = new ResponseTimingTrace({ traceId: "one", submissionId: "send" }, e => events.push(e), () => clock);
  const signal = new AbortController(), second = new AbortController();
  registerResponseTiming(signal.signal, trace);
  registerResponseTiming(second.signal, new ResponseTimingTrace({ traceId: "two" }, e => other.push(e), () => clock));
  assert.notEqual(responseTiming(signal.signal), responseTiming(second.signal));
  const end = trace.span("evidence"); clock += 17; end(); end();
  assert.equal(events.at(-1)?.durationMs, 17);
  let calls = 0, published = "";
  const source = "if (enabled) save();";
  const quote = "```1:1:lib/a.ts\n" + source + "\n```";
  const request: StreamChatParams = { message: "Explain the shown check.", context: {}, history: [],
    model: "fixture", provider: "anthropic", useCase: "blast_radius", temperature: 0.5, maxTokens: 4096, enableThinking: true };
  const stream: SecureApiClient["streamChat"] = async (body, onChunk) => {
    const endCall = trace.span("ai", { callId: trace.nextCallId() });
    clock += 80;
    calls++;
    const content = body.sourceClaimReview ? sourceClaimVerdictFixture(body)
      : calls === 1 ? quote.replace("save()", "erase()") : quote;
    trace.event("model-first-delta", { displayed: false }); onChunk(content);
    assert.equal(published, "", "private model output is not an answer-display measurement");
    endCall();
    return { message: { role: "assistant", content, timestamp: 0 }, finishReason: "stop" };
  };
  await streamSourceGroundedBlast({ stream, request, evidence: { directDependents: ["lib/a.ts"], sourceFiles: [{ role: "dependent", repoId: "github:fixture/source", branch: "pinned", path: "lib/a.ts", content: source, startLine: 1, endLine: 1, truncated: false }] },
    signal: signal.signal, baseUrl: "https://api.example.test", onChunk: c => { published += c; trace.event("publication-complete"); } });
  trace.finish("completed"); trace.finish("failed");
  assert.equal(calls, 3); assert.ok(published.includes(source));
  assert.equal(events.filter(e => e.event === "turn-end").length, 1);
  assert.equal(events.at(-1)?.repaired, true);
  assert.equal(events.at(-1)?.elapsedMs, 257);
  assert.equal(events.filter(e => e.phase === "source-validation" && e.event === "phase-end").length, 2);
  assert.equal(events.filter(e => e.phase === "claim-validation" && e.event === "phase-end").length, 1);
  assert.ok(events.every(e => !JSON.stringify(e).includes(source)));
  assert.deepEqual(other, []);
});

test("Stop is terminal, planner timeout is not turn cancellation, and missing model end is incomplete", () => {
  const events: ResponseTimingEvent[] = [];
  const trace = new ResponseTimingTrace({ traceId: "missing" }, e => events.push(e), () => 0);
  const planner = new AbortController(); registerResponseTiming(planner.signal, trace, false); planner.abort();
  assert.equal(events.length, 0);
  trace.span("ai")("incomplete"); trace.finish("completed");
  assert.equal(events.at(-1)?.outcome, "incomplete");
  const canceled: ResponseTimingEvent[] = [], controller = new AbortController();
  registerResponseTiming(controller.signal, new ResponseTimingTrace({ traceId: "stop" }, e => canceled.push(e), () => 0));
  controller.abort(); responseTiming(controller.signal)?.finish("completed");
  responseTiming(controller.signal)?.display("complete", 20);
  assert.equal(canceled.length, 1); assert.equal(canceled[0].outcome, "canceled");
});

test("bounded metadata, validated display duration, and failed synchronous validation", () => {
  const events: ResponseTimingEvent[] = [], controller = new AbortController();
  registerResponseTiming(controller.signal, new ResponseTimingTrace({ traceId: "bounded" }, e => events.push(e), () => 0));
  assert.throws(() => timeResponseWork(controller.signal, "source-validation", () => { throw new Error("fixture"); }));
  assert.equal(events.at(-1)?.outcome, "failed");
  for (let i = 0; i < 200; i++) responseTiming(controller.signal)?.event("metadata");
  assert.equal(events.length, 92);
  responseTiming(controller.signal)?.finish("completed");
  responseTiming(controller.signal)?.display("first-answer-content", 100);
  responseTiming(controller.signal)?.display("first-answer-content", 90);
  responseTiming(controller.signal)?.display("complete", 150);
  assert.equal(events.length, 95);
  assert.equal(events.filter(e => e.event === "display").length, 2);
  for (const invalid of [NaN, Infinity, -1, "30", undefined, 86_400_001]) assert.equal(validDisplayElapsed(invalid), false);
  assert.equal(validDisplayElapsed(0), true);
});

test("submission clock rejects duplicate, late, wrong-turn and restored-message receipts with bounded storage", async () => {
  const { SubmissionDisplayClock, acceptDisplayReceipt } = await import("./chatResponseTiming");
  let now = 0;
  const clock = new SubmissionDisplayClock(() => now);
  assert.equal(clock.receipt({ traceId: "historical", submissionId: "saved" }, "complete"), undefined);
  clock.submit("new"); now = 17;
  assert.equal(clock.pending({ traceId: "current", submissionId: "new" }, "first-answer-content"), true);
  assert.equal(clock.receipt({ traceId: "current", submissionId: "new" }, "first-answer-content"), 17);
  assert.equal(clock.receipt({ traceId: "current", submissionId: "new" }, "first-answer-content"), undefined);
  assert.equal(clock.receipt({ traceId: "stale", submissionId: "new" }, "complete"), undefined);
  assert.equal(clock.pending({ traceId: "current", submissionId: "new" }, "first-answer-content"), false);
  assert.equal(clock.pending({ traceId: "current", submissionId: "new" }, "complete"), true);
  now = 30; assert.equal(clock.receipt({ traceId: "current", submissionId: "new" }, "complete"), 30);
  assert.equal(clock.receipt({ traceId: "current", submissionId: "new" }, "first-answer-content"), undefined);
  for (let i = 0; i < 65; i++) clock.submit(String(i));
  assert.equal(clock.receipt({ traceId: "old", submissionId: "0" }, "complete"), undefined);
  const trace = new ResponseTimingTrace({ traceId: "correct", submissionId: "id" }, () => undefined, () => 0);
  assert.equal(acceptDisplayReceipt(trace, { traceId: "wrong", submissionId: "id", milestone: "complete", elapsedMs: 10 }), false);
  assert.equal(acceptDisplayReceipt(trace, { traceId: "correct", submissionId: "wrong", milestone: "complete", elapsedMs: 10 }), false);
  assert.equal(acceptDisplayReceipt(trace, { traceId: "correct", submissionId: "id", milestone: "complete", elapsedMs: 10 }), true);
  assert.equal(acceptDisplayReceipt(trace, { traceId: "correct", submissionId: "id", milestone: "complete", elapsedMs: 10 }), false);
});

test("a visible token and exact quote cannot make the useful-answer target green without semantic task review", async () => {
  const { summarizeResponseMeasurement } = await import("./responseMeasurementReport");
  const events: ResponseTimingEvent[] = [], trace = new ResponseTimingTrace({ traceId: "review" }, e => events.push(e), () => 10);
  trace.display("first-answer-content", 8); trace.display("complete", 50); trace.finish("completed");
  const quality = { sourceRef: "pass", citationIntegrity: "pass", supportedClaims: "not-reviewed", truthfulUnknowns: "pass", requestedTask: "pass", firstVisibleContentUseful: "not-reviewed" } as const;
  assert.equal(summarizeResponseMeasurement(events, quality).usefulAnswerTarget, "unqualified");
  assert.equal(summarizeResponseMeasurement(events, { ...quality, supportedClaims: "fail", firstVisibleContentUseful: "pass" }).firstUsefulSupportedAnswerMs, null);
  const passed = summarizeResponseMeasurement(events, { ...quality, supportedClaims: "pass", firstVisibleContentUseful: "pass" });
  assert.equal(passed.firstUsefulSupportedAnswerMs, 8); assert.equal(passed.usefulAnswerTarget, "within-guideline");
  assert.throws(() => summarizeResponseMeasurement([...events, { ...events[0], traceId: "wrong" }], quality));
});


test("failed diagnostic delivery cannot fail a phase or Stop", () => {
  const controller = new AbortController();
  const trace = new ResponseTimingTrace({ traceId: "unavailable-log" }, () => { throw new Error("Disposed channel"); }, () => 0);
  registerResponseTiming(controller.signal, trace);
  assert.doesNotThrow(() => trace.span("ai")());
  assert.doesNotThrow(() => controller.abort());
});
