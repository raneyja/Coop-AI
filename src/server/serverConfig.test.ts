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

test("production rejects noncanonical or wrong-length encryption key encodings", () => {
  for (const value of ["change-me-to-a-long-random-secret", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Zm9v", "00".repeat(32)]) {
    assert.throws(
      () => loadServerConfig({ NODE_ENV: "production", CREDENTIALS_ENCRYPTION_KEY: value }),
      /canonical base64 encoding of a 32-byte key/
    );
  }
  const fixtureKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString("base64");
  assert.equal(
    loadServerConfig({ NODE_ENV: "production", CREDENTIALS_ENCRYPTION_KEY: fixtureKey }).credentialsEncryptionKey,
    fixtureKey
  );
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

test("auth trusts no proxy unless exact addresses are configured", () => {
  assert.deepEqual(loadServerConfig({ NODE_ENV: "production" }).trustedAuthProxyAddresses, []);
  assert.deepEqual(loadServerConfig({ COOP_AUTH_TRUSTED_PROXY_IPS: "127.0.0.1, ::1,127.0.0.1" }).trustedAuthProxyAddresses, ["127.0.0.1", "::1"]);
  for (const value of ["*", "127.0.0.1/8", "localhost", "127.0.0.1,", "127.0.0.1:not-a-port"]) {
    assert.throws(() => loadServerConfig({ COOP_AUTH_TRUSTED_PROXY_IPS: value }), /exact IP/);
  }
  assert.throws(() => loadServerConfig({ COOP_AUTH_TRUSTED_PROXY_IPS: Array(33).fill("127.0.0.1").join(",") }), /at most 32/);
});
