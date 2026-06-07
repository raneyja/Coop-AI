import type { ServerResponse } from "node:http";
import { requireAuth, requireOrgPlan, resolveAuthContext } from "../authMiddleware";
import { AuditLogger, principalForApiKey, principalForUser } from "../audit/auditLogger";
import type { OrgStore } from "../orgStore";
import type { ServerConfig } from "../serverConfig";
import type { UserStore } from "../users/userStore";
import { SsoConfigError, type SamlService } from "./samlService";
import type { SsoConfigStore } from "./ssoConfigStore";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  /** Raw request body — required to parse the form-encoded SAML callback POST. */
  rawBody?: string;
};

export type SamlApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  ssoConfigStore?: SsoConfigStore;
  samlService?: SamlService;
  auditLogger?: AuditLogger;
  serverConfig: ServerConfig;
};

type RelayState = {
  orgId: string;
  redirect?: string;
};

const SAML_PREFIX = "/v1/auth/saml";

export async function handleSamlApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith(SAML_PREFIX)) {
    return false;
  }

  if (!deps.orgStore || !deps.userStore || !deps.ssoConfigStore || !deps.samlService) {
    writeJson(response, 503, { error: "sso_unavailable", message: "Enterprise SSO is not configured on this server." });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === `${SAML_PREFIX}/metadata`) {
    return handleMetadata(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${SAML_PREFIX}/start`) {
    return handlePublicStart(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${SAML_PREFIX}/login`) {
    return handleLogin(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${SAML_PREFIX}/callback`) {
    return handleCallback(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${SAML_PREFIX}/offboard`) {
    return handleOffboard(parsed, response, deps);
  }

  writeJson(response, 404, { error: "not_found" });
  return true;
}

// ---------------------------------------------------------------------------
// GET /v1/auth/saml/metadata  — bearer-gated (Enterprise). SP metadata XML.
// ---------------------------------------------------------------------------
async function handleMetadata(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  const auth = await requireEnterpriseBearer(parsed, response, deps);
  if (!auth) {
    return true;
  }
  const xml = deps.samlService!.generateMetadata();
  response.writeHead(200, { "content-type": "application/samlmetadata+xml; charset=utf-8" });
  response.end(xml);
  return true;
}

// ---------------------------------------------------------------------------
// GET /v1/auth/saml/start  — public org-scoped SSO entry (no bearer required).
// ---------------------------------------------------------------------------
async function handlePublicStart(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  const orgId = parsed.query?.get("orgId")?.trim();
  const orgName = parsed.query?.get("org")?.trim();
  const redirect = sanitizeRedirect(parsed.query?.get("redirect"));

  let resolvedOrgId = orgId;
  if (!resolvedOrgId && orgName) {
    const org = await deps.orgStore!.findOrganizationByName(orgName);
    resolvedOrgId = org?.id;
  }
  if (!resolvedOrgId) {
    writeJson(response, 400, {
      error: "missing_org",
      message: "Provide orgId or org (organization name) to start SSO."
    });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(resolvedOrgId);
  if (!org || org.plan !== "enterprise") {
    writeJson(response, 403, { error: "plan_required", message: "SSO is available on the Enterprise plan only." });
    return true;
  }

  const config = await deps.ssoConfigStore!.getEnabledConfig(resolvedOrgId);
  if (!config) {
    writeJson(response, 409, { error: "sso_not_configured", message: "SSO is not enabled for this organization." });
    return true;
  }

  const relayState = encodeRelayState({ orgId: resolvedOrgId, redirect: redirect ?? undefined });
  try {
    const url = await deps.samlService!.getLoginRedirectUrl(config, relayState);
    if (parsed.query?.get("format") === "json") {
      writeJson(response, 200, { redirectUrl: url });
    } else {
      response.writeHead(302, { location: url });
      response.end();
    }
  } catch (error) {
    writeJson(response, 502, { error: "sso_login_failed", message: errorMessage(error) });
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /v1/auth/saml/login  — bearer-gated (Enterprise). SP-initiated login.
// Redirects (302) to the org's IdP, or returns { redirectUrl } with ?format=json.
// ---------------------------------------------------------------------------
async function handleLogin(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  const auth = await requireEnterpriseBearer(parsed, response, deps);
  if (!auth) {
    return true;
  }

  const config = await deps.ssoConfigStore!.getEnabledConfig(auth.orgId);
  if (!config) {
    writeJson(response, 409, { error: "sso_not_configured", message: "No enabled SSO configuration for this org." });
    return true;
  }

  const redirect = sanitizeRedirect(parsed.query?.get("redirect"));
  const relayState = encodeRelayState({ orgId: auth.orgId, redirect });

  try {
    const url = await deps.samlService!.getLoginRedirectUrl(config, relayState);
    if (parsed.query?.get("format") === "json") {
      writeJson(response, 200, { redirectUrl: url });
    } else {
      response.writeHead(302, { location: url });
      response.end();
    }
  } catch (error) {
    writeJson(response, 502, { error: "sso_login_failed", message: errorMessage(error) });
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /v1/auth/saml/callback  — UNAUTHENTICATED browser POST from the IdP.
// Cannot carry a CoopAI bearer token. Gating is enforced by:
//   (1) resolving the org from signed RelayState, and
//   (2) requiring that org's plan === 'enterprise' AND SSO is enabled.
// Trust in the assertion itself comes from SAML signature validation.
// ---------------------------------------------------------------------------
async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  // CRITICAL: requires rawBody (application/x-www-form-urlencoded) — webhookServer must pass rawBody for this route or SAMLResponse will be missing.
  const form = readForm(parsed);
  const samlResponse = form.get("SAMLResponse");
  if (!samlResponse) {
    writeJson(response, 400, { error: "missing_saml_response" });
    return true;
  }

  const relay = decodeRelayState(form.get("RelayState"));
  if (!relay?.orgId) {
    writeJson(response, 400, { error: "missing_relay_state", message: "SP-initiated login is required (no org in RelayState)." });
    return true;
  }

  // Enterprise-plan gate, resolved from the RelayState org rather than a bearer.
  const org = await deps.orgStore!.getOrganization(relay.orgId);
  if (!org || org.plan !== "enterprise") {
    writeJson(response, 403, { error: "plan_required", message: "SSO is available on the Enterprise plan only." });
    return true;
  }

  const config = await deps.ssoConfigStore!.getEnabledConfig(relay.orgId);
  if (!config) {
    writeJson(response, 403, { error: "sso_not_configured", message: "SSO is not enabled for this organization." });
    return true;
  }

  let assertion;
  try {
    assertion = await deps.samlService!.validateCallback(config, samlResponse);
  } catch (error) {
    // node-saml throws here on signature/audience/timestamp/status failures.
    writeJson(response, 401, { error: "saml_validation_failed", message: errorMessage(error) });
    return true;
  }

  const user = await deps.userStore!.upsertUserFromIdp({
    orgId: relay.orgId,
    email: assertion.email,
    idpSubject: assertion.idpSubject,
    idpProvider: assertion.idpProvider
  });

  const session = await deps.userStore!.createSession(user.id, relay.orgId, deps.serverConfig.ssoSessionTtlMs);

  await deps.auditLogger?.record({
    orgId: relay.orgId,
    userId: user.id,
    principal: principalForUser(user.id),
    action: "auth.saml.login",
    metadata: { idpProvider: assertion.idpProvider, email: user.email }
  });

  deliverSession(response, session.token, relay.redirect);
  return true;
}

// ---------------------------------------------------------------------------
// POST /v1/auth/saml/offboard  — bearer-gated (Enterprise). IdP deprovisioning.
// Body (one of):
//   { userId }                  -> deactivate a single user
//   { idpSubject }              -> deactivate by IdP subject
//   { activeSubjects: string[] }-> SCIM-style full sync (deactivate the rest)
// ---------------------------------------------------------------------------
async function handleOffboard(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  const auth = await requireEnterpriseBearer(parsed, response, deps);
  if (!auth) {
    return true;
  }

  const body = asRecord(parsed.body);
  const principal = principalForApiKey(auth.apiKeyId);

  if (Array.isArray(body.activeSubjects)) {
    const config = await deps.ssoConfigStore!.getEnabledConfig(auth.orgId);
    if (!config) {
      writeJson(response, 409, { error: "sso_not_configured" });
      return true;
    }
    const activeSubjects = body.activeSubjects.map((s) => String(s));
    const deactivated = await deps.userStore!.reconcileOffboarding(auth.orgId, config.provider, activeSubjects);
    await deps.auditLogger?.record({
      orgId: auth.orgId,
      principal,
      action: "auth.user.reconcile_offboarding",
      metadata: { provider: config.provider, deactivatedCount: deactivated.length, deactivatedIds: deactivated }
    });
    writeJson(response, 200, { ok: true, deactivated });
    return true;
  }

  if (body.userId) {
    const userId = String(body.userId);
    const target = await deps.userStore!.getUser(userId);
    if (!target || target.orgId !== auth.orgId) {
      writeJson(response, 404, { error: "user_not_found" });
      return true;
    }
    const changed = await deps.userStore!.deactivateUser(userId);
    await deps.auditLogger?.record({
      orgId: auth.orgId,
      principal,
      action: "auth.user.deactivate",
      metadata: { userId, alreadyDeactivated: !changed }
    });
    writeJson(response, 200, { ok: true, userId, deactivated: changed });
    return true;
  }

  if (body.idpSubject) {
    const config = await deps.ssoConfigStore!.getEnabledConfig(auth.orgId);
    if (!config) {
      writeJson(response, 409, { error: "sso_not_configured" });
      return true;
    }
    const idpSubject = String(body.idpSubject);
    const changed = await deps.userStore!.deactivateByIdpSubject(config.provider, idpSubject);
    await deps.auditLogger?.record({
      orgId: auth.orgId,
      principal,
      action: "auth.user.deactivate",
      metadata: { idpSubject, provider: config.provider, matched: changed }
    });
    writeJson(response, 200, { ok: true, idpSubject, deactivated: changed });
    return true;
  }

  writeJson(response, 400, { error: "invalid_request", message: "Provide userId, idpSubject, or activeSubjects." });
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Standard bearer-token Enterprise gate for the admin/extension-facing routes.
 * Returns the AuthContext or undefined (response already written).
 */
async function requireEnterpriseBearer(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<{ orgId: string; apiKeyId: string } | undefined> {
  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth)) {
    writeJson(response, 401, { error: "unauthorized" });
    return undefined;
  }
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return undefined;
  }
  if (!(await requireOrgPlan(deps.orgStore, auth, response, "enterprise"))) {
    return undefined;
  }
  return { orgId: auth.orgId, apiKeyId: auth.apiKeyId };
}

function encodeRelayState(state: RelayState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeRelayState(raw: string | null | undefined): RelayState | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<RelayState>;
    if (parsed && typeof parsed.orgId === "string" && parsed.orgId) {
      return { orgId: parsed.orgId, redirect: sanitizeRedirect(parsed.redirect) };
    }
  } catch {
    // Not our encoded RelayState — fall through.
  }
  // Tolerate a bare orgId (UUID) as RelayState for simple integrations.
  if (/^[0-9a-fA-F-]{16,}$/.test(raw)) {
    return { orgId: raw };
  }
  return undefined;
}

/** Only allow handing the session token to a vscode: deep link or https URL. */
function sanitizeRedirect(redirect: string | null | undefined): string | undefined {
  if (!redirect) {
    return undefined;
  }
  try {
    const url = new URL(redirect);
    if (url.protocol === "vscode:" || url.protocol === "vscode-insiders:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // not a valid URL
  }
  return undefined;
}

function deliverSession(response: ServerResponse, token: string, redirect?: string): void {
  if (redirect) {
    const separator = redirect.includes("#") ? "&" : "#";
    const location = `${redirect}${separator}coopToken=${encodeURIComponent(token)}`;
    response.writeHead(302, { location });
    response.end();
    return;
  }
  // No redirect target: render a minimal page with the token to copy into the
  // extension. (API-only scope — intentionally not a styled UI.)
  const safeToken = escapeHtml(token);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CoopAI sign-in complete</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Signed in</h1>
<p>Copy this token into CoopAI to finish signing in:</p>
<pre style="white-space:pre-wrap;word-break:break-all;background:#f4f4f5;padding:1rem;border-radius:8px">${safeToken}</pre>
</body></html>`;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function readForm(parsed: ParsedRequest): URLSearchParams {
  if (typeof parsed.rawBody === "string" && parsed.rawBody.length > 0) {
    return new URLSearchParams(parsed.rawBody);
  }
  if (typeof parsed.body === "string" && parsed.body.length > 0) {
    return new URLSearchParams(parsed.body);
  }
  if (parsed.body && typeof parsed.body === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed.body as Record<string, unknown>)) {
      params.set(key, String(value));
    }
    return params;
  }
  return new URLSearchParams();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorMessage(error: unknown): string {
  return error instanceof SsoConfigError || error instanceof Error ? error.message : String(error);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
