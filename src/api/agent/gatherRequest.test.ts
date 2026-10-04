import assert from "node:assert/strict";
import { gatherRequest } from "./gatherRequest";
import type { AgentToolContext } from "./agentToolContext";

async function main() {
  const controller = new AbortController();
  const ctx = { gatherStartedAt: Date.now() - 8_990, searchSignal: controller.signal } as AgentToolContext;
  const result = await gatherRequest(ctx, "filename-search", () => new Promise<string>(() => {}), "unavailable");
  assert.equal(result, "unavailable");
  assert.equal(controller.signal.aborted, false, "Soft gather handoff must not stop the answer signal");
  let calls = 0;
  ctx.gatherStartedAt = Date.now() - 15_001;
  assert.equal(await gatherRequest(ctx, "remote-read", async () => { calls++; return "body"; }, "unavailable"), "unavailable");
  assert.equal(calls, 0, "No new network request after soft gather expires");
  ctx.gatherStartedAt = Date.now();
  assert.equal(await gatherRequest(ctx, "remote-read", async () => "body", "unavailable"), "body");
  const pending = gatherRequest(ctx, "remote-read", () => new Promise<string>(() => {}), "unavailable");
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  console.log("gather handoff: bounded waiting, no latency abort, user Stop passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
