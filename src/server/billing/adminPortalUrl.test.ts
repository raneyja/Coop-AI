import { describe, expect, it } from "vitest";
import { adminPortalAcceptInviteUrl, adminPortalLoginUrl } from "./adminPortalUrl";

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
