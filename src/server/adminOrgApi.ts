import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { resolveOrgPlanFromDb } from "./authMiddleware";
import { writeJson, type AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
  body?: unknown;
};

const TRACKED_PROVIDERS = [
  "github",
  "gitlab",
  "bitbucket",
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
] as const;

export async function handleAdminOrgRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/org") {
    const org = await deps.orgStore!.getOrganization(auth.orgId);
    if (!org) {
      writeJson(response, 404, { error: "organization not found" });
      return true;
    }
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? org.plan;
    const users = deps.userStore ? await deps.userStore.listOrgUsers(auth.orgId) : [];
    const activeMemberCount = users.filter((user) => !user.deactivatedAt).length;
    const integrationSummary = await buildIntegrationSummary(deps, auth.orgId);

    const billing = await deps.orgStore.getOrganizationBilling(auth.orgId);
    writeJson(response, 200, {
      id: org.id,
      name: org.name,
      plan,
      createdAt: org.createdAt,
      memberCount: activeMemberCount,
      integrationSummary,
      onboardingCompleted: Boolean(billing?.onboardingCompletedAt)
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/billing") {
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? auth.plan;
    const billing = await deps.orgStore.getOrganizationBilling(auth.orgId);
    writeJson(response, 200, {
      plan,
      seats: billing?.seatCount ?? null,
      status: billing?.billingStatus ?? "manual",
      billingEmail: billing?.billingEmail,
      hasStripeCustomer: Boolean(billing?.stripeCustomerId)
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/onboarding/complete") {
    await deps.orgStore.markOnboardingComplete(auth.orgId);
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

async function buildIntegrationSummary(deps: AdminApiDeps, orgId: string) {
  const installed: string[] = [];
  for (const provider of TRACKED_PROVIDERS) {
    if (provider === "github" || provider === "gitlab" || provider === "bitbucket") {
      const installation = await deps.orgStore!.getCodeHostInstallation(orgId, provider);
      if (installation) {
        installed.push(provider);
      }
      continue;
    }
    const connection = deps.integrationStore
      ? await deps.integrationStore.get(orgId, provider as IntegrationProvider)
      : undefined;
    if (connection) {
      installed.push(provider);
    }
  }
  return {
    installedCount: installed.length,
    totalProviders: TRACKED_PROVIDERS.length,
    installed
  };
}
