import type { ServerResponse } from "node:http";
import type { OrgPlan } from "./orgStore";
import { canUseLightningPlan, type AuthContext, type OrgStore } from "./orgStore";
import type { UserStore } from "./users/userStore";

export type AuthenticatedRequest = {
  auth?: AuthContext;
};

export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

export type AuthResolveResult = {
  auth?: AuthContext;
  orgSuspended?: boolean;
};

export async function checkOrgNotSuspended(
  orgStore: OrgStore | undefined,
  orgId: string
): Promise<boolean> {
  if (!orgStore || orgId === "legacy") {
    return true;
  }
  return !(await orgStore.isOrgSuspended(orgId));
}

export function writeOrgSuspended(response: ServerResponse): void {
  writeJson(response, 403, {
    error: "org_suspended",
    message: "This organization has been suspended."
  });
}

export async function resolveAuthContextDetailed(
  headers: Record<string, string | undefined>,
  orgStore: OrgStore | undefined,
  legacyApiToken?: string,
  requireApiAuth = false,
  userStore?: UserStore
): Promise<AuthResolveResult> {
  const auth = await resolveAuthContext(
    headers,
    orgStore,
    legacyApiToken,
    requireApiAuth,
    userStore
  );
  if (!auth) {
    return {};
  }
  if (!(await checkOrgNotSuspended(orgStore, auth.orgId))) {
    return { orgSuspended: true };
  }
  return { auth };
}

export async function resolveAuthContext(
  headers: Record<string, string | undefined>,
  orgStore: OrgStore | undefined,
  legacyApiToken?: string,
  requireApiAuth = false,
  userStore?: UserStore
): Promise<AuthContext | undefined> {
  const token = extractBearerToken(headers);
  if (!token) {
    return undefined;
  }

  // 1. Org API key (Free/Pro). Checked first so this path is byte-for-byte
  //    unchanged; an SSO session token will never match an api_keys hash.
  if (orgStore) {
    const orgAuth = await orgStore.resolveAuth(token);
    if (orgAuth) {
      return orgAuth;
    }
  }

  // 2. Enterprise SSO session token. resolveUserSession returns undefined for
  //    unknown, expired, OR deactivated users — the offboarding 401 path.
  if (userStore) {
    const session = await userStore.resolveUserSession(token);
    if (session) {
      return {
        orgId: session.orgId,
        orgName: session.orgName,
        plan: session.plan,
        apiKeyId: `session:${session.userId}`,
        userId: session.userId,
        role: session.role,
        sessionProvider: session.authProvider,
        email: session.email
      };
    }
  }

  if (!requireApiAuth && legacyApiToken && token === legacyApiToken) {
    return {
      orgId: "legacy",
      orgName: "Legacy",
      plan: "pro",
      apiKeyId: "legacy"
    };
  }

  // Local dev only: when API auth is not required, accept any bearer token (e.g. "dev").
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (!requireApiAuth && nodeEnv !== "production" && token) {
    return {
      orgId: "legacy",
      orgName: "Legacy",
      plan: "pro",
      apiKeyId: "legacy-dev"
    };
  }

  return undefined;
}

export function requireAuth(
  auth: AuthContext | undefined,
  requireInProduction: boolean
): auth is AuthContext {
  if (auth) {
    return true;
  }
  return !requireInProduction;
}

/** Reads the org plan from the database (never from the client). */
export async function resolveOrgPlanFromDb(
  orgStore: OrgStore | undefined,
  auth: AuthContext
): Promise<OrgPlan | undefined> {
  if (auth.orgId === "legacy") {
    return auth.plan;
  }
  if (!orgStore) {
    return undefined;
  }
  const org = await orgStore.getOrganization(auth.orgId);
  return org?.plan;
}

export function isPlanAllowed(plan: OrgPlan, allowedPlans: readonly OrgPlan[]): boolean {
  return allowedPlans.includes(plan);
}

/**
 * Allow-list plan gate. Re-loads plan from the database on every call.
 * Writes 403 and returns false when the plan is not allowed.
 */
export async function requireOrgPlan(
  orgStore: OrgStore | undefined,
  auth: AuthContext,
  response: ServerResponse,
  ...allowedPlans: OrgPlan[]
): Promise<boolean> {
  const plan = await resolveOrgPlanFromDb(orgStore, auth);
  if (!plan || !isPlanAllowed(plan, allowedPlans)) {
    writePlanForbidden(response, allowedPlans);
    return false;
  }
  return true;
}

export function writePlanForbidden(response: ServerResponse, requiredPlans: readonly OrgPlan[]): void {
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      error: "plan_required",
      message: `This endpoint requires one of: ${requiredPlans.join(", ")}`,
      requiredPlans
    })
  );
}

export async function lightningAllowed(
  orgStore: OrgStore | undefined,
  auth: AuthContext
): Promise<boolean> {
  const plan = await resolveOrgPlanFromDb(orgStore, auth);
  return plan !== undefined && canUseLightningPlan(plan);
}

/**
 * Stable principal id for the actor behind a request.
 *  - Enterprise SSO: the human user id.
 *  - Org API key / legacy: `apikey:<apiKeyId>` (never the bare org id).
 */
export function authUserId(auth: AuthContext): string {
  if (auth.userId) {
    return auth.userId;
  }
  return `apikey:${auth.apiKeyId}`;
}

const INTEGRATION_ADMIN_ROLES = new Set(["owner", "admin"]);

/** Org API keys (no human userId) may install integrations during bootstrap. */
export function canInstallIntegrations(auth: AuthContext): boolean {
  if (!auth.userId) {
    return true;
  }
  return INTEGRATION_ADMIN_ROLES.has(String(auth.role ?? "").toLowerCase());
}

/** Owner/admin for SSO sessions; org API keys pass for bootstrap provisioning. */
export function canOrgAdmin(auth: AuthContext): boolean {
  return canInstallIntegrations(auth);
}

export function requireOrgAdmin(
  auth: AuthContext | undefined,
  response: ServerResponse
): auth is AuthContext {
  if (!auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return false;
  }
  if (!canOrgAdmin(auth)) {
    writeJson(response, 403, {
      error: "admin_required",
      message: "Only organization owners and admins can access this endpoint."
    });
    return false;
  }
  return true;
}

export function requireInstallAdmin(
  auth: AuthContext | undefined,
  response: ServerResponse
): auth is AuthContext {
  if (!auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return false;
  }
  if (!canInstallIntegrations(auth)) {
    writeJson(response, 403, {
      error: "admin_required",
      message: "Only organization admins can connect code hosts."
    });
    return false;
  }
  return true;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
