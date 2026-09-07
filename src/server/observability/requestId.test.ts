import assert from "node:assert/strict";
import test from "node:test";
import { resolveHttpRequestId } from "./requestId";

test("echoes a safe incoming x-request-id", () => {
  const id = resolveHttpRequestId({ "x-request-id": "client-turn-99" });
  assert.equal(id, "client-turn-99");
});

test("rejects short or unsafe incoming ids and generates one", () => {
  const generated = resolveHttpRequestId({ "x-request-id": "nope" });
  assert.notEqual(generated, "nope");
  assert.match(generated, /^[0-9a-f-]{36}$/i);

  const injected = resolveHttpRequestId({ "x-request-id": "x".repeat(200) });
  assert.notEqual(injected.length, 200);

  const header = resolveHttpRequestId({ "x-request-id": "abc def" });
  assert.notEqual(header, "abc def");
});

test("generates when the header is missing", () => {
  const id = resolveHttpRequestId({});
  assert.match(id, /^[0-9a-f-]{36}$/i);
});
