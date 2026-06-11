import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import { writeJson, type AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
};

export async function handleAdminAuditRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (parsed.method !== "GET" || parsed.pathname !== "/v1/admin/audit") {
    return false;
  }

  if (!deps.auditLogger) {
    writeJson(response, 503, { error: "audit_unavailable" });
    return true;
  }

  const limit = Math.min(100, Math.max(1, Number(parsed.query?.get("limit") ?? 50) || 50));
  const cursor = parsed.query?.get("cursor");
  const entries = await deps.auditLogger.listForOrg(auth.orgId, { limit, cursor: cursor ?? undefined });

  writeJson(response, 200, entries);
  return true;
}
