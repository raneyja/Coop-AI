import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { stripSentryEvent } from "./sentrySink";

const require = createRequire(__filename);
const Sentry = require("@sentry/node") as typeof import("@sentry/node");

test("installed Sentry SDK envelope removes a credential retained in its derived module", async () => {
  const envelopes: unknown[] = [];
  Sentry.initWithoutDefaultIntegrations({
    dsn: "https://fixture@telemetry.invalid/1",
    environment: "test",
    sendDefaultPii: false,
    sendClientReports: false,
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    integrations: [],
    beforeSend: stripSentryEvent,
    transport: () => ({
      send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; },
      flush: async () => true
    })
  });

  try {
    const error = new Error("automatic failure");
    error.stack = "Error: automatic failure\n    at /srv/gho_fixturesecret-source.ts:3:5";
    const client = Sentry.getClient();
    assert.ok(client);
    const sdkEvent = await client.eventFromException(error);
    const frames = sdkEvent.exception?.values?.[0]?.stacktrace?.frames;
    assert.ok(frames?.some(frame => frame.module?.includes("gho_fixturesecret")), "SDK parsing must reproduce the credential-bearing derived module");
    assert.doesNotMatch(JSON.stringify(stripSentryEvent(sdkEvent)), /gho_fixturesecret/);
    Sentry.captureException(error);
    assert.equal(await Sentry.flush(1_000), true);
    const payload = JSON.stringify(envelopes);
    assert.ok(envelopes.length > 0, "the actual SDK must send an envelope to the in-memory transport");
    assert.doesNotMatch(payload, /gho_fixturesecret/, "no SDK-derived frame field may retain the fixture credential");
    assert.match(payload, /"lineno":3/);
    assert.match(payload, /"colno":5/);
  } finally {
    await Sentry.close(1_000);
  }
});
