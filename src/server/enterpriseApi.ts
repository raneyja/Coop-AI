import type { ServerResponse } from "node:http";
import { requireAuth, requireInstallAdmin, requireOrgPlan, resolveAuthContext } from "./authMiddleware";
import type { OrgStore, AuthContext } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { SsoConfigStore } from "./sso/ssoConfigStore";
import type { OrgSsoConfigInput, SsoProvider } from "./sso/ssoConfigStore";
import type { UserStore } from "./users/userStore";

type ParsedRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export type EnterpriseApiDeps = {
  orgStore?: OrgStore;
  ssoConfigStore?: SsoConfigStore;
  userStore?: UserStore;
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
    deps.serverConfig.requireApiAuth,
    deps.userStore
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

  if (parsed.pathname === "/v1/sso/config") {
    return handleSsoConfig(parsed, response, deps, auth!);
  }

  if (parsed.pathname.startsWith("/v1/self-host")) {
    writeJson(response, 501, { error: "not_implemented", message: "Self-host APIs are not available yet." });
    return true;
  }

  writeJson(response, 404, { error: "not_found" });
  return true;
}

async function handleSsoConfig(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: EnterpriseApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.ssoConfigStore) {
    writeJson(response, 503, { error: "sso_unavailable", message: "SSO configuration store is not available." });
    return true;
  }

  if (parsed.method === "GET") {
    const config = await deps.ssoConfigStore.getConfig(auth.orgId);
    if (!config) {
      writeJson(response, 200, { configured: false });
      return true;
    }
    writeJson(response, 200, {
      configured: true,
      provider: config.provider,
      idpEntityId: config.idpEntityId,
      idpSsoUrl: config.idpSsoUrl,
      enabled: config.enabled,
      updatedAt: config.updatedAt.toISOString()
    });
    return true;
  }

  if (parsed.method === "PUT") {
    if (!requireInstallAdmin(auth, response)) {
      return true;
    }
    const body = asRecord(parsed.body);
    const input = parseSsoConfigInput(body);
    if (!input) {
      writeJson(response, 400, { error: "invalid_request", message: "provider, idpEntityId, idpSsoUrl, and idpX509Cert are required." });
      return true;
    }
    const saved = await deps.ssoConfigStore.upsertConfig(auth.orgId, input);
    writeJson(response, 200, {
      configured: true,
      provider: saved.provider,
      idpEntityId: saved.idpEntityId,
      idpSsoUrl: saved.idpSsoUrl,
      enabled: saved.enabled,
      updatedAt: saved.updatedAt.toISOString()
    });
    return true;
  }

  writeJson(response, 405, { error: "method_not_allowed" });
  return true;
}

function parseSsoConfigInput(body: Record<string, unknown>): OrgSsoConfigInput | undefined {
  const provider = String(body.provider ?? "").trim() as SsoProvider;
  const idpEntityId = String(body.idpEntityId ?? "").trim();
  const idpSsoUrl = String(body.idpSsoUrl ?? "").trim();
  const idpX509Cert = String(body.idpX509Cert ?? "").trim();
  if (!provider || !idpEntityId || !idpSsoUrl || !idpX509Cert) {
    return undefined;
  }
  if (!["okta", "azuread", "saml"].includes(provider)) {
    return undefined;
  }
  return {
    provider,
    idpEntityId,
    idpSsoUrl,
    idpX509Cert,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
