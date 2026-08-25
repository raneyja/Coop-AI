import assert from "node:assert/strict";
import { replaceExclusiveDisposable } from "./exclusiveDisposable";

function testReplaceDisposesPreviousListener(): void {
  const disposed: string[] = [];
  const first = { dispose: () => disposed.push("first") };
  const second = { dispose: () => disposed.push("second") };

  const held = replaceExclusiveDisposable(first, second);
  assert.equal(held, second);
  assert.deepEqual(disposed, ["first"]);

  replaceExclusiveDisposable(held, { dispose: () => disposed.push("third") });
  assert.deepEqual(disposed, ["first", "second"]);
}

function testReplaceWithNoPreviousIsSafe(): void {
  const next = { dispose: () => undefined };
  assert.equal(replaceExclusiveDisposable(undefined, next), next);
}

testReplaceDisposesPreviousListener();
testReplaceWithNoPreviousIsSafe();
