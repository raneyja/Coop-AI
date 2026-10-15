import assert from "node:assert/strict";
import test from "node:test";
import { adminPublicOrigin } from "./serverCoopApi";

test("production admin auth redirects ignore the request origin", () => {
  assert.equal(adminPublicOrigin("https://attacker.example", "production"), "https://admin.coop-ai.dev");
  assert.equal(adminPublicOrigin("http://localhost:3002", "development"), "http://localhost:3002");
});
