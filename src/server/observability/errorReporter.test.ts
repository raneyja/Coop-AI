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



test("known credential redaction covers stack and HTTP error response", () => {
  resetErrorReporterForTests();
  let captured: Error | undefined;
  initErrorReporter({ service: "api", sink: error => { captured = error; } });
  const error = new Error("clone failed x-access-token:gho_fixturesecret@github.com/org/repo.git");
  error.stack = `${error.name}: ${error.message}\n    at fetchSource (/fixture/source.ts:10:2)`;
  const response = reportServerError(error, { requestId: "req-fixture12" });
  assert.ok(captured);
  assert.doesNotMatch(captured.stack ?? "", /gho_fixturesecret/);
  assert.match(captured.stack ?? "", /source\.ts:10:2/);
  assert.doesNotMatch(response.error, /gho_fixturesecret/);
  assert.equal(response.requestId, "req-fixture12");
  assert.match(error.stack ?? "", /gho_fixturesecret/, "reporting must not mutate the original error");
});

test("automatic Sentry exception values receive existing credential redaction", () => {
  const event = stripSentryEvent({
    exception: { values: [{ type: "Error", value: "failed oauth2:gho_fixturesecret@gitlab.example/org/repo.git" }] },
    tags: { requestId: "req-fixture12" }
  });
  assert.doesNotMatch(event.exception.values[0]!.value, /gho_fixturesecret/);
  assert.match(event.exception.values[0]!.value, /oauth2:\*\*\*@/);
  assert.equal(event.tags.requestId, "req-fixture12");
});

test("known credential redaction covers a stack-only credential", () => {
  resetErrorReporterForTests();
  let captured: Error | undefined;
  initErrorReporter({ service: "worker", sink: error => { captured = error; } });
  const error = new Error("source request failed");
  error.stack = "Error: source request failed\n    at https://x-token-auth:gho_fixturesecret@bitbucket.example/source.ts:3:5";
  captureException(error);
  assert.ok(captured);
  assert.equal(captured.message, error.message);
  assert.doesNotMatch(captured.stack ?? "", /gho_fixturesecret/);
  assert.match(error.stack, /gho_fixturesecret/);
});

test("known credentials are removed from SDK-parsed stack frame locations", () => {
  const event = stripSentryEvent({ exception: { values: [{ value: "request failed", stacktrace: { frames: [
    { filename: "https://x-access-token:gho_fixturesecret@github.com/source.ts", abs_path: "https://oauth2:gho_fixturesecret@gitlab.example/source.ts", function: "fetchSource" },
    { filename: "/app/src/safe.ts", function: "resolveSource" }
  ] } }] } });
  assert.doesNotMatch(JSON.stringify(event), /gho_fixturesecret/);
  assert.equal(event.exception.values[0]!.stacktrace.frames[1]!.filename, "/app/src/safe.ts");
  assert.equal(event.exception.values[0]!.stacktrace.frames[0]!.function, "fetchSource");
});

test("unsafe stack inspection is dropped while the ordinary response remains safe", () => {
  for (const withSink of [false, true]) {
    resetErrorReporterForTests();
    let sinkCalls = 0;
    if (withSink) initErrorReporter({ service: "api", sink: () => { sinkCalls += 1; } });
    else assert.equal(initErrorReporter({ service: "api", env: { NODE_ENV: "test" } }), false);

    const nonStringStack = new Error("still safe");
    Object.defineProperty(nonStringStack, "stack", { configurable: true, value: 42 });
    assert.doesNotThrow(() => captureException(nonStringStack));
    assert.deepEqual(reportServerError(nonStringStack, { requestId: "req-nonstring" }), {
      error: "still safe", requestId: "req-nonstring"
    });

    const throwingStack = new Error("also safe");
    Object.defineProperty(throwingStack, "stack", { configurable: true, get() { throw new Error("stack access failed"); } });
    assert.doesNotThrow(() => captureException(throwingStack));
    assert.deepEqual(reportServerError(throwingStack, { requestId: "req-throwing" }), {
      error: "also safe", requestId: "req-throwing"
    });
    assert.equal(sinkCalls, 0, "unsafe reports must be dropped instead of forwarded raw");
  }
});

test("client response falls back safely when error-message inspection fails", () => {
  resetErrorReporterForTests();
  let sinkCalls = 0;
  initErrorReporter({ service: "api", sink: () => { sinkCalls += 1; } });
  const malformed = new Error("placeholder");
  Object.defineProperty(malformed, "message", { configurable: true, value: Symbol("unsafe") });
  assert.deepEqual(reportServerError(malformed, { requestId: "req-fallback" }), {
    error: "unexpected server error", requestId: "req-fallback"
  });
  assert.equal(sinkCalls, 0, "a failed sanitation attempt must never forward the original value");
});

test("SDK-derived module frame is credential-redacted", () => {
  const event = stripSentryEvent({ exception: { values: [{ value: "failure", stacktrace: { frames: [
    { filename: "/srv/gho_fixturesecret/source.ts", module: "gho_fixturesecret.source" }
  ] } }] } });
  assert.doesNotMatch(JSON.stringify(event), /gho_fixturesecret/);
});
