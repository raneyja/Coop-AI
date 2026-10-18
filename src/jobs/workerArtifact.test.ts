import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {workerArtifactSha256} from "./workerPresence";

test("artifact identity reads the opened file across a path replacement and closes it", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coop-worker-artifact-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const filename = path.join(directory, "worker.js"), original = "original worker bytes";
  fs.writeFileSync(filename, original);
  const stat = fs.statSync, open = fs.openSync, close = fs.closeSync;
  let replaced = false, opened: number | undefined;
  const closed = new Set<number>();
  const replace = () => {
    if (replaced) return;
    replaced = true;
    fs.renameSync(filename, filename + ".original");
    fs.writeFileSync(filename, "different replacement");
  };
  // The old path-based stat/read pair races here. The descriptor-based reader
  // instead retains its opened artifact even when its name is replaced.
  t.mock.method(fs, "statSync", (file: fs.PathLike) => {
    const value = stat(file); if (file === filename) replace(); return value;
  });
  t.mock.method(fs, "openSync", (file: fs.PathLike, flags: fs.OpenMode) => {
    const descriptor = open(file, flags);
    if (file === filename && !replaced) { opened = descriptor; replace(); }
    return descriptor;
  });
  t.mock.method(fs, "closeSync", (descriptor: number) => { closed.add(descriptor); close(descriptor); });
  assert.equal(workerArtifactSha256(filename), createHash("sha256").update(original).digest("hex"));
  assert.equal(replaced, true);
  assert.ok(opened !== undefined && closed.has(opened));
});

test("artifact identity refuses missing, empty, nonregular, oversized and symlink paths", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coop-worker-artifact-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const empty = path.join(directory, "empty"), big = path.join(directory, "big"), link = path.join(directory, "link");
  fs.writeFileSync(empty, "");
  const descriptor = fs.openSync(big, "w");
  try { fs.ftruncateSync(descriptor, 128 * 1024 * 1024 + 1); } finally { fs.closeSync(descriptor); }
  const valid = path.join(directory, "valid"); fs.writeFileSync(valid, "worker");
  fs.symlinkSync(valid, link);
  for (const filename of [path.join(directory, "missing"), directory, empty, big, link]) {
    assert.throws(() => workerArtifactSha256(filename), /identity is unavailable/);
  }
});

test("artifact identity rejects growth without reading beyond the admitted size plus one", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coop-worker-artifact-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const filename = path.join(directory, "worker.js"), original = "worker bytes";
  fs.writeFileSync(filename, original);
  const read = fs.readSync;
  let grown = false, bytesRead = 0;
  t.mock.method(fs, "readSync", (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    const count = read(descriptor, buffer, offset, length, position); bytesRead += count;
    if (!grown) { grown = true; fs.appendFileSync(filename, "unexpected growth"); }
    return count;
  });
  assert.throws(() => workerArtifactSha256(filename), /identity is unavailable/);
  assert.equal(grown, true);
  assert.ok(bytesRead <= Buffer.byteLength(original) + 1);
});
