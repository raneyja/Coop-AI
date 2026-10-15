import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "./route";

test("an unavailable form webhook does not write submitted private text to logs", async () => {
  const previousWebhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const previousWarn = console.warn;
  const logged: unknown[][] = [];
  delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  console.warn = (...args) => { logged.push(args); };

  try {
    const response = await POST(new NextRequest("https://coop-ai.dev/api/submit", {
      method: "POST",
      body: JSON.stringify({
        type: "demo",
        email: "founder@example.com",
        message: "private\nforged log entry"
      })
    }));

    assert.equal(response.status, 503);
    assert.equal(logged.length, 1);
    assert.doesNotMatch(JSON.stringify(logged), /founder@example\.com|private|forged log entry/);
  } finally {
    console.warn = previousWarn;
    if (previousWebhook === undefined) delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    else process.env.GOOGLE_SHEETS_WEBHOOK_URL = previousWebhook;
  }
});
