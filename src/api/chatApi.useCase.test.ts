import assert from "node:assert/strict";
import test from "node:test";
import { readUseCase } from "./chatApi";

test("intent_job survives the API boundary", () => {
  assert.equal(readUseCase("intent_job"), "intent_job");
});

test("unknown use cases still fail open to chat", () => {
  assert.equal(readUseCase("not-a-use-case"), "chat");
  assert.equal(readUseCase(undefined), "chat");
});
