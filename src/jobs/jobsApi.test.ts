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
  const job = await queue.getJob(jobId);
  assert.ok(job);
  job.status = "completed";
  job.result = { repoId: "github:org-a/secret-repo", marker: "result-secret" };
  job.completedAt = new Date();
  await queue.getBackend().update(job);
  await queue.results.store(jobId, job.result);

  const denied = await call(deps, "GET", `/api/jobs/${jobId}/result`, "key-b");
  assert.equal(denied.status, 404);
  assert.equal(denied.raw.includes("result-secret"), false);

  const allowed = await call(deps, "GET", `/api/jobs/${jobId}/result`, "key-a");
  assert.equal(allowed.status, 200);
  const result = allowed.json.result as Record<string, unknown>;
  assert.equal(result.marker, "result-secret");
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
  const job = await queue.getJob(jobId);
  assert.ok(job);
  job.status = "failed";
  job.error = "clone failed github:org-a/secret-repo";
  await queue.getBackend().update(job);
  monitor.recordFailure(job);

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
