import assert from "node:assert/strict";
import {
  indexStageFromProgress,
  isFullyUsable,
  isUsableForDeveloperAccess
} from "./verifyRepoBrowse";

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

  await test("indexStageFromProgress maps embedding band", () => {
    assert.equal(indexStageFromProgress(77).stage, "Embeddings");
    assert.match(indexStageFromProgress(77).detail, /several minutes/i);
  });

  await test("indexStageFromProgress maps clone and verify", () => {
    assert.equal(indexStageFromProgress(30).stage, "Cloning");
    assert.equal(indexStageFromProgress(92).stage, "Verifying");
  });

  await test("isUsableForDeveloperAccess allows legacy null browseStatus", () => {
    assert.equal(
      isUsableForDeveloperAccess({
        lightningEnabled: true,
        indexStatus: "ready",
        browseStatus: undefined
      }),
      true
    );
  });

  await test("isUsableForDeveloperAccess blocks browse failures", () => {
    assert.equal(
      isUsableForDeveloperAccess({
        lightningEnabled: true,
        indexStatus: "ready",
        browseStatus: "failed"
      }),
      false
    );
  });

  await test("isFullyUsable requires verified", () => {
    assert.equal(
      isFullyUsable({ lightningEnabled: true, indexStatus: "ready", browseStatus: "verified" }),
      true
    );
    assert.equal(
      isFullyUsable({ lightningEnabled: true, indexStatus: "ready", browseStatus: undefined }),
      false
    );
  });

  console.log(`verifyRepoBrowse: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void run();
