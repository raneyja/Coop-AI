import type { IncomingMessage, ServerResponse } from "node:http";
import type { JobQueueConfig } from "../config/jobQueueConfig";
import type { JobQueue } from "./jobQueue";
import type { JobMonitor } from "./monitoring";
import { JobRateLimitError } from "./jobQueue";
import { JobType, formatWaitTime, serializeJob } from "./types";
import type { WorkerPool } from "./workerPool";

import type { OrgStore } from "../server/orgStore";
import type { ServerConfig } from "../server/serverConfig";
import { authUserId, requireAuth, requireOrgPlan, resolveAuthContext } from "../server/authMiddleware";
import { AuditLogger, auditActor } from "../server/audit/auditLogger";
import type { UserStore } from "../server/users/userStore";

export type JobsApiDeps = {
  queue: JobQueue;
  monitor: JobMonitor;
  workers: WorkerPool;
  config: JobQueueConfig;
  orgStore?: OrgStore;
  serverConfig?: ServerConfig;
  auditLogger?: AuditLogger;
  userStore?: UserStore;
};

type ParsedJobsRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string | undefined>;
  body: unknown;
};

const JOB_TYPE_SET = new Set(Object.values(JobType));

export async function handleJobsApiRequest(
  parsed: ParsedJobsRequest,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/api/jobs")) {
    return false;
  }

  if (!(await authorize(parsed.headers, deps))) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/api/jobs/stats") {
    const stats = deps.monitor.getStats(deps.queue);
    writeJson(response, 200, {
      ...stats,
      workers: {
        concurrency: deps.config.workerConcurrency,
        active: deps.workers.activeCount
      },
      recentFailures: deps.monitor.recentFailures(10)
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/api/jobs") {
    await handleCreateJob(parsed, response, deps);
    return true;
  }

  const match = parsed.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(result|stream))?$/);
  if (!match) {
    writeJson(response, 404, { error: "not found" });
    return true;
  }

  const jobId = decodeURIComponent(match[1]);
  const action = match[2];

  if (parsed.method === "GET" && action === "result") {
    await handleGetResult(jobId, response, deps);
    return true;
  }

  if (parsed.method === "GET" && action === "stream") {
    await handleJobStream(jobId, response, deps);
    return true;
  }

  if (parsed.method === "GET" && !action) {
    await handleGetJob(jobId, response, deps);
    return true;
  }

  if (parsed.method === "DELETE" && !action) {
    await handleCancelJob(jobId, response, deps);
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
}

async function handleCreateJob(
  parsed: ParsedJobsRequest,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<void> {
  const body = asRecord(parsed.body);
  const type = String(body.type ?? "");
  if (!JOB_TYPE_SET.has(type as JobType)) {
    writeJson(response, 400, { error: "invalid job type" });
    return;
  }

  try {
    const auth = await resolveAuthContext(
      parsed.headers,
      deps.orgStore,
      deps.serverConfig?.legacyApiToken,
      deps.serverConfig?.requireApiAuth ?? false,
      deps.userStore
    );
    if (type === JobType.INDEX_REPOSITORY) {
      if (!auth) {
        writeJson(response, 403, { error: "plan_required", message: "INDEX_REPOSITORY requires organization API key auth" });
        return;
      }
      if (!(await requireOrgPlan(deps.orgStore, auth, response, "pro", "enterprise"))) {
        return;
      }
    }
    const submit = await deps.queue.createJob({
      type: type as JobType,
      priority: readPriority(body.priority),
      params: asRecord(body.params),
      userId: auth ? authUserId(auth) : body.userId ? String(body.userId) : undefined,
      estimatedDurationMs: body.estimatedDurationMs ? Number(body.estimatedDurationMs) : undefined,
      scheduled: Boolean(body.scheduled)
    });
    const actor = auth ? auditActor(auth) : { userId: undefined, principal: "anonymous" };
    await deps.auditLogger?.record({
      orgId: auth?.orgId ?? "dev",
      userId: actor.userId,
      principal: actor.principal,
      action: "job.create",
      metadata: { jobId: submit.jobId, type }
    });
    writeJson(response, 202, submit);
  } catch (error) {
    if (error instanceof JobRateLimitError) {
      writeJson(response, 429, {
        error: error.message,
        retryAfterMs: error.retryAfterMs,
        retryAfter: formatWaitTime(error.retryAfterMs)
      });
      return;
    }
    const message = error instanceof Error ? error.message : "failed to create job";
    writeJson(response, 400, { error: message });
  }
}

async function handleGetJob(
  jobId: string,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<void> {
  const job = await deps.queue.getJob(jobId);
  if (!job) {
    writeJson(response, 404, { error: "job not found" });
    return;
  }
  const etaMs =
    job.status === "running" && job.startedAt
      ? Math.max(0, job.estimatedDurationMs - (Date.now() - job.startedAt.getTime()))
      : job.status === "queued"
        ? job.estimatedDurationMs
        : 0;
  writeJson(response, 200, {
    ...serializeJob(job),
    estimatedTimeRemaining: formatWaitTime(etaMs),
    etaMs
  });
}

async function handleGetResult(
  jobId: string,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<void> {
  const job = await deps.queue.getJob(jobId);
  if (!job) {
    writeJson(response, 404, { error: "job not found" });
    return;
  }
  if (job.status !== "completed" && job.status !== "partial") {
    writeJson(response, 409, { status: job.status, error: "job not completed" });
    return;
  }

  const stored = await deps.queue.results.get(jobId);
  writeJson(response, 200, {
    status: job.status,
    result: stored?.result ?? job.result,
    generatedAt: (job.completedAt ?? job.createdAt).toISOString(),
    expiresAt: stored?.expiresAt.toISOString(),
    accessCount: stored?.accessCount ?? 0
  });
}

async function handleCancelJob(
  jobId: string,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<void> {
  const cancelled = await deps.queue.cancelJob(jobId);
  if (!cancelled) {
    writeJson(response, 409, { error: "job cannot be cancelled (already running or finished)" });
    return;
  }
  writeJson(response, 200, serializeJob(cancelled));
}

async function handleJobStream(
  jobId: string,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<void> {
  const job = await deps.queue.getJob(jobId);
  if (!job) {
    writeJson(response, 404, { error: "job not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const send = (payload: unknown) => {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ jobId, status: job.status, progress: job.progress });

  const onUpdate = (event: { jobId: string }) => {
    if (event.jobId !== jobId) {
      return;
    }
    void deps.queue.getJob(jobId).then((current) => {
      if (!current) {
        return;
      }
      send({
        jobId: current.id,
        status: current.status,
        progress: current.progress,
        message: current.error
      });
      if (current.status === "completed" || current.status === "failed" || current.status === "partial") {
        cleanup();
        response.end();
      }
    });
  };

  const cleanup = () => {
    deps.queue.off("job:update", onUpdate);
    deps.queue.off("job:completed", onUpdate);
    deps.queue.off("job:failed", onUpdate);
  };

  deps.queue.on("job:update", onUpdate);
  deps.queue.on("job:completed", onUpdate);
  deps.queue.on("job:failed", onUpdate);

  const request = response as ServerResponse & { req?: IncomingMessage };
  request.req?.on("close", cleanup);
}

async function authorize(headers: Record<string, string | undefined>, deps: JobsApiDeps): Promise<boolean> {
  const auth = await resolveAuthContext(
    headers,
    deps.orgStore,
    deps.serverConfig?.legacyApiToken,
    deps.serverConfig?.requireApiAuth ?? false,
    deps.userStore
  );
  if (requireAuth(auth, deps.serverConfig?.requireApiAuth ?? false)) {
    return true;
  }
  if (!deps.config.apiToken) {
    return !(deps.serverConfig?.requireApiAuth ?? false);
  }
  const header = headers.authorization ?? "";
  return header === `Bearer ${deps.config.apiToken}`;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, (_key, value) => (value instanceof Date ? value.toISOString() : value)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readPriority(value: unknown): "high" | "normal" | "low" {
  if (value === "high" || value === "low") {
    return value;
  }
  return "normal";
}
