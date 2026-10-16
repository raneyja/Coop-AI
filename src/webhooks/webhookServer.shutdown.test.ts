import assert from "node:assert/strict";
import test from "node:test";
import { createServer, get, type Server, type ServerResponse } from "node:http";
import { setImmediate } from "node:timers/promises";
import { buildSync } from "esbuild";
import type { WebhookServerRuntime } from "./webhookServer";
import { loadJobQueueConfig } from "../config/jobQueueConfig";

// Exercise the same bundled dependency boundary as the actual API entrypoint.
buildSync({ stdin: { contents: 'export { stopWebhookServer } from "./src/webhooks/webhookServer"; export { createJobRuntime } from "./src/jobs/jobRuntime"; export { GraphCache } from "./src/cache/graphCache";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", external: ["@sentry/node", "node-cron", "web-tree-sitter", "tree-sitter-wasms"], outfile: "dist/tests/webhook-shutdown.cjs" });
const main = require("../../dist/tests/webhook-shutdown.cjs") as {
  stopWebhookServer: typeof import("./webhookServer").stopWebhookServer;
  createJobRuntime: typeof import("../jobs/jobRuntime").createJobRuntime;
  GraphCache: typeof import("../cache/graphCache").GraphCache;
};

class SpyCache extends main.GraphCache {
  public closes = 0;
  public fail = false;
  public override async close(): Promise<void> {
    this.closes++;
    if (this.fail) throw new Error("Synthetic persistence failure");
    await super.close();
  }
}

function fixture(server: Server, timeout = 1000) {
  const cache = new SpyCache();
  const jobs = main.createJobRuntime({ cache, config: loadJobQueueConfig({ JOBS_SHUTDOWN_TIMEOUT_MS: String(timeout) }) });
  const runtime: Pick<WebhookServerRuntime, "server" | "jobs" | "jobStartup"> = { server, jobs };
  return { runtime, cache };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function request(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve(body));
      response.on("error", reject);
    }).on("error", reject);
  });
}

test("admitted HTTP work finishes before persistence closes; repeated shutdown drains once", async () => {
  let respond!: ServerResponse;
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  const server = createServer((_request, response) => { respond = response; admitted(); });
  const { runtime, cache } = fixture(server);
  const url = await listen(server);
  const response = request(url);
  await started;
  const shutdown = main.stopWebhookServer(runtime);
  assert.equal(main.stopWebhookServer(runtime), shutdown);
  await setImmediate();
  assert.equal(server.listening, false);
  assert.equal(cache.closes, 0);
  await assert.rejects(request(url));
  respond.end("admitted write completed");
  assert.equal(await response, "admitted write completed");
  assert.equal(await shutdown, true);
  assert.equal(cache.closes, 1);
});

test("a stalled HTTP request cannot report a clean shutdown or prematurely close persistence", async () => {
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  const server = createServer(() => admitted());
  const { runtime, cache } = fixture(server, 40);
  const response = request(await listen(server));
  void response.catch(() => undefined);
  await started;
  assert.equal(await main.stopWebhookServer(runtime), false);
  await assert.rejects(response);
  assert.equal(cache.closes, 0);
  await cache.close();
});

test("an undrained worker does not close persistence or masquerade as a clean exit", async () => {
  const { runtime, cache } = fixture(createServer());
  runtime.jobs.workers.stop = async () => false;
  assert.equal(await main.stopWebhookServer(runtime), false);
  assert.equal(cache.closes, 0);
  await cache.close();
});

test("cache persistence failure remains failed and repeated shutdown does not retry it", async () => {
  const { runtime, cache } = fixture(createServer());
  cache.fail = true;
  const shutdown = main.stopWebhookServer(runtime);
  assert.equal(await shutdown, false);
  assert.equal(main.stopWebhookServer(runtime), shutdown);
  assert.equal(cache.closes, 1);
  cache.fail = false;
  await cache.close();
});

test("queue backend closure failure cannot report clean shutdown", async () => {
  const { runtime, cache } = fixture(createServer());
  Object.assign(runtime.jobs.queue.getBackend(), { close: async () => { throw new Error("Synthetic backend closure failure"); } });
  assert.equal(await main.stopWebhookServer(runtime), false);
  assert.equal(cache.closes, 1);
});

test("shutdown waits for admitted startup before stopping its workers and cache", async () => {
  const { runtime, cache } = fixture(createServer());
  let started!: () => void;
  runtime.jobStartup = new Promise<void>(resolve => { started = resolve; });
  const shutdown = main.stopWebhookServer(runtime);
  await setImmediate();
  assert.equal(cache.closes, 0);
  started();
  assert.equal(await shutdown, true);
  assert.equal(cache.closes, 1);
});

test("stalled startup is bounded and cannot resume persistence closure after a failed drain", async () => {
  const { runtime, cache } = fixture(createServer(), 40);
  let started!: () => void;
  runtime.jobStartup = new Promise<void>(resolve => { started = resolve; });
  assert.equal(await main.stopWebhookServer(runtime), false);
  started();
  await setImmediate();
  assert.equal(cache.closes, 0);
  await cache.close();
});
