import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, validatePasswordStrength } from "./passwordCrypto";

test("hashPassword and verifyPassword round-trip", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.ok(hash.startsWith("scrypt:"));
  assert.ok(verifyPassword("correct horse battery staple", hash));
  assert.equal(verifyPassword("wrong password", hash), false);
});

test("validatePasswordStrength enforces minimum length", () => {
  assert.match(validatePasswordStrength("short", 12) ?? "", /12 characters/);
  assert.equal(validatePasswordStrength("twelvechars!", 12), undefined);
});
