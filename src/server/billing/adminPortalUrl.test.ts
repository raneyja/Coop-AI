import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adminPortalAcceptInviteUrl,
  adminPortalFreshLoginUrl,
  adminPortalLoginUrl,
  adminPortalSeatRequestsUrl
} from "./adminPortalUrl";

describe("adminPortalLoginUrl", () => {
  it("appends /login to base URL", () => {
    assert.equal(adminPortalLoginUrl("https://admin.coop-ai.dev"), "https://admin.coop-ai.dev/login");
  });

  it("does not double-append /login", () => {
    assert.equal(adminPortalLoginUrl("https://admin.coop-ai.dev/login"), "https://admin.coop-ai.dev/login");
  });

  it("strips trailing slashes", () => {
    assert.equal(adminPortalLoginUrl("https://admin.coop-ai.dev/"), "https://admin.coop-ai.dev/login");
  });
});

describe("adminPortalFreshLoginUrl", () => {
  it("adds signedOut flag for email CTAs", () => {
    assert.equal(adminPortalFreshLoginUrl("https://admin.coop-ai.dev"), "https://admin.coop-ai.dev/login?signedOut=1");
  });

  it("prefills email when provided", () => {
    assert.equal(adminPortalFreshLoginUrl("https://admin.coop-ai.dev", { email: "owner@example.com" }), "https://admin.coop-ai.dev/login?signedOut=1&email=owner%40example.com");
  });

  it("strips /login suffix from base before building", () => {
    assert.equal(adminPortalFreshLoginUrl("https://admin.coop-ai.dev/login/", { email: "a@b.co" }), "https://admin.coop-ai.dev/login?signedOut=1&email=a%40b.co");
  });

  it("ignores blank email", () => {
    assert.equal(adminPortalFreshLoginUrl("https://admin.coop-ai.dev", { email: "  " }), "https://admin.coop-ai.dev/login?signedOut=1");
  });
});

describe("adminPortalSeatRequestsUrl", () => {
  it("appends /requests and strips /login", () => {
    assert.equal(adminPortalSeatRequestsUrl("https://admin.coop-ai.dev/login/"), "https://admin.coop-ai.dev/requests");
  });
});

describe("adminPortalAcceptInviteUrl", () => {
  it("builds accept-invite URL with encoded token", () => {
    assert.equal(adminPortalAcceptInviteUrl("https://admin.coop-ai.dev", "coop_invite_abc+def"), "https://admin.coop-ai.dev/accept-invite?token=coop_invite_abc%2Bdef");
  });

  it("strips /login suffix from base URL", () => {
    assert.equal(adminPortalAcceptInviteUrl("https://admin.coop-ai.dev/login", "coop_invite_xyz"), "https://admin.coop-ai.dev/accept-invite?token=coop_invite_xyz");
  });
});
