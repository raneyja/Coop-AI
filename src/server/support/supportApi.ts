import type { ServerResponse } from "node:http";
import { writeJson } from "../adminApiShared";
import type { AuthContext } from "../orgStore";
import { parseSupportSubmission, SUPPORT_STATUSES, UUID_PATTERN, type SupportStatus } from "../../support/supportTypes";
import type { SupportStore } from "./supportStore";
import { requireOperatorRole } from "../operators/operatorAuthMiddleware";
import type { OperatorContext } from "../operators/operatorStore";

type Request = { method: string; pathname: string; body: unknown; query?: URLSearchParams };

export async function handleSupportSubmission(request: Request, response: ServerResponse, store: SupportStore | undefined, auth?: AuthContext): Promise<boolean> {
  if (request.pathname !== "/v1/support/reports") return false;
  if (!auth || auth.orgId === "legacy") { writeJson(response, 401, { error: "unauthorized", message: "Sign in to CoopAI to send a report. You can also email support@coop-ai.dev." }); return true; }
  if (!store) { writeJson(response, 503, { error: "support_unavailable" }); return true; }
  if (request.method !== "POST") { writeJson(response, 405, { error: "method_not_allowed" }); return true; }
  let input;
  try { input = parseSupportSubmission(request.body); }
  catch (error) { writeJson(response, 400, { error: "invalid_report", message: (error as Error).message }); return true; }
  const result = await store.submit(auth.orgId, auth.userId ?? auth.apiKeyId, input);
  if (result.limited) { response.setHeader("Retry-After", "3600"); writeJson(response, 429, { error: "rate_limited", message: "You can send up to 10 reports per hour. Try again later or email support@coop-ai.dev." }); }
  else writeJson(response, 201, { id: result.id, status: "open" });
  return true;
}

export async function handleOperatorSupport(request: Request, response: ServerResponse, store: SupportStore | undefined, operator: OperatorContext): Promise<boolean> {
  if (!request.pathname.startsWith("/v1/operator/support/reports")) return false;
  if (!requireOperatorRole(operator, "support", response)) return true;
  if (!store) { writeJson(response, 503, { error: "support_unavailable" }); return true; }
  if (request.pathname === "/v1/operator/support/reports" && request.method === "GET") {
    const status = request.query?.get("status") || undefined;
    const offset = Number(request.query?.get("offset") ?? 0);
    if ((status && !SUPPORT_STATUSES.includes(status as SupportStatus)) || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      writeJson(response, 400, { error: "invalid_filter" }); return true;
    }
    writeJson(response, 200, await store.list(status as SupportStatus | undefined, offset)); return true;
  }
  const match = request.pathname.match(/^\/v1\/operator\/support\/reports\/([^/]+)(\/retry-notification)?$/);
  if (!match || !UUID_PATTERN.test(match[1])) { writeJson(response, 404, { error: "not_found" }); return true; }
  const id = match[1];
  if (match[2] && request.method === "POST") {
    const queued = await store.retryNotification(id);
    writeJson(response, queued ? 200 : 409, queued ? { ok: true } : { error: "notification_not_retryable" }); return true;
  }
  if (!match[2] && request.method === "GET") {
    const report = await store.detail(id);
    writeJson(response, report ? 200 : 404, report ?? { error: "not_found" }); return true;
  }
  if (!match[2] && request.method === "PATCH") {
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    if (!SUPPORT_STATUSES.includes(body.status as SupportStatus) ||
      !(body.assigneeId === null || (typeof body.assigneeId === "string" && UUID_PATTERN.test(body.assigneeId))) ||
      typeof body.note !== "string" || body.note.length > 4000 ||
      typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 0 || body.revision >= 2147483647) {
      writeJson(response, 400, { error: "invalid_update" }); return true;
    }
    const result = await store.update(id, operator.operatorId, { status: body.status as SupportStatus, assigneeId: body.assigneeId as string | null, note: body.note.trim(), revision: body.revision });
    writeJson(response, result === "ok" ? 200 : result === "conflict" ? 409 : 400,
      result === "ok" ? { ok: true } : { error: result, message: result === "conflict" ? "This report changed. Reload it before saving." : "Invalid assignee." }); return true;
  }
  writeJson(response, 405, { error: "method_not_allowed" }); return true;
}
