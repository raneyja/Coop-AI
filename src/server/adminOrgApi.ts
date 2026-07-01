import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { resolveOrgPlanFromDb } from "./authMiddleware";
import { createPlanQuotaService } from "./planQuota";
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

    const billing = await deps.orgStore!.getOrganizationBilling(auth.orgId);
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
    const billing = await deps.orgStore!.getOrganizationBilling(auth.orgId);
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
    await deps.orgStore!.markOnboardingComplete(auth.orgId);
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/quota") {
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? auth.plan;
    if (plan !== "free") {
      writeJson(response, 200, { plan, unlimited: true });
      return true;
    }
    const planQuota = createPlanQuotaService(deps.usageTracker);
    const snapshot = await planQuota.getSnapshot(auth.orgId, plan);
    if (!snapshot) {
      writeJson(response, 200, { plan, unlimited: true });
      return true;
    }
    writeJson(response, 200, { ...snapshot, plan });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/enterprise-upgrade-request") {
    const body = asRecord(parsed.body);
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const orgName = String(body.orgName ?? auth.orgName ?? "").trim();
    const notes = String(body.notes ?? "").trim();
    if (!name || !email || !orgName) {
      writeJson(response, 400, { error: "name, email, and orgName are required" });
      return true;
    }
    await deps.auditLogger?.record({
      orgId: auth.orgId,
      action: "billing.enterprise_upgrade_request",
      metadata: { name, email, orgName, notes: notes || undefined }
    });
    console.info("[admin] enterprise upgrade request", { orgId: auth.orgId, name, email, orgName, notes });
    writeJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
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
