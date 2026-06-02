import type { ServerResponse } from "node:http";
import { requireAuth, requireOrgPlan, resolveAuthContext } from "./authMiddleware";
import type { OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";

type ParsedRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string | undefined>;
};

export type EnterpriseApiDeps = {
  orgStore?: OrgStore;
  serverConfig: ServerConfig;
};

export async function handleEnterpriseApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: EnterpriseApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/sso") && !parsed.pathname.startsWith("/v1/self-host")) {
    return false;
  }

  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth)) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  if (!deps.orgStore || auth!.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  if (!(await requireOrgPlan(deps.orgStore, auth!, response, "enterprise"))) {
    return true;
  }

  writeJson(response, 501, { error: "not_implemented", message: "Enterprise SSO and self-host APIs are not available yet." });
  return true;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
