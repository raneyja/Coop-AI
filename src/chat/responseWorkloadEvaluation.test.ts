import assert from "node:assert/strict";
import test from "node:test";
import { evaluateResponseWorkloads } from "./responseWorkloadEvaluation";

test("bounded workload drives real API/stream/review owners and leaves unmeasured display/provider metrics missing", async () => {
  const report = await evaluateResponseWorkloads();
  assert.equal(report.results.length, 121);
  for (const result of report.results.slice(0, -1)) {
    const { workload, events, timings, quality } = result;
    assert.equal(workload.cacheHit, workload.cache === "fixture-warm");
    assert.equal(quality.citationIntegrity, "pass");
    assert.equal(timings.firstUsefulSupportedAnswerMs, null);
    assert.equal(timings.firstVisibleAnswerContentMs, null);
    const calls = events.filter(e => e.event === "phase-start" && e.phase === "ai");
    assert.equal(calls.length, workload.scenario === "valid" ? 2 : 3);
    assert.equal(events.filter(e => e.event === "phase-end" && e.phase === "claim-validation").length, 1);
    const backend = events.filter(e => e.event === "backend");
    assert.ok(backend.some(e => e.backendEvent === "accepted"));
    assert.ok(backend.some(e => e.backendEvent === "completed"));
    for (const event of backend) {
      assert.ok(calls.some(call => call.callId === event.callId));
      assert.equal(typeof event.requestId, "string");
      assert.ok(Number(event.backendElapsedMs) >= 0);
    }
    const firstModel = events.findIndex(e => e.event === "model-first-delta");
    const validated = events.findLastIndex(e => e.phase === "source-validation" && e.event === "phase-end");
    assert.ok(firstModel < validated);
    assert.equal(events.at(-1)?.outcome, "completed");
    assert.equal(events.at(-1)?.repaired, workload.scenario !== "valid");
    assert.ok(events.length <= 96);
    assert.ok(!JSON.stringify(events).includes("Synthetic private processing"));
    assert.ok(!JSON.stringify(events).includes("synthetic-test-token"));
  }
  const control = report.results.at(-1)!;
  assert.equal(control.quality.citationIntegrity, "pass");
  assert.equal(control.quality.supportedClaims, "fail");
  assert.equal(control.timings.hostCompletionMs, null);
});
