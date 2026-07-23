import assert from "node:assert/strict";
import {
  isChatSessionIdle,
  resolveLastActiveAt,
  shouldStartFreshThreadOnRestore
} from "./chatThreadRestore";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  const now = 1_700_000_000_000;

  await test("isChatSessionIdle is false when idle timeout is disabled", () => {
    assert.equal(isChatSessionIdle(now - 86_400_000, 0, now), false);
  });

  await test("isChatSessionIdle is true after the threshold passes", () => {
    assert.equal(isChatSessionIdle(now - 5 * 60_000, 4 * 60_000, now), true);
    assert.equal(isChatSessionIdle(now - 60_000, 4 * 60_000, now), false);
  });

  await test("shouldStartFreshThreadOnRestore keeps empty threads on landing", () => {
    assert.equal(shouldStartFreshThreadOnRestore({ messages: [] }), false);
  });

  await test("shouldStartFreshThreadOnRestore starts fresh when prior thread has messages", () => {
    assert.equal(shouldStartFreshThreadOnRestore({ messages: [{ content: "hi" }] }), true);
  });

  await test("resolveLastActiveAt migrates legacy snapshots from thread timestamps", () => {
    assert.equal(resolveLastActiveAt(undefined, [{ updatedAt: 100 }, { updatedAt: 250 }]), 250);
    assert.equal(resolveLastActiveAt(900, [{ updatedAt: 100 }]), 900);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
