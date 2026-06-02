import type { ServerResponse } from "node:http";
import type { OrgPlan } from "./orgStore";
import { canUseLightningPlan, type AuthContext, type OrgStore } from "./orgStore";

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

export async function resolveAuthContext(
  headers: Record<string, string | undefined>,
  orgStore: OrgStore | undefined,
  legacyApiToken?: string,
  requireApiAuth = false
): Promise<AuthContext | undefined> {
  const token = extractBearerToken(headers);
  if (!token) {
    return undefined;
  }

  if (orgStore) {
    const orgAuth = await orgStore.resolveAuth(token);
    if (orgAuth) {
      return orgAuth;
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

export function authUserId(auth: AuthContext): string {
  return auth.orgId;
}
