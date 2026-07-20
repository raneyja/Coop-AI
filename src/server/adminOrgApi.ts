import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { resolveOrgPlanFromDb } from "./authMiddleware";
import { requireTeamPlan } from "./planGates";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import { loadBillingConfig } from "./billing/billingConfig";
import { StripeService } from "./billing/stripeService";

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
      repoAccessMode: org.repoAccessMode,
      createdAt: org.createdAt,
      memberCount: activeMemberCount,
      integrationSummary,
      onboardingCompleted: Boolean(billing?.onboardingCompletedAt)
    });
    return true;
  }

  if (parsed.method === "PATCH" && parsed.pathname === "/v1/admin/org/repo-access") {
    if (!(await requireTeamPlan(deps.orgStore, auth, response))) {
      return true;
    }
    const body = asRecord(parsed.body);
    const mode = String(body.repoAccessMode ?? "").trim();
    if (mode !== "all_indexed" && mode !== "per_user") {
      writeJson(response, 400, {
        error: "invalid_repo_access_mode",
        message: "repoAccessMode must be all_indexed or per_user."
      });
      return true;
    }
    const org = await deps.orgStore!.updateRepoAccessMode(auth.orgId, mode);
    if (!org) {
      writeJson(response, 404, { error: "organization not found" });
      return true;
    }
    writeJson(response, 200, {
      id: org.id,
      name: org.name,
      plan: org.plan,
      repoAccessMode: org.repoAccessMode
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/billing") {
    const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? auth.plan;
    const billing = await deps.orgStore!.getOrganizationBilling(auth.orgId);
    let seats = billing?.seatCount ?? null;
    let stripeSeats: number | null = null;

    // Prefer Stripe quantity when ahead of Coop (e.g. webhook lag after a confirmed seat change).
    if (billing?.stripeSubscriptionId) {
      const stripe = new StripeService(loadBillingConfig());
      if (stripe.isConfigured()) {
        try {
          const subscription = await stripe.retrieveSubscription(billing.stripeSubscriptionId);
          if (subscription.quantity != null) {
            stripeSeats = Math.max(1, Math.floor(Number(subscription.quantity) || 1));
            if (seats == null || stripeSeats > seats) {
              await deps.orgStore!.updateOrganizationBilling(auth.orgId, { seatCount: stripeSeats });
              seats = stripeSeats;
            }
          }
        } catch {
          // Leave Coop seats if Stripe is temporarily unavailable.
        }
      }
    }

    writeJson(response, 200, {
      plan,
      seats,
      stripeSeats,
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
