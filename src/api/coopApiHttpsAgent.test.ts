import test from "node:test";
import assert from "node:assert/strict";
import { createCoopApiLookup, isCoopApiHostname } from "./coopApiHttpsAgent";

test("limits the DNS fallback to Coop's production API", () => {
  assert.equal(isCoopApiHostname("api.coop-ai.dev"), true);
  assert.equal(isCoopApiHostname("API.COOP-AI.DEV."), true);
  assert.equal(isCoopApiHostname("admin.coop-ai.dev"), false);
  assert.equal(isCoopApiHostname("customer.example.com"), false);
});

test("uses reliable DNS first for Coop's production API", async () => {
  let systemLookupCalls = 0;
  const lookup = createCoopApiLookup({
    systemLookup: (_hostname, _options, callback) => {
      systemLookupCalls += 1;
      callback(Object.assign(new Error("router DNS failed"), { code: "EAI_AGAIN" }), "");
    },
    resolveCoopIpv4: async () => ["203.0.113.10"]
  });

  const result = await new Promise<{ address: string; family?: number }>((resolve, reject) => {
    lookup("api.coop-ai.dev", { all: false }, (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ address: address as string, family });
    });
  });

  assert.deepEqual(result, { address: "203.0.113.10", family: 4 });
  assert.equal(systemLookupCalls, 0);
});

test("leaves non-Coop hostnames on the system resolver", async () => {
  let fallbackCalls = 0;
  const lookup = createCoopApiLookup({
    systemLookup: (_hostname, _options, callback) => callback(null, "192.0.2.20", 4),
    resolveCoopIpv4: async () => {
      fallbackCalls += 1;
      return ["203.0.113.10"];
    }
  });

  const address = await new Promise<string>((resolve, reject) => {
    lookup("customer.example.com", { all: false }, (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(value as string);
    });
  });

  assert.equal(address, "192.0.2.20");
  assert.equal(fallbackCalls, 0);
});
