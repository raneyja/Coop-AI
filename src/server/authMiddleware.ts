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
  legacyApiToken?: string
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

  if (legacyApiToken && token === legacyApiToken) {
    return {
      orgId: "legacy",
      orgName: "Legacy",
      plan: "team",
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

export function requirePlan(auth: AuthContext, minimum: OrgPlan): boolean {
  const order: Record<OrgPlan, number> = { free: 0, team: 1, enterprise: 2 };
  return order[auth.plan] >= order[minimum];
}

export function lightningAllowed(auth: AuthContext): boolean {
  return canUseLightningPlan(auth.plan);
}

export function authUserId(auth: AuthContext): string {
  return auth.orgId;
}
