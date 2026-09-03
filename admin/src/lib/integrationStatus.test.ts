/**
 * Run: cd admin && npx tsx --tsconfig tsconfig.json src/lib/integrationStatus.test.ts
 */
import assert from "node:assert/strict";
import { integrationIsConnected, integrationStatusLabel, type IntegrationStatus } from "./integrations";

function status(partial: Partial<IntegrationStatus>): IntegrationStatus {
  return {
    provider: "google-docs",
    installed: false,
    ...partial
  };
}

assert.equal(integrationIsConnected(undefined), false);
assert.equal(integrationIsConnected(status({ installed: true })), true);
assert.equal(
  integrationIsConnected(status({ installed: true, needsReconnect: true })),
  false,
  "stored credentials that need reconnect are not connected"
);
assert.equal(integrationIsConnected(status({ installed: false })), false);

assert.equal(integrationStatusLabel(undefined), "Available");
assert.equal(integrationStatusLabel(status({ installed: true })), "Connected");
assert.equal(
  integrationStatusLabel(status({ installed: true, needsReconnect: true })),
  "Reconnect required"
);
assert.equal(integrationStatusLabel(status({ installed: false })), "Available");

console.log("integrationStatus: passed");
