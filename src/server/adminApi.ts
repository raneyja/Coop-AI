import type { ServerResponse } from "node:http";
import { requireAuth, requireOrgAdmin, resolveAuthContext } from "./authMiddleware";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import { handleAdminUsersRequest } from "./adminUsersApi";
import { handleAdminApiKeysRequest } from "./adminApiKeysApi";
import { handleAdminIntegrationsRequest } from "./adminIntegrationsApi";
import { handleAdminIntegrationScopeRequest } from "./adminIntegrationScopeApi";
import { handleAdminOrgRequest } from "./adminOrgApi";
import { handleAdminAuditRequest } from "./adminAuditApi";
import { handleAdminAnalyticsRequest } from "./adminAnalyticsApi";

export type { AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export async function handleAdminApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/admin/")) {
    return false;
  }

  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth,
    deps.userStore
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth)) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireOrgAdmin(auth, response)) {
    return true;
  }
  if (!deps.orgStore || auth.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/enterprise-upgrade-request") {
    if (!deps.operatorStore) {
      writeJson(response, 503, { error: "operator_unavailable" });
      return true;
    }
    const body = asRecord(parsed.body);
    const companyName = String(body.orgName ?? auth.orgName ?? "").trim();
    const contactEmail = String(body.email ?? auth.email ?? "").trim().toLowerCase();
    const contactName = String(body.name ?? "").trim();
    const notes = String(body.notes ?? "").trim();
    if (!companyName || !contactEmail) {
      writeJson(response, 400, { error: "invalid_request", message: "orgName and email are required." });
      return true;
    }

    const message = [contactName, notes].filter(Boolean).join(" - ") || undefined;
    await deps.operatorStore.createEnterpriseUpgradeRequest({
      orgId: auth.orgId,
      companyName,
      contactEmail,
      message
    });
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (await handleAdminUsersRequest(parsed, response, deps, auth)) {
    return true;
  }
  if (await handleAdminApiKeysRequest(parsed, response, deps, auth)) {
    return true;
  }
  if (await handleAdminIntegrationsRequest(parsed, response, deps, auth)) {
    return true;
  }
  if (await handleAdminIntegrationScopeRequest(parsed, response, deps, auth)) {
    return true;
  }
  if (await handleAdminOrgRequest(parsed, response, deps, auth)) {
    return true;
  }
  if (await handleAdminAuditRequest(parsed, response, deps, auth)) {
    return true;
  }
  if (await handleAdminAnalyticsRequest(parsed, response, deps, auth, deps.usageTracker)) {
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
