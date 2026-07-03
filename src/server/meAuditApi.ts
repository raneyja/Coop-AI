import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import { auditActor } from "./audit/auditLogger";
import { writeJson } from "./adminApiShared";
import type { OrgApiDeps } from "./orgApi";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
};

export async function handleMeAuditRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (parsed.method !== "GET" || parsed.pathname !== "/v1/me/audit") {
    return false;
  }

  if (!deps.auditLogger) {
    writeJson(response, 503, { error: "audit_unavailable" });
    return true;
  }

  const { principal } = auditActor(auth);
  const limit = Math.min(100, Math.max(1, Number(parsed.query?.get("limit") ?? 50) || 50));
  const cursor = parsed.query?.get("cursor");
  const entries = await deps.auditLogger.listForPrincipal(auth.orgId, principal, {
    limit,
    cursor: cursor ?? undefined
  });

  writeJson(response, 200, entries);
  return true;
}
