import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readBoundedCloneFile } from "./readBoundedCloneFile";

test("clone reads are bounded and reject a symlink to a file outside the clone", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-bounded-clone-"));
  try {
    const source = path.join(root, "source.ts");
    const link = path.join(root, "link.ts");
    fs.writeFileSync(source, "export const safe = true;\n");
    fs.symlinkSync(source, link);

    assert.deepEqual(readBoundedCloneFile(source, 100), { kind: "read", source: "export const safe = true;\n" });
    assert.deepEqual(readBoundedCloneFile(source, 5), { kind: "skip", reason: "oversize" });
    assert.deepEqual(readBoundedCloneFile(link, 100), { kind: "skip", reason: "unavailable" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
