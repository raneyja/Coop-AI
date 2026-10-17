import { redactSecretsFromErrorMessage } from "../../jobs/errorHandling";
import { createSentrySink } from "./sentrySink";

export type ErrorReporterService = "api" | "worker";

export type ErrorReportContext = {
  service?: ErrorReporterService;
  requestId?: string;
  orgId?: string;
  route?: string;
  jobId?: string;
  attemptId?: string;
  jobType?: string;
};

export type ErrorSink = (error: Error, context: ErrorReportContext) => void;

let sink: ErrorSink | undefined;
let defaultService: ErrorReporterService = "api";
let initialized = false;

export function initErrorReporter(options: {
  env?: NodeJS.ProcessEnv;
  service: ErrorReporterService;
  sink?: ErrorSink;
} = { service: "api" }): boolean {
  const env = options.env ?? process.env;
  defaultService = options.service;

  if (initialized && !options.sink) {
    return sink !== undefined;
  }
  initialized = true;

  if (options.sink) {
    sink = options.sink;
    return true;
  }

  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    sink = undefined;
    return false;
  }

  sink = createSentrySink({
    dsn,
    service: options.service,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || "development",
    release: readReleaseSha(env)
  });
  return true;
}

export function captureException(error: unknown, context: ErrorReportContext = {}): void {
  try {
    if (shouldIgnore(error)) {
      return;
    }
    const reportable = toReportableError(error);
    const tags = sanitizeErrorContext({
      ...context,
      service: context.service ?? defaultService
    });
    sink?.(reportable, tags);
  } catch {
    // Inspection, redaction, context sanitization, and sink failures must never
    // break the request or job. Unsafe reports are dropped rather than sent raw.
  }
}

export function reportServerError(
  error: unknown,
  context: ErrorReportContext
): { error: string; requestId?: string } {
  captureException(error, context);
  let message = "unexpected server error";
  try {
    if (error instanceof Error && typeof error.message === "string") {
      message = redactSecretsFromErrorMessage(error.message);
    }
  } catch {
    // Keep the existing generic client response if error inspection/redaction fails.
  }
  return context.requestId ? { error: message, requestId: context.requestId } : { error: message };
}

export function resetErrorReporterForTests(): void {
  initialized = false;
  sink = undefined;
  defaultService = "api";
}

export function sanitizeErrorContext(context: ErrorReportContext): ErrorReportContext {
  const attemptId = asTag(context.attemptId);
  return {
    service: context.service,
    requestId: asTag(context.requestId),
    orgId: asTag(context.orgId),
    route: asTag(context.route),
    jobId: asTag(context.jobId),
    ...(attemptId ? { attemptId } : {}),
    jobType: asTag(context.jobType)
  };
}

function toReportableError(error: unknown): Error {
  if (error instanceof Error) {
    const redacted = redactSecretsFromErrorMessage(error.message);
    const stack = error.stack === undefined ? undefined : redactSecretsFromErrorMessage(error.stack);
    if (redacted === error.message && stack === error.stack) {
      return error;
    }
    const copy = new Error(redacted);
    copy.name = error.name;
    copy.stack = stack;
    return copy;
  }
  return new Error(redactSecretsFromErrorMessage(String(error)));
}

function shouldIgnore(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError") {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes("job cancelled") || message === "request cancelled.";
}

function asTag(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 200) {
    return undefined;
  }
  return trimmed;
}

function readReleaseSha(env: NodeJS.ProcessEnv): string | undefined {
  const raw =
    env.COOP_BUILD_SHA ?? env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? "";
  const sha = raw.trim().slice(0, 12);
  return sha || undefined;
}
