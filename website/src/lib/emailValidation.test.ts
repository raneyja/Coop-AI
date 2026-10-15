import assert from "node:assert/strict";
import test from "node:test";
import { isPlausibleEmail } from "./emailValidation";

test("public form email validation retains the basic address shape", () => {
  assert.equal(isPlausibleEmail("founder@example.com"), true);
  for (const value of ["", "no-at.example.com", "a@@example.com", "a@example", "a@.example", "a@example.", "a b@example.com", "a@example.com\n", "a".repeat(100_000) + "@example.com"]) {
    assert.equal(isPlausibleEmail(value), false, value.slice(0, 80));
  }
});
