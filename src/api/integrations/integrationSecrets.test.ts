import assert from "node:assert/strict";
import test from "node:test";
import { IntegrationSecrets } from "./integrationSecrets";
import type { IntegrationProxy } from "./integrationOperations";

function secrets() {
  return new IntegrationSecrets({ get: async () => "synthetic-local-token" } as never);
}
test("organization mode returns only the authenticated proxy, never local credentials", async () => {
  const store = secrets();
  const proxy: IntegrationProxy = async () => undefined as never;
  store.setCloudFetcher(async () => ({ proxy }));
  assert.deepEqual(await store.getCredentials(), { proxy });
});
test("cloud authorization failure cannot fall back to local credentials", async () => {
  const store = secrets();
  store.setCloudFetcher(async () => { throw new Error("denied"); });
  await assert.rejects(store.getCredentials(), /denied/);
});
test("signed-out explicitly local configuration remains available", async () => {
  const store = secrets();
  store.setCloudFetcher(async () => undefined);
  assert.equal((await store.getCredentials()).slackToken, "synthetic-local-token");
});
