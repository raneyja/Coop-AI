import { createRequire } from "node:module";
import type { ErrorReportContext, ErrorReporterService, ErrorSink } from "./errorReporter";

const require = createRequire(__filename);

type SentryInitOptions = {
  dsn: string;
  service: ErrorReporterService;
  environment: string;
  release?: string;
};

/**
 * Isolated so tests can exercise the reporter with an injected sink
 * and never talk to Sentry.
 */
export function createSentrySink(options: SentryInitOptions): ErrorSink {
  // Lazy require: local/CI without a DSN never loads the SDK.
  const Sentry = require("@sentry/node") as typeof import("@sentry/node");

  Sentry.initWithoutDefaultIntegrations({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    serverName: options.service === "worker" ? "coop-worker" : "coop-api",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration()
    ],
    beforeSend(event) {
      return stripSentryEvent(event);
    }
  });

  return (error, context) => {
    Sentry.captureException(error, { tags: tagsFromContext(context) });
  };
}

export function stripSentryEvent<T extends { request?: unknown; user?: { email?: unknown; ip_address?: unknown; username?: unknown } }>(
  event: T
): T {
  delete event.request;
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  return event;
}

function tagsFromContext(context: ErrorReportContext): Record<string, string> {
  const tags: Record<string, string> = {};
  if (context.service) {
    tags.service = context.service;
  }
  if (context.requestId) {
    tags.requestId = context.requestId;
  }
  if (context.orgId) {
    tags.orgId = context.orgId;
  }
  if (context.route) {
    tags.route = context.route;
  }
  if (context.jobId) {
    tags.jobId = context.jobId;
  }
  if (context.jobType) {
    tags.jobType = context.jobType;
  }
  return tags;
}
