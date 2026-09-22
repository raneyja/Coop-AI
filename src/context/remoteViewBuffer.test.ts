import assert from "node:assert/strict";
import type { Uri } from "vscode";
import {
  clearRemotePatchBuffersForTests,
  rememberRemotePatchBuffer,
  remoteIdentityForUntitledUri
} from "./remoteViewBuffer";

function fakeUri(uriString: string): Uri {
  return { toString: () => uriString } as Uri;
}

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

  await test("API untitled viewing buffer is the remote file, not L Untitled-1", () => {
    clearRemotePatchBuffersForTests();
    const uri = fakeUri("untitled:Untitled-1");
    rememberRemotePatchBuffer(
      ".github/workflows/branch-build-ce.yml",
      uri,
      "name: Branch Build CE\n",
      { owner: "makeplane", repo: "plane" }
    );
    const identity = remoteIdentityForUntitledUri("untitled:Untitled-1");
    assert.equal(identity?.file, ".github/workflows/branch-build-ce.yml");
    assert.equal(identity?.fileSource, "remote");
    assert.equal(identity?.owner, "makeplane");
    assert.equal(identity?.repo, "plane");
    assert.equal(remoteIdentityForUntitledUri("untitled:Untitled-2"), undefined);
    clearRemotePatchBuffersForTests();
  });

  const total = passed + failed;
  console.log(`\nremoteViewBuffer: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
