import { describe, expect, it } from "vitest";
import {
  adminPortalAcceptInviteUrl,
  adminPortalFreshLoginUrl,
  adminPortalLoginUrl
} from "./adminPortalUrl";

describe("adminPortalLoginUrl", () => {
  it("appends /login to base URL", () => {
    expect(adminPortalLoginUrl("https://admin.coop-ai.dev")).toBe("https://admin.coop-ai.dev/login");
  });

  it("does not double-append /login", () => {
    expect(adminPortalLoginUrl("https://admin.coop-ai.dev/login")).toBe("https://admin.coop-ai.dev/login");
  });

  it("strips trailing slashes", () => {
    expect(adminPortalLoginUrl("https://admin.coop-ai.dev/")).toBe("https://admin.coop-ai.dev/login");
  });
});

describe("adminPortalFreshLoginUrl", () => {
  it("adds signedOut flag for email CTAs", () => {
    expect(adminPortalFreshLoginUrl("https://admin.coop-ai.dev")).toBe(
      "https://admin.coop-ai.dev/login?signedOut=1"
    );
  });

  it("prefills email when provided", () => {
    expect(adminPortalFreshLoginUrl("https://admin.coop-ai.dev", { email: "owner@example.com" })).toBe(
      "https://admin.coop-ai.dev/login?signedOut=1&email=owner%40example.com"
    );
  });

  it("strips /login suffix from base before building", () => {
    expect(adminPortalFreshLoginUrl("https://admin.coop-ai.dev/login/", { email: "a@b.co" })).toBe(
      "https://admin.coop-ai.dev/login?signedOut=1&email=a%40b.co"
    );
  });

  it("ignores blank email", () => {
    expect(adminPortalFreshLoginUrl("https://admin.coop-ai.dev", { email: "  " })).toBe(
      "https://admin.coop-ai.dev/login?signedOut=1"
    );
  });
});

describe("adminPortalAcceptInviteUrl", () => {
  it("builds accept-invite URL with encoded token", () => {
    expect(adminPortalAcceptInviteUrl("https://admin.coop-ai.dev", "coop_invite_abc+def")).toBe(
      "https://admin.coop-ai.dev/accept-invite?token=coop_invite_abc%2Bdef"
    );
  });

  it("strips /login suffix from base URL", () => {
    expect(adminPortalAcceptInviteUrl("https://admin.coop-ai.dev/login", "coop_invite_xyz")).toBe(
      "https://admin.coop-ai.dev/accept-invite?token=coop_invite_xyz"
    );
  });
});
