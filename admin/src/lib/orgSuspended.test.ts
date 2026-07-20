import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOrgSuspendedError, isOrgSuspendedResult } from "./coopApi";

describe("isOrgSuspendedError", () => {
  it("matches org_suspended error code", () => {
    assert.equal(isOrgSuspendedError(403, "org_suspended"), true);
  });

  it("matches suspension message on 403", () => {
    assert.equal(isOrgSuspendedError(403, undefined, "This organization has been suspended."), true);
  });

  it("ignores other 403s", () => {
    assert.equal(isOrgSuspendedError(403, "forbidden", "Only admins can do that."), false);
  });

  it("treats explicit org_suspended code regardless of status", () => {
    assert.equal(isOrgSuspendedError(500, "org_suspended"), true);
  });

  it("ignores suspension-like message without 403 or error code", () => {
    assert.equal(isOrgSuspendedError(401, undefined, "This organization has been suspended."), false);
  });
});

describe("isOrgSuspendedResult", () => {
  it("requires failed result", () => {
    assert.equal(
      isOrgSuspendedResult({ ok: true, status: 200, errorCode: "org_suspended" }),
      false
    );
    assert.equal(
      isOrgSuspendedResult({
        ok: false,
        status: 403,
        errorCode: "org_suspended",
        error: "This organization has been suspended."
      }),
      true
    );
  });
});
