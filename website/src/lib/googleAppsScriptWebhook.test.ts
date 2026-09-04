import assert from "node:assert/strict";
import { postToGoogleAppsScript } from "./googleAppsScriptWebhook";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

type MockCall = {
  url: string;
  method: string;
  hasBody: boolean;
};

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function htmlResponse(status: number, headers?: Record<string, string>): Response {
  return new Response("<!DOCTYPE html><html>nope</html>", {
    status,
    headers: { "Content-Type": "text/html", ...headers }
  });
}

async function main(): Promise<void> {
  await test("follows GAS 302 with GET and treats { ok: true } as success", async () => {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, hasBody: Boolean(init?.body) });
    if (method === "POST" && url === "https://script.google.com/macros/s/abc/exec") {
      return htmlResponse(302, {
        location: "https://script.googleusercontent.com/macros/echo?user_content_key=xyz"
      });
    }
    if (method === "GET" && url.includes("googleusercontent.com")) {
      return jsonResponse(200, { ok: true, lastRow: 12 });
    }
    return htmlResponse(405);
  };

  const result = await postToGoogleAppsScript(
    "https://script.google.com/macros/s/abc/exec",
    { type: "demo", email: "lead@example.com" },
    fetchImpl
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.hasBody, true);
  assert.equal(calls[1]?.method, "GET");
  assert.equal(calls[1]?.hasBody, false);
  assert.equal(result.ok, true);
  assert.equal(result.parsed?.lastRow, 12);
});

await test("echo 405 is a failed save", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      return htmlResponse(302, { location: "https://script.googleusercontent.com/macros/echo?k=1" });
    }
    return htmlResponse(405);
  };
  const result = await postToGoogleAppsScript("https://script.google.com/macros/s/abc/exec", {}, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.status, 405);
});

await test("direct 200 JSON still succeeds", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(200, { ok: true, lastRow: 3 });
  const result = await postToGoogleAppsScript("https://script.google.com/macros/s/abc/exec", {}, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.parsed?.lastRow, 3);
});

await test("302 without Location fails closed", async () => {
  const fetchImpl: typeof fetch = async () => htmlResponse(302);
  const result = await postToGoogleAppsScript("https://script.google.com/macros/s/abc/exec", {}, fetchImpl);
  assert.equal(result.ok, false);
  assert.match(result.text, /Redirect without Location/);
});

await test("resolves relative redirect Location against the web app URL", async () => {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      hasBody: Boolean(init?.body)
    });
    if (calls.length === 1) {
      return htmlResponse(302, { location: "/macros/echo?k=1" });
    }
    return jsonResponse(200, { ok: true, lastRow: 8 });
  };
  const result = await postToGoogleAppsScript(
    "https://script.google.com/macros/s/abc/exec",
    {},
    fetchImpl
  );
  assert.equal(result.ok, true);
  assert.equal(calls[1]?.url, "https://script.google.com/macros/echo?k=1");
});

  console.log(`\ngoogleAppsScriptWebhook: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
