import type { ServerResponse } from "node:http";
import { requireAuth, requireOrgPlan, resolveAuthContext } from "../authMiddleware";
import { AuditLogger, principalForApiKey, principalForUser } from "../audit/auditLogger";
import {
  authRedirectAllowlistFromConfig,
  deliverAuthError,
  deliverSessionToken,
  sanitizeAuthRedirect,
  type AuthRedirectAllowlist
} from "../auth/sessionDelivery";
import type { AuthConfig } from "../auth/authConfig";
import type { OrgStore } from "../orgStore";
import type { ServerConfig } from "../serverConfig";
import type { UserStore } from "../users/userStore";
import { SamlRequestStateError } from "./samlRequestStore";
import { IdpIdentityError } from "../users/userStore";
import { SsoConfigError, samlCookieName, type SamlService, type SamlAssertion } from "./samlService";
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
  /** When set, post-login redirects are origin-allowlisted (tokens in fragment). */
  authConfig?: AuthConfig;
};

type RelayState = {
  orgId: string;
  redirect?: string;
  /**
   * `test` = admin SSO settings diagnostic. Validates the IdP assertion, then
   * returns a pass/fail redirect — never creates a Coop session or swaps users.
   */
  mode?: "login" | "test";
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
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");

  if (!deps.orgStore || !deps.userStore || !deps.ssoConfigStore || !deps.samlService) {
    writeJson(response, 503, { error: "sso_unavailable", message: "Enterprise SSO is not configured on this server." });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === `${SAML_PREFIX}/metadata`) {
    return handleMetadata(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${SAML_PREFIX}/continue`) {
    return handleContinue(parsed, response, deps);
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
  const redirect = sanitizeSamlRedirect(parsed.query?.get("redirect"), deps);
  if (parsed.query?.get("redirect") && !redirect) {
    writeJson(response, 400, { error: "invalid_redirect" });
    return true;
  }
  const preferJson = parsed.query?.get("format") === "json";
  const mode = parsed.query?.get("mode")?.trim() === "test" ? "test" : "login";

  let resolvedOrgId = orgId;
  if (!resolvedOrgId && orgName) {
    const org = await deps.orgStore!.findOrganizationByName(orgName);
    resolvedOrgId = org?.id;
  }
  if (!resolvedOrgId) {
    respondBrowserOrJson(
      response,
      preferJson,
      redirect,
      400,
      "missing_org",
      "Provide orgId or org (organization name) to start SSO."
    );
    return true;
  }

  const org = await deps.orgStore!.getOrganization(resolvedOrgId);
  if (!org || org.plan !== "enterprise" || await deps.orgStore!.isOrgSuspended(org.id)) {
    respondBrowserOrJson(
      response,
      preferJson,
      redirect,
      403,
      "plan_required",
      "SSO is available on the Enterprise plan only."
    );
    return true;
  }

  const config = await deps.ssoConfigStore!.getEnabledConfig(resolvedOrgId);
  if (!config) {
    respondBrowserOrJson(
      response,
      preferJson,
      redirect,
      409,
      "sso_not_configured",
      "SSO is not enabled for this organization."
    );
    return true;
  }

  try {
    const url = await deps.samlService!.beginLogin(config, { redirect, mode });
    if (preferJson) {
      writeJson(response, 200, { redirectUrl: url });
    } else {
      response.writeHead(302, { location: url });
      response.end();
    }
  } catch (error) {
    respondBrowserOrJson(
      response,
      preferJson,
      redirect,
      502,
      "sso_login_failed",
      "SSO sign-in could not start. Contact your organization administrator."
    );
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

  const redirect = sanitizeSamlRedirect(parsed.query?.get("redirect"), deps);
  if (parsed.query?.get("redirect") && !redirect) {
    writeJson(response, 400, { error: "invalid_redirect" });
    return true;
  }
  const preferJson = parsed.query?.get("format") === "json";

  const config = await deps.ssoConfigStore!.getEnabledConfig(auth.orgId);
  if (!config) {
    respondBrowserOrJson(
      response,
      preferJson,
      redirect,
      409,
      "sso_not_configured",
      "No enabled SSO configuration for this org."
    );
    return true;
  }


  try {
    const url = await deps.samlService!.beginLogin(config, { redirect, mode: "login" });
    if (preferJson) {
      writeJson(response, 200, { redirectUrl: url });
    } else {
      response.writeHead(302, { location: url });
      response.end();
    }
  } catch (error) {
    respondBrowserOrJson(
      response,
      preferJson,
      redirect,
      502,
      "sso_login_failed",
      "SSO sign-in could not start. Contact your organization administrator."
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /v1/auth/saml/callback  — UNAUTHENTICATED browser POST from the IdP.
// Cannot carry a CoopAI bearer token. Gating is enforced by:
//   (1) resolving a pending opaque state bound to the initiating browser, and
//   (2) requiring that org's plan === 'enterprise' AND SSO is enabled.
// Trust in the assertion itself comes from SAML signature validation.
// ---------------------------------------------------------------------------
async function handleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: SamlApiDeps
): Promise<boolean> {
  // CRITICAL: requires rawBody (application/x-www-form-urlencoded) — webhookServer must pass rawBody for this route or SAMLResponse will be missing.
  if (!parsed.headers["content-type"]?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    writeJson(response, 415, { error: "unsupported_media_type" });
    return true;
  }
  const form = readForm(parsed);
  if (form.getAll("RelayState").length > 1 || form.getAll("SAMLResponse").length > 1) {
    writeJson(response, 400, { error: "invalid_saml_form" });
    return true;
  }
  const relayToken = form.get("RelayState") ?? "";
  const state = await deps.samlService!.getLoginState(relayToken, parsed.headers.cookie);
  const earlyRelay = state && { orgId: state.orgId, redirect: state.redirect, mode: state.mode };

  const samlResponse = form.get("SAMLResponse");
  if (!samlResponse) {
    respondCallbackError(
      response,
      earlyRelay,
      400,
      "missing_saml_response",
      "The identity provider did not return a SAML response."
    );
    return true;
  }

  const relay = earlyRelay;
  if (!relay?.orgId) {
    respondCallbackError(
      response,
      undefined,
      400,
      "missing_relay_state",
      "A pending browser-bound SP-initiated login is required."
    );
    return true;
  }

  if (relay.redirect && sanitizeSamlRedirect(relay.redirect, deps) !== relay.redirect) {
    writeJson(response, 400, { error: "invalid_redirect" });
    return true;
  }

  // Enterprise-plan gate, resolved from durable state rather than client JSON.
  const org = await deps.orgStore!.getOrganization(relay.orgId);
  if (!org || org.plan !== "enterprise" || await deps.orgStore!.isOrgSuspended(org.id)) {
    respondCallbackError(
      response,
      relay,
      403,
      "plan_required",
      "SSO is available on the Enterprise plan only."
    );
    return true;
  }

  const config = await deps.ssoConfigStore!.getEnabledConfig(relay.orgId);
  if (!config) {
    respondCallbackError(
      response,
      relay,
      403,
      "sso_not_configured",
      "SSO is not enabled for this organization."
    );
    return true;
  }

  let assertion: SamlAssertion | undefined;
  let accepted;
  try {
    const verified = await deps.samlService!.validateCallback(config, samlResponse, state!);
    assertion = verified;
    accepted = await deps.samlService!.acceptCallback(config, samlResponse, state!, async (verified, transaction) => {
      if (relay.mode === "test") return undefined;
      const user = await deps.userStore!.upsertUserFromIdp({ orgId: relay.orgId,
        email: verified.email, idpSubject: verified.idpSubject, idpProvider: verified.idpProvider }, transaction);
      const session = await deps.userStore!.createSession(user.id, relay.orgId, {
        ttlMs: deps.serverConfig.ssoSessionTtlMs, authProvider: "saml", samlConfigHash: state!.configHash, transaction
      });
      return { user, session };
    });
  } catch (error) {
    if (error instanceof IdpIdentityError) {
      respondCallbackError(response, relay, 403, "sso_account_unavailable", "Contact your organization administrator to restore access.");
      return true;
    }
    if (!(error instanceof SsoConfigError) && !(error instanceof SamlRequestStateError)
      && assertion) throw error;
    // Signature/binding failure or current-eligibility denial: no session effects.
    respondCallbackError(
      response,
      relay,
      401,
      "saml_validation_failed",
      "The SAML response could not be verified. Start sign-in again."
    );
    return true;
  }

  if (!assertion) throw new Error("SAML validation returned no identity");
  response.setHeader("set-cookie", `${samlCookieName(relayToken)}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`);

  // Admin "Test connection" — validate only; do not create/swap sessions.
  if (relay.mode === "test") {
    await deps.auditLogger?.record({
      orgId: relay.orgId,
      principal: principalForApiKey("sso-test"),
      action: "auth.saml.test",
      metadata: {
        idpProvider: assertion.idpProvider,
        email: assertion.email,
        result: "passed"
      }
    });
    deliverSsoTestResult(response, relay.redirect, {
      result: "passed",
      email: assertion.email,
      provider: assertion.idpProvider
    });
    return true;
  }

  if (!accepted) throw new Error("SAML login admission returned no session");
  const { user, session } = accepted;

  await deps.auditLogger?.record({
    orgId: relay.orgId,
    userId: user.id,
    principal: principalForUser(user.id),
    action: "auth.saml.login",
    metadata: { idpProvider: assertion.idpProvider, email: user.email }
  });

  deliverSessionToken(response, session.token, relay.redirect);
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
    const changed = await deps.userStore!.deactivateByIdpSubject(auth.orgId, config.provider, idpSubject);
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

async function handleContinue(parsed: ParsedRequest, response: ServerResponse, deps: SamlApiDeps): Promise<boolean> {
  try {
    const relay = parsed.query?.get("RelayState") ?? "";
    const login = await deps.samlService!.continueLogin(relay);
    response.writeHead(302, { location: login.authorizeUrl, "set-cookie": login.cookie,
      "cache-control": "no-store", "referrer-policy": "no-referrer" });
    response.end();
  } catch {
    writeJson(response, 400, { error: "invalid_saml_state", message: "Start sign-in again." });
  }
  return true;
}

function sanitizeSamlRedirect(
  redirect: string | null | undefined,
  deps: { authConfig?: AuthConfig }
): string | undefined {
  // Without allowlist origins we still accept vscode: callbacks (extension),
  // but reject https token handoffs to avoid open redirects.
  const allowlist: AuthRedirectAllowlist | undefined = deps.authConfig
    ? authRedirectAllowlistFromConfig(deps.authConfig)
    : undefined;
  const safe = sanitizeAuthRedirect(redirect, allowlist);
  if (!safe) return undefined;
  const url = new URL(safe);
  if (url.username || url.password || url.hash) return undefined;
  if (["vscode:", "vscode-insiders:", "cursor:", "cursor-insiders:"].includes(url.protocol)
    && (url.hostname !== "coop-ai.coop-ai" || url.pathname !== "/auth/callback")) return undefined;
  return safe;
}

function deliverSsoTestResult(
  response: ServerResponse,
  redirect: string | undefined,
  outcome:
    | { result: "passed"; email: string; provider: string }
    | { result: "failed"; error: string; message: string }
): void {
  if (!redirect) {
    writeJson(response, outcome.result === "passed" ? 200 : 401, outcome);
    return;
  }
  try {
    const target = new URL(redirect);
    target.searchParams.set("sso_test", outcome.result);
    if (outcome.result === "passed") {
      target.searchParams.set("email", outcome.email);
      target.searchParams.set("provider", outcome.provider);
    } else {
      target.searchParams.set("error", outcome.error);
      target.searchParams.set("message", outcome.message);
    }
    response.writeHead(302, { location: target.toString() });
    response.end();
  } catch {
    writeJson(response, outcome.result === "passed" ? 200 : 401, outcome);
  }
}

function respondBrowserOrJson(
  response: ServerResponse,
  preferJson: boolean,
  redirect: string | undefined,
  statusCode: number,
  error: string,
  message: string
): void {
  if (!preferJson && redirect) {
    deliverAuthError(response, redirect, error, message, statusCode);
    return;
  }
  writeJson(response, statusCode, { error, message });
}

function respondCallbackError(
  response: ServerResponse,
  relay: RelayState | undefined,
  statusCode: number,
  error: string,
  message: string
): void {
  if (relay?.mode === "test") {
    deliverSsoTestResult(response, relay.redirect, { result: "failed", error, message });
    return;
  }
  if (relay?.redirect) {
    deliverAuthError(response, relay.redirect, error, message, statusCode);
    return;
  }
  writeJson(response, statusCode, { error, message });
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


function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
