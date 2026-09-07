import assert from "node:assert/strict";
import test from "node:test";
import { loadServerConfig } from "./serverConfig";

test("production ignores COOP_REQUIRE_API_AUTH=false", () => {
  const config = loadServerConfig({
    NODE_ENV: "production",
    COOP_REQUIRE_API_AUTH: "false"
  });
  assert.equal(config.requireApiAuth, true);
});

test("production defaults API auth on", () => {
  const config = loadServerConfig({ NODE_ENV: "production" });
  assert.equal(config.requireApiAuth, true);
});

test("development honors COOP_REQUIRE_API_AUTH=false", () => {
  const config = loadServerConfig({
    NODE_ENV: "development",
    COOP_REQUIRE_API_AUTH: "false"
  });
  assert.equal(config.requireApiAuth, false);
});

test("development defaults API auth off", () => {
  const config = loadServerConfig({ NODE_ENV: "development" });
  assert.equal(config.requireApiAuth, false);
});
