import { describe, expect, it } from "vitest";
import { adminPortalLoginUrl } from "./adminPortalUrl";

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
