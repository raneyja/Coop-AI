import type { IncomingMessage, ServerResponse } from "node:http";
import type { JobQueueConfig } from "../config/jobQueueConfig";
import type { JobQueue } from "./jobQueue";
import type { JobMonitor } from "./monitoring";
import { JobRateLimitError } from "./jobQueue";
import { JobType, formatWaitTime, serializeJob } from "./types";
import type { WorkerPool } from "./workerPool";

import type { AuthContext, OrgStore } from "../server/orgStore";
import type { ServerConfig } from "../server/serverConfig";
import {
  authUserId,
  extractBearerToken,
  requireAuth,
  requireOrgPlan,
  resolveAuthContext
} from "../server/authMiddleware";
import { AuditLogger, auditActor } from "../server/audit/auditLogger";
import type { UserStore } from "../server/users/userStore";
import type { Job } from "./types";

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

/** Real org customer (API key or session). Legacy/dev bearers are not customers. */
type JobsCaller =
  | { kind: "org"; auth: AuthContext }
  | { kind: "jobs-token" }
  | { kind: "dev-open"; auth?: AuthContext };

export async function handleJobsApiRequest(
  parsed: ParsedJobsRequest,
  response: ServerResponse,
  deps: JobsApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/api/jobs")) {
    return false;
  }

  const caller = await resolveJobsCaller(parsed.headers, deps);
  if (!caller) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/api/jobs/stats") {
    // Customer tokens must not see other orgs' job ids or error strings.
    // The jobs API token (COOP_JOBS_API_TOKEN / COOP_API_TOKEN) keeps the operator dashboard.
    if (caller.kind === "org") {
      writeJson(response, 404, { error: "not found" });
      return true;
    }
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
    await handleCreateJob(parsed, response, deps, caller);
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
    await handleGetResult(jobId, response, deps, caller);
    return true;
  }

  if (parsed.method === "GET" && action === "stream") {
    await handleJobStream(jobId, response, deps, caller);
    return true;
  }

  if (parsed.method === "GET" && !action) {
    await handleGetJob(jobId, response, deps, caller);
    return true;
  }

  if (parsed.method === "DELETE" && !action) {
    await handleCancelJob(jobId, response, deps, caller);
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
}

async function handleCreateJob(
  parsed: ParsedJobsRequest,
  response: ServerResponse,
  deps: JobsApiDeps,
  caller: JobsCaller
): Promise<void> {
  const body = asRecord(parsed.body);
  const type = String(body.type ?? "");
  if (!JOB_TYPE_SET.has(type as JobType)) {
    writeJson(response, 400, { error: "invalid job type" });
    return;
  }

  const auth = callerAuth(caller);

  try {
    if (type === JobType.INDEX_REPOSITORY) {
      if (!auth) {
        writeJson(response, 403, { error: "plan_required", message: "INDEX_REPOSITORY requires organization API key auth" });
        return;
      }
      if (!(await requireOrgPlan(deps.orgStore, auth, response, "free", "pro", "enterprise"))) {
        return;
      }
    }
    const params = asRecord(body.params);
    stampCallerOrgId(caller, params);
    const submit = await deps.queue.createJob({
      type: type as JobType,
      priority: readPriority(body.priority),
      params,
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
  deps: JobsApiDeps,
  caller: JobsCaller
): Promise<void> {
  const job = await loadVisibleJob(jobId, deps, caller);
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
  deps: JobsApiDeps,
  caller: JobsCaller
): Promise<void> {
  const job = await loadVisibleJob(jobId, deps, caller);
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
  deps: JobsApiDeps,
  caller: JobsCaller
): Promise<void> {
  const job = await loadVisibleJob(jobId, deps, caller);
  if (!job) {
    writeJson(response, 404, { error: "job not found" });
    return;
  }
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
  deps: JobsApiDeps,
  caller: JobsCaller
): Promise<void> {
  const job = await loadVisibleJob(jobId, deps, caller);
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

function callerAuth(caller: JobsCaller): AuthContext | undefined {
  if (caller.kind === "jobs-token") {
    return undefined;
  }
  return caller.auth;
}

function isCustomerOrg(auth: AuthContext): boolean {
  return auth.orgId !== "legacy" && auth.apiKeyId !== "legacy" && auth.apiKeyId !== "legacy-dev";
}

function productionClosed(deps: JobsApiDeps): boolean {
  if (deps.serverConfig?.requireApiAuth) {
    return true;
  }
  const nodeEnv = deps.serverConfig?.nodeEnv ?? process.env.NODE_ENV ?? "development";
  return nodeEnv === "production";
}

function jobOrgId(job: Job): string | undefined {
  const value = job.params.orgId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function callerCanAccessJob(caller: JobsCaller, job: Job, deps: JobsApiDeps): boolean {
  if (caller.kind === "jobs-token" || caller.kind === "dev-open") {
    return true;
  }
  const orgId = jobOrgId(job);
  if (!orgId) {
    return !productionClosed(deps);
  }
  return orgId === caller.auth.orgId;
}

async function loadVisibleJob(
  jobId: string,
  deps: JobsApiDeps,
  caller: JobsCaller
): Promise<Job | undefined> {
  const job = await deps.queue.getJob(jobId);
  if (!job || !callerCanAccessJob(caller, job, deps)) {
    return undefined;
  }
  return job;
}

function stampCallerOrgId(caller: JobsCaller, params: Record<string, unknown>): void {
  if (caller.kind === "org") {
    params.orgId = caller.auth.orgId;
    return;
  }
  if (caller.kind === "dev-open" && caller.auth?.orgId) {
    params.orgId = caller.auth.orgId;
  }
}

async function resolveJobsCaller(
  headers: Record<string, string | undefined>,
  deps: JobsApiDeps
): Promise<JobsCaller | undefined> {
  const requireApiAuth = deps.serverConfig?.requireApiAuth ?? false;
  const auth = await resolveAuthContext(
    headers,
    deps.orgStore,
    deps.serverConfig?.legacyApiToken,
    requireApiAuth,
    deps.userStore
  );
  const token = extractBearerToken(headers);
  const jobsToken = deps.config.apiToken;
  const presentedJobsToken = Boolean(jobsToken && token === jobsToken);

  if (auth && isCustomerOrg(auth)) {
    return requireAuth(auth, requireApiAuth) ? { kind: "org", auth } : undefined;
  }

  // Operator jobs token. In non-production, resolveAuthContext already maps that
  // bearer to a legacy dev context — keep that path so local creates stay unchanged.
  const legacyDevAuth = Boolean(auth && !isCustomerOrg(auth) && !productionClosed(deps));
  if (presentedJobsToken && !legacyDevAuth) {
    return { kind: "jobs-token" };
  }

  if (!requireAuth(auth, requireApiAuth)) {
    return undefined;
  }

  return { kind: "dev-open", auth };
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
