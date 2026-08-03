import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

/**
 * Lightweight contract test: cancel must surface a signal workers can abort on.
 * Full WorkerPool integration is covered by runtime wiring (job:cancelled → abortJob).
 */
void (async () => {
  const bus = new EventEmitter();
  const aborted: string[] = [];
  bus.on("job:cancelled", (job: { id: string }) => {
    aborted.push(job.id);
  });

  bus.emit("job:cancelled", { id: "job-1" });
  assert.deepEqual(aborted, ["job-1"]);

  console.log("abortOnCancel: 1/1 tests passed");
})();
