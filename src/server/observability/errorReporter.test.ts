import assert from "node:assert/strict";
import test from "node:test";
import {
  captureException,
  initErrorReporter,
  reportServerError,
  resetErrorReporterForTests,
  sanitizeErrorContext
} from "./errorReporter";
import { stripSentryEvent } from "./sentrySink";

test("no DSN is a no-op", () => {
  resetErrorReporterForTests();
  const enabled = initErrorReporter({
    service: "api",
    env: { NODE_ENV: "test" }
  });
  assert.equal(enabled, false);
  captureException(new Error("should not ship"), { orgId: "org_1" });
});

test("injected sink receives allowlisted tags only", () => {
  resetErrorReporterForTests();
  const captured: Array<{ message: string; context: Record<string, unknown> }> = [];
  initErrorReporter({
    service: "api",
    sink: (error, context) => {
      captured.push({ message: error.message, context });
    }
  });
  captureException(new Error("boom"), {
    orgId: "org_9",
    requestId: "req-12345678",
    route: "/v1/chat"
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.message, "boom");
  assert.deepEqual(captured[0]?.context, {
    service: "api",
    requestId: "req-12345678",
    orgId: "org_9",
    route: "/v1/chat",
    jobId: undefined,
    jobType: undefined
  });
});

test("redacts tokens from error messages before the sink", () => {
  resetErrorReporterForTests();
  const captured: string[] = [];
  initErrorReporter({
    service: "worker",
    sink: (error) => {
      captured.push(error.message);
    }
  });
  captureException(new Error("clone failed x-access-token:gho_secrettoken@github.com/org/repo.git"));
  assert.equal(captured.length, 1);
  assert.match(captured[0] ?? "", /x-access-token:\*\*\*@/);
  assert.doesNotMatch(captured[0] ?? "", /gho_secrettoken/);
});

test("AbortError and job cancel are not reported", () => {
  resetErrorReporterForTests();
  let calls = 0;
  initErrorReporter({
    service: "api",
    sink: () => {
      calls += 1;
    }
  });
  const abort = new Error("aborted");
  abort.name = "AbortError";
  captureException(abort);
  captureException(new Error("Job cancelled by user"));
  assert.equal(calls, 0);
});

test("captureException never throws when the sink throws", () => {
  resetErrorReporterForTests();
  initErrorReporter({
    service: "api",
    sink: () => {
      throw new Error("sentry down");
    }
  });
  assert.doesNotThrow(() => captureException(new Error("original")));
});

test("reportServerError includes requestId and still captures", () => {
  resetErrorReporterForTests();
  let calls = 0;
  initErrorReporter({
    service: "api",
    sink: () => {
      calls += 1;
    }
  });
  const body = reportServerError(new Error("disk full"), {
    requestId: "req-abcdef12",
    route: "/v1/chat"
  });
  assert.deepEqual(body, { error: "disk full", requestId: "req-abcdef12" });
  assert.equal(calls, 1);
});

test("sanitizeErrorContext drops empty and oversized tags", () => {
  const cleaned = sanitizeErrorContext({
    orgId: "  ",
    requestId: "x".repeat(201),
    route: "/health"
  });
  assert.equal(cleaned.orgId, undefined);
  assert.equal(cleaned.requestId, undefined);
  assert.equal(cleaned.route, "/health");
});

test("stripSentryEvent drops request bodies and user PII", () => {
  const event = stripSentryEvent({
    request: { data: { message: "prompt" }, headers: { authorization: "Bearer secret" } },
    user: { email: "a@b.com", ip_address: "1.2.3.4", username: "jon" }
  });
  assert.equal(event.request, undefined);
  assert.deepEqual(event.user, {});
});


