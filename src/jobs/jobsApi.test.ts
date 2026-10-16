import assert from "node:assert/strict";
import test from "node:test";
import type { ServerResponse } from "node:http";
import type { JobQueueConfig } from "../config/jobQueueConfig";
import type { ServerConfig } from "../server/serverConfig";
import type { AuthContext } from "../server/orgStore";
import { JobQueue } from "./jobQueue";
import { JobMonitor } from "./monitoring";
import { handleJobsApiRequest, type JobsApiDeps } from "./jobsApi";
import { JobType } from "./types";
import type { WorkerPool } from "./workerPool";
import { MemoryQueueBackend } from "./backends/memoryBackend";
import { GraphCache } from "../cache/graphCache";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSync } from "esbuild";

const ORG_A = "org-a";
const ORG_B = "org-b";

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(code: number) {
      this.statusCode = code;
      return this;
    },
    end(payload?: string) {
      this.body = payload;
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

function productionConfig(): ServerConfig {
  return {
    nodeEnv: "production",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: false
  };
}

function queueConfig(): JobQueueConfig {
  return {
    backend: "memory",
    workerConcurrency: 1,
    maxJobDurationMs: 30_000,
    resultRetentionDays: 7,
    scheduledRetentionDays: 30,
    apiToken: "jobs-operator-token",
    queueDepthAlertThreshold: 50,
    failureRateAlertThreshold: 0.5,
    schedules: []
  };
}

function authFor(orgId: string, apiKeyId: string): AuthContext {
  return {
    orgId,
    orgName: orgId,
    plan: "pro",
    apiKeyId
  };
}

function depsFor(queue: JobQueue, monitor: JobMonitor): JobsApiDeps {
  return {
    queue,
    monitor,
    workers: { activeCount: 0 } as WorkerPool,
    config: queueConfig(),
    serverConfig: productionConfig(),
    orgStore: {
      resolveAuth: async (token: string) => {
        if (token === "key-a") return authFor(ORG_A, "key-a");
        if (token === "key-b") return authFor(ORG_B, "key-b");
        return undefined;
      },
      getOrganization: async (orgId: string) => ({
        id: orgId,
        name: orgId,
        plan: "pro" as const,
        repoAccessMode: "all_indexed" as const,
        createdAt: new Date()
      })
    } as JobsApiDeps["orgStore"]
  };
}

async function call(
  deps: JobsApiDeps,
  method: string,
  pathname: string,
  token: string | undefined,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const response = mockResponse();
  await handleJobsApiRequest(
    {
      method,
      pathname,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body
    },
    response,
    deps
  );
  const raw = response.body ?? "";
  let json: Record<string, unknown> = {};
  if (raw) {
    json = JSON.parse(raw) as Record<string, unknown>;
  }
  return { status: response.statusCode ?? 0, json, raw };
}

async function seedOrgJob(
  queue: JobQueue,
  orgId: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const submit = await queue.createJob({
    type: JobType.GENERATE_REPO_SUMMARY,
    params: { orgId, repoId: `github:${orgId}/secret-repo`, ...extra },
    userId: `apikey:${orgId}`
  });
  return submit.jobId;
}

test("org B cannot read org A's job", async () => {
  const queue = new JobQueue(queueConfig());
  const monitor = new JobMonitor({ queueDepthAlertThreshold: 50, failureRateAlertThreshold: 0.5 });
  const deps = depsFor(queue, monitor);
  const jobId = await seedOrgJob(queue, ORG_A);
  const denied = await call(deps, "GET", `/api/jobs/${jobId}`, "key-b");
  assert.equal(denied.status, 404);
  assert.equal(denied.raw.includes("secret-repo"), false);
  assert.equal(denied.raw.includes("params"), false);
  assert.equal(denied.raw.includes("result"), false);

  const allowed = await call(deps, "GET", `/api/jobs/${jobId}`, "key-a");
  assert.equal(allowed.status, 200);
  const params = allowed.json.params as Record<string, unknown>;
  assert.equal(params.orgId, ORG_A);
});

test("org B cannot read org A's job result", async () => {
  const queue = new JobQueue(queueConfig());
  const monitor = new JobMonitor({ queueDepthAlertThreshold: 50, failureRateAlertThreshold: 0.5 });
  const deps = depsFor(queue, monitor);
  const jobId = await seedOrgJob(queue, ORG_A, { marker: "result-secret" });
  const job = await queue.claimNext('test-result-worker', 30_000);
  assert.ok(job);
  assert.equal(job.id, jobId);
  await queue.completeJob(job, {repoId: "github:org-a/secret-repo", marker: "result-secret"});

  const denied = await call(deps, "GET", `/api/jobs/${jobId}/result`, "key-b");
  assert.equal(denied.status, 404);
  assert.equal(denied.raw.includes("result-secret"), false);

  const allowed = await call(deps, "GET", `/api/jobs/${jobId}/result`, "key-a");
  assert.equal(allowed.status, 200);
  const result = allowed.json.result as Record<string, unknown>;
  assert.equal(result.marker, "result-secret");
});

test("org B cannot stream org A's job", async () => {
  const queue = new JobQueue(queueConfig());
  const monitor = new JobMonitor({ queueDepthAlertThreshold: 50, failureRateAlertThreshold: 0.5 });
  const deps = depsFor(queue, monitor);
  const jobId = await seedOrgJob(queue, ORG_A);
  const denied = await call(deps, "GET", `/api/jobs/${jobId}/stream`, "key-b");
  assert.equal(denied.status, 404);
  assert.equal(denied.raw.includes("secret-repo"), false);
});

test("org B cannot cancel org A's job", async () => {
  const queue = new JobQueue(queueConfig());
  const monitor = new JobMonitor({ queueDepthAlertThreshold: 50, failureRateAlertThreshold: 0.5 });
  const deps = depsFor(queue, monitor);
  const jobId = await seedOrgJob(queue, ORG_A);
  const denied = await call(deps, "DELETE", `/api/jobs/${jobId}`, "key-b");
  assert.equal(denied.status, 404);
  const still = await queue.getJob(jobId);
  assert.equal(still?.status, "queued");

  const allowed = await call(deps, "DELETE", `/api/jobs/${jobId}`, "key-a");
  assert.equal(allowed.status, 200);
  const cancelled = await queue.getJob(jobId);
  assert.equal(cancelled?.status, "cancelled");
});

test("org B stats do not include org A's job id", async () => {
  const queue = new JobQueue(queueConfig());
  const monitor = new JobMonitor({ queueDepthAlertThreshold: 50, failureRateAlertThreshold: 0.5 });
  const deps = depsFor(queue, monitor);
  const jobId = await seedOrgJob(queue, ORG_A);
  const job = await queue.claimNext('test-failure-worker', 30_000);
  assert.ok(job);
  assert.equal(job.id, jobId);
  const failed = await queue.failJob(job, "clone failed github:org-a/secret-repo");
  assert.ok(failed);
  monitor.recordFailure(failed);

  const stats = await call(deps, "GET", "/api/jobs/stats", "key-b");
  assert.equal(stats.raw.includes(jobId), false);
  assert.equal(stats.raw.includes("secret-repo"), false);

  const operator = await call(deps, "GET", "/api/jobs/stats", "jobs-operator-token");
  assert.equal(operator.status, 200);
  assert.equal(operator.raw.includes(jobId), true);
});

test("create cannot stamp another org id", async () => {
  const queue = new JobQueue(queueConfig());
  const monitor = new JobMonitor({ queueDepthAlertThreshold: 50, failureRateAlertThreshold: 0.5 });
  const deps = depsFor(queue, monitor);
  const created = await call(deps, "POST", "/api/jobs", "key-a", {
    type: JobType.GENERATE_REPO_SUMMARY,
    params: { orgId: ORG_B, repoId: "github:org-b/stolen" }
  });
  assert.equal(created.status, 202);
  const jobId = String(created.json.jobId ?? "");
  assert.ok(jobId);

  const own = await call(deps, "GET", `/api/jobs/${jobId}`, "key-a");
  assert.equal(own.status, 200);
  const params = own.json.params as Record<string, unknown>;
  assert.equal(params.orgId, ORG_A);

  const foreign = await call(deps, "GET", `/api/jobs/${jobId}`, "key-b");
  assert.equal(foreign.status, 404);
});

test("expired memory attempt cannot renew, publish results/events or overwrite its reclaimed successor", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const backend = new MemoryQueueBackend();
  const queue = new JobQueue(queueConfig(), backend);
  const id = await seedOrgJob(queue, ORG_A);
  const old = await queue.claimNext("old-worker", 30_000);
  assert.ok(old);
  assert.equal(await queue.renew(old, 30_000), true);
  assert.equal(await queue.updateProgress(old, 25), true);
  const live = await queue.getJob(id);
  assert.ok(live);
  assert.equal(live.leaseExpiresAt?.getTime(), now + 30_000);
  // Advance the ownership clock; save intentionally preserves existing submissions.
  now = live.leaseExpiresAt.getTime() + 1;
  assert.equal((await backend.get(id))?.leaseExpiresAt?.getTime(), live.leaseExpiresAt.getTime());
  assert.ok(live.leaseExpiresAt.getTime() < Date.now());
  let events = 0;
  for (const name of ["job:update", "job:completed", "job:failed", "job:enqueued"]) queue.on(name, () => events++);
  assert.equal(await queue.renew(old, 30_000), false);
  assert.equal(await queue.updateProgress(old, 80), false);
  assert.equal(await queue.completeJob(old, { marker: "stale" }), undefined);
  assert.equal(await queue.failJob(old, "stale failure", { marker: "stale partial" }), undefined);
  await queue.requeue(old);
  assert.equal(events, 0);
  assert.equal(await queue.results.get(id), undefined);
  assert.equal((await queue.getJob(id))?.status, "running");
  assert.equal(await queue.reclaimExpired(2), 1);
  const successor = await queue.claimNext("new-worker", 30_000);
  assert.ok(successor);
  assert.notEqual(successor.attemptId, old.attemptId);
  const before = await queue.getJob(id);
  const beforeEvents = events;
  assert.equal(await queue.renew(old, 30_000), false);
  assert.equal(await queue.completeJob(old, { marker: "old overwrite" }), undefined);
  assert.equal(await queue.failJob(old, "old failure"), undefined);
  assert.equal(await queue.updateProgress(old, 99), false);
  await queue.requeue(old);
  assert.equal(events, beforeEvents);
  assert.deepEqual(await queue.getJob(id), before);
  assert.ok(await queue.completeJob(successor, { marker: "fresh" }));
  assert.deepEqual((await queue.results.get(id))?.result, { marker: "fresh" });
});

test("cancelled memory attempt cannot publish completion or results and following work remains claimable", async () => {
  const queue = new JobQueue(queueConfig());
  const id = await seedOrgJob(queue, ORG_A);
  const job = await queue.claimNext("worker", 30_000);
  assert.ok(job);
  let completed = 0;
  queue.on("job:completed", () => completed++);
  assert.equal((await queue.cancelJob(id, { includeRunning: true }))?.status, "cancelled");
  assert.equal(await queue.completeJob(job, { marker: "late" }), undefined);
  assert.equal(await queue.failJob(job, "late failure"), undefined);
  assert.equal(await queue.updateProgress(job, 100), false);
  assert.equal(await queue.results.get(id), undefined);
  assert.equal(completed, 0);
  assert.equal((await queue.getJob(id))?.status, "cancelled");
  const nextId = await seedOrgJob(queue, ORG_A);
  const next = await queue.claimNext("worker", 30_000);
  assert.equal(next?.id, nextId);
  assert.ok(next && await queue.completeJob(next, { marker: "next" }));
  assert.equal(completed, 1);
});

test("worker shutdown retains an abort-ignoring executor slot until physical settlement", async t => {
  const queue = new JobQueue(queueConfig());
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const running = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  let signal: AbortSignal | undefined;
  // Match the production worker bundle: direct CJS loading cannot import the
  // ESM-only SCIP dependency. All execution below uses the controlled executor.
  const parent = path.join(process.cwd(), "dist", "tests");
  fs.mkdirSync(parent, { recursive: true });
  const owned = fs.mkdtempSync(path.join(parent, "worker-memory-control-"));
  let cleanupWorker: WorkerPool | undefined;
  t.after(async () => {
    release();
    try { if (cleanupWorker) assert.equal(await cleanupWorker.stop(1_000), true); }
    finally { fs.rmSync(owned, { recursive: true, force: true }); }
  });
  const bundle = path.join(owned, "worker.cjs");
  buildSync({ entryPoints: [require.resolve("./workerPool")], outfile: bundle,
    bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    external: ["vscode", "pg", "@sentry/node", "node-cron", "web-tree-sitter", "tree-sitter-wasms"] });
  const { WorkerPool: BundledWorkerPool } = require(bundle) as { WorkerPool: typeof import("./workerPool").WorkerPool };
  const worker = new BundledWorkerPool(queue, {
    concurrency: 1, maxJobDurationMs: 2_000, leaseDurationMs: 500,
    heartbeatIntervalMs: 50, shutdownTimeoutMs: 50, retryPolicy: { maxRetries: 1, backoffMs: 1 }
  }, { cache: new GraphCache() }, undefined, async (_job, _context, _report, currentSignal) => {
    calls++; signal = currentSignal; entered(); await held; return { marker: "late executor" };
  });
  cleanupWorker = worker;
  await seedOrgJob(queue, ORG_A);
  const following = await seedOrgJob(queue, ORG_A);
  worker.start(5);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([running, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Worker did not enter the controlled executor")), 1_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
  assert.equal(await worker.stop(5), false);
  assert.equal(signal?.aborted, true);
  assert.equal(worker.activeCount, 1);
  worker.start(5);
  assert.equal(worker.acceptingWork, false);
  assert.equal(calls, 1);
  assert.equal((await queue.getJob(following))?.status, "queued");
  release();
  assert.equal(await worker.stop(1_000), true);
  assert.equal(worker.activeCount, 0);
  assert.equal(calls, 1);
  assert.equal((await queue.getJob(following))?.status, "queued");
});
