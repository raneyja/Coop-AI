import type { ServerResponse } from "node:http";
import { requireAuth, requireInstallAdmin, requireOrgPlan, resolveAuthContext } from "./authMiddleware";
import type { OrgStore, AuthContext } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { AuthPolicyStore } from "./sso/authPolicyStore";
import type { SsoConfigStore } from "./sso/ssoConfigStore";
import type { OrgSsoConfigInput, SsoProvider } from "./sso/ssoConfigStore";
import { isValidX509Cert } from "./sso/x509Cert";
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
  authPolicyStore?: AuthPolicyStore;
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

  if (parsed.pathname === "/v1/sso/policy") {
    return handleSsoPolicy(parsed, response, deps, auth!);
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
    if (!requireInstallAdmin(auth, response)) {
      return true;
    }
    const config = await deps.ssoConfigStore.getConfig(auth.orgId);
    const sp = buildSpDetails(deps.serverConfig);
    if (!config) {
      writeJson(response, 200, { configured: false, ...(sp ? { sp } : {}) });
      return true;
    }
    writeJson(response, 200, {
      configured: true,
      provider: config.provider,
      idpEntityId: config.idpEntityId,
      idpSsoUrl: config.idpSsoUrl,
      enabled: config.enabled,
      hasCertificate: isValidX509Cert(config.idpX509Cert),
      updatedAt: config.updatedAt.toISOString(),
      ...(sp ? { sp } : {})
    });
    return true;
  }

  if (parsed.method === "PUT") {
    if (!requireInstallAdmin(auth, response)) {
      return true;
    }
    const body = asRecord(parsed.body);
    const existing = await deps.ssoConfigStore.getConfig(auth.orgId);
    const parsedInput = parseSsoConfigInput(body, existing?.idpX509Cert);
    if (!parsedInput.ok) {
      writeJson(response, 400, { error: "invalid_request", message: parsedInput.message });
      return true;
    }
    if (parsedInput.input.enabled === false && deps.authPolicyStore) {
      const policy = await deps.authPolicyStore.getPolicy(auth.orgId);
      if (policy.requireSso) {
        writeJson(response, 400, {
          error: "sso_required_active",
          message: "Turn off Require SSO before disabling SAML sign-in."
        });
        return true;
      }
    }
    try {
      const saved = await deps.ssoConfigStore.upsertConfig(auth.orgId, parsedInput.input);
      const sp = buildSpDetails(deps.serverConfig);
      writeJson(response, 200, {
        configured: true,
        provider: saved.provider,
        idpEntityId: saved.idpEntityId,
        idpSsoUrl: saved.idpSsoUrl,
        enabled: saved.enabled,
        hasCertificate: true,
        updatedAt: saved.updatedAt.toISOString(),
        ...(sp ? { sp } : {})
      });
    } catch (error) {
      writeJson(response, 400, {
        error: "invalid_certificate",
        message: error instanceof Error ? error.message : "Invalid IdP certificate."
      });
    }
    return true;
  }

  writeJson(response, 405, { error: "method_not_allowed" });
  return true;
}

async function handleSsoPolicy(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: EnterpriseApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.authPolicyStore) {
    writeJson(response, 503, { error: "sso_unavailable", message: "Auth policy store is not available." });
    return true;
  }

  if (parsed.method === "GET") {
    const policy = await deps.authPolicyStore.getPolicy(auth.orgId);
    writeJson(response, 200, {
      requireSso: policy.requireSso,
      allowPassword: policy.allowPassword,
      allowGoogle: policy.allowGoogle,
      updatedAt: policy.updatedAt.toISOString()
    });
    return true;
  }

  if (parsed.method === "PUT") {
    if (!requireInstallAdmin(auth, response)) {
      return true;
    }
    const body = asRecord(parsed.body);
    if (body.requireSso === true) {
      const ssoReady = await isSsoEnabledForOrg(deps.ssoConfigStore, auth.orgId);
      if (!ssoReady) {
        writeJson(response, 400, {
          error: "sso_not_configured",
          message: "Enable and save SAML SSO configuration before requiring SSO sign-in."
        });
        return true;
      }
    }
    const policy = await deps.authPolicyStore.upsertPolicy(auth.orgId, {
      requireSso: typeof body.requireSso === "boolean" ? body.requireSso : undefined,
      allowPassword: typeof body.allowPassword === "boolean" ? body.allowPassword : undefined,
      allowGoogle: typeof body.allowGoogle === "boolean" ? body.allowGoogle : undefined
    });
    writeJson(response, 200, {
      requireSso: policy.requireSso,
      allowPassword: policy.allowPassword,
      allowGoogle: policy.allowGoogle,
      updatedAt: policy.updatedAt.toISOString()
    });
    return true;
  }

  writeJson(response, 405, { error: "method_not_allowed" });
  return true;
}

function buildSpDetails(serverConfig: ServerConfig):
  | { entityId: string; acsUrl: string; metadataUrl: string; publicStartUrl: string }
  | undefined {
  const base = serverConfig.ssoBaseUrl?.replace(/\/+$/, "");
  if (!base) {
    return undefined;
  }
  const metadataUrl = `${base}/v1/auth/saml/metadata`;
  return {
    entityId: serverConfig.ssoSpEntityId?.trim() || metadataUrl,
    acsUrl: `${base}/v1/auth/saml/callback`,
    metadataUrl,
    publicStartUrl: `${base}/v1/auth/saml/start`
  };
}

function parseSsoConfigInput(
  body: Record<string, unknown>,
  existingCert?: string
): { ok: true; input: OrgSsoConfigInput } | { ok: false; message: string } {
  const provider = String(body.provider ?? "").trim() as SsoProvider;
  const idpEntityId = String(body.idpEntityId ?? "").trim();
  const idpSsoUrl = String(body.idpSsoUrl ?? "").trim();
  const rawCert = typeof body.idpX509Cert === "string" ? body.idpX509Cert.trim() : "";

  if (!provider || !idpEntityId || !idpSsoUrl) {
    return {
      ok: false,
      message: "provider, idpEntityId, and idpSsoUrl are required."
    };
  }
  if (!["okta", "azuread", "saml"].includes(provider)) {
    return { ok: false, message: "provider must be okta, azuread, or saml." };
  }

  let parsedSsoUrl: URL;
  try {
    parsedSsoUrl = new URL(idpSsoUrl);
  } catch {
    return { ok: false, message: "idpSsoUrl must be a valid URL." };
  }
  if (parsedSsoUrl.protocol !== "https:") {
    return { ok: false, message: "idpSsoUrl must use HTTPS." };
  }

  if (rawCert) {
    if (/^coop_(sess|refresh)_/i.test(rawCert)) {
      return {
        ok: false,
        message: "idpX509Cert looks like a Coop session token. Paste the IdP X.509 signing certificate instead."
      };
    }
    if (!isValidX509Cert(rawCert)) {
      return {
        ok: false,
        message: "idpX509Cert must be a valid X.509 certificate (PEM or base64)."
      };
    }
  } else if (!existingCert || !isValidX509Cert(existingCert)) {
    return {
      ok: false,
      message: "idpX509Cert is required when no valid certificate is already on file."
    };
  }

  return {
    ok: true,
    input: {
      provider,
      idpEntityId,
      idpSsoUrl,
      idpX509Cert: rawCert || existingCert!,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled)
    }
  };
}

async function isSsoEnabledForOrg(
  ssoConfigStore: SsoConfigStore | undefined,
  orgId: string
): Promise<boolean> {
  if (!ssoConfigStore) {
    return false;
  }
  const config = await ssoConfigStore.getEnabledConfig(orgId);
  return config !== undefined && isValidX509Cert(config.idpX509Cert);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
