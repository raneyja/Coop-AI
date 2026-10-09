import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { parseSupportSubmission } from "../../support/supportTypes";
import { handleSupportSubmission, handleOperatorSupport } from "./supportApi";
import type { SupportStore } from "./supportStore";
import { processSupportNotifications } from "./supportNotifications";
import { EmailService } from "../email/emailService";
import { loadBillingConfig } from "../billing/billingConfig";
import { handleOperatorApiRequest, type OperatorApiDeps } from "../operatorApi";
import type { AuthContext } from "../orgStore";

const id = "11111111-1111-4111-8111-111111111111";
const input = { submissionId: id, kind: "bug", title: "Cannot submit", description: "Click send and observe the error", contactEmail: "dev@example.com" };
const auth = { orgId: id, apiKeyId: "key-1", userId: "user-1" } as AuthContext;
function response() {
  const res = { statusCode: 0, body: "", headers: {} as Record<string, unknown>,
    setHeader(name: string, value: unknown) { this.headers[name] = value; },
    writeHead(code: number) { this.statusCode = code; }, end(body: string) { this.body = body; } };
  return res as typeof res & ServerResponse;
}
async function main() {
  const diagnostics = { extensionVersion: "1", vscodeVersion: "2", platform: "darwin", architecture: "arm64", token: "secret" };
  const parsed = parseSupportSubmission({ ...input, title: "  Trim me  ", diagnostics, logs: "sensitive" });
  assert.equal(parsed.title, "Trim me"); assert.equal("logs" in parsed, false); assert.equal("token" in parsed.diagnostics!, false);
  for (const bad of [{ title: "x" }, { description: "x" }, { contactEmail: "bad\nmail" }, { kind: "other" }, { submissionId: "bad" }, { diagnostics: { extensionVersion: "a" } }, { description: "a".repeat(12001) }]) {
    assert.throws(() => parseSupportSubmission({ ...input, ...bad }));
  }
  let submissions = 0;
  const store = { submit: async (org: string, principal: string) => {
    submissions++; assert.equal(org, auth.orgId); assert.equal(principal, auth.userId); return { id };
  } } as unknown as SupportStore;
  const request = { method: "POST", pathname: "/v1/support/reports", body: input };
  const denied = response(); await handleSupportSubmission(request, denied, store); assert.equal(denied.statusCode, 401); assert.equal(submissions, 0);
  const legacy = response(); await handleSupportSubmission(request, legacy, store, { ...auth, orgId: "legacy" }); assert.equal(legacy.statusCode, 401);
  const unavailable = response(); await handleSupportSubmission(request, unavailable, undefined, auth); assert.equal(unavailable.statusCode, 503);
  const ok = response(); await handleSupportSubmission(request, ok, store, auth); assert.equal(ok.statusCode, 201); assert.equal(JSON.parse(ok.body).id, id);
  const invalid = response(); await handleSupportSubmission({ ...request, body: { ...input, kind: "other" } }, invalid, store, auth); assert.equal(invalid.statusCode, 400);
  const limited = response(); await handleSupportSubmission(request, limited, { submit: async () => ({ limited: true, id: "" }) } as unknown as SupportStore, auth); assert.equal(limited.statusCode, 429); assert.equal(limited.headers["Retry-After"], "3600");
  const viewer = { operatorId: id, email: "ops@example.com", role: "viewer" as const };
  const opRequest = { method: "GET", pathname: "/v1/operator/support/reports", body: {} };
  const forbidden = response(); await handleOperatorSupport(opRequest, forbidden, store, viewer); assert.equal(forbidden.statusCode, 403);
  const operator = { ...viewer, role: "support" as const };
  const deps = { operatorStore: { resolveSession: async () => operator }, supportStore: { list: async () => ({ reports: [] }) } } as unknown as OperatorApiDeps;
  const integrated = response();
  await handleOperatorApiRequest({ ...opRequest, headers: { authorization: "Bearer operator-test" } }, integrated, deps);
  assert.equal(integrated.statusCode, 200); // Support route runs after operator auth and before unrelated org dependencies.
  const unauthenticatedOperator = response();
  await handleOperatorApiRequest({ ...opRequest, headers: {} }, unauthenticatedOperator, deps);
  assert.equal(unauthenticatedOperator.statusCode, 401);
  const filter = response(); await handleOperatorSupport({ ...opRequest, query: new URLSearchParams("offset=-1") }, filter, store, operator); assert.equal(filter.statusCode, 400);
  const malformedId = response(); await handleOperatorSupport({ ...opRequest, pathname: opRequest.pathname + "/not-uuid" }, malformedId, store, operator); assert.equal(malformedId.statusCode, 404);
  const invalidUpdate = response(); await handleOperatorSupport({ method: "PATCH", pathname: `${opRequest.pathname}/${id}`, body: { status: "resolved", assigneeId: null, note: "", revision: -1 } }, invalidUpdate, store, operator); assert.equal(invalidUpdate.statusCode, 400);
  const conflict = response(); await handleOperatorSupport({ method: "PATCH", pathname: `${opRequest.pathname}/${id}`, body: { status: "resolved", assigneeId: null, note: "", revision: 0 } }, conflict, { update: async () => "conflict" } as unknown as SupportStore, operator); assert.equal(conflict.statusCode, 409);

  for (const [attempts, result, expected] of [[1, "fail", "pending"], [8, "fail", "failed"], [1, "mock", "mocked"], [1, "ok", "sent"]] as const) {
    let claim = true; let purged = false; let finished = "";
    const notificationStore = { purgeDiagnostics: async () => { purged = true; }, claimNotification: async () => { if (!claim) return undefined; claim = false; return { id, kind: "bug", title: "Test report", description: "Steps to reproduce", contactEmail: "dev@example.com", attempts }; },
      finishNotification: async (_id: string, _attempts: number, state: string) => { finished = state; } } as unknown as SupportStore;
    const email = { sendSupportNotification: async (params: { title: string; description: string; contactEmail: string }) => {
      assert.equal(params.title, "Test report"); assert.equal(params.description, "Steps to reproduce"); assert.equal(params.contactEmail, "dev@example.com");
      if (result === "fail") throw new Error("outage"); return { mocked: result === "mock" };
    } } as unknown as EmailService;
    await processSupportNotifications(notificationStore, email, "https://ops.coop-ai.dev", "support@coop-ai.dev");
    assert.equal(purged, true); assert.equal(finished, expected);
  }
  const originalFetch = globalThis.fetch;
  try {
    let sent = false; let payload: { html: string; text: string } | undefined;
    globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
      const headers = options.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], `support-report/${id}`);
      const body = JSON.parse(options.body as string); assert.deepEqual(body.to, ["support@coop-ai.dev"]);
      assert.equal(body.text.includes(`https://ops.coop-ai.dev/support/${id}`), true);
      assert.equal(body.html.includes("dev@example.com"), true); assert.ok(options.signal); sent = true; payload = body;
      return { ok: true } as Response;
    }) as typeof fetch;
    const service = new EmailService(loadBillingConfig({ RESEND_API_KEY: "test", COOP_EMAIL_MOCK: "false" }));
    const params = { to: "support@coop-ai.dev", reportId: id, kind: "bug", title: 'Report <test> & "example"', contactEmail: "dev@example.com",
      description: 'Step 1: open http://localhost:3001\nStep 2: <script>alert("example")</script>', reviewUrl: `https://ops.coop-ai.dev/support/${id}` };
    const result = await service.sendSupportNotification(params);
    assert.equal(result.mocked, false); assert.equal(sent, true);
    assert.ok(payload!.html.includes("Report &lt;test&gt; &amp; &quot;example&quot;"));
    assert.ok(payload!.html.includes('http://localhost:3001<br />Step 2: &lt;script&gt;'));
    assert.ok(!payload!.html.includes("<script>")); assert.ok(!payload!.html.includes("Didn't request this?"));
    assert.ok(payload!.text.includes(params.title)); assert.ok(payload!.text.includes(params.description));
    assert.ok(!payload!.text.includes("Preview shortened"));
    await service.sendSupportNotification({ ...params, description: "🧪".repeat(1201) + "PRIVATE_TAIL" });
    assert.ok(payload!.text.includes("🧪".repeat(1200) + "…")); assert.ok(!payload!.text.includes("PRIVATE_TAIL"));
    assert.ok(!payload!.html.includes("PRIVATE_TAIL")); assert.ok(payload!.html.includes("Preview shortened"));
    await assert.rejects(() => service.sendSupportNotification({ ...params, reviewUrl: "http://localhost:3000/support" }));
    const logs: string[] = []; const originalLog = console.log;
    try {
      console.log = (line: string) => { logs.push(line); };
      await new EmailService(loadBillingConfig({ COOP_EMAIL_MOCK: "true" })).sendSupportNotification(params);
    } finally { console.log = originalLog; }
    assert.ok(logs.some((line) => line.includes(params.reviewUrl))); assert.ok(!logs.some((line) => line.includes("localhost")));
  } finally { globalThis.fetch = originalFetch; }
  console.log("support: validation, auth, RBAC, conflicts, notification retry and email tests passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
