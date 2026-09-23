import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { auditActor } from "./audit/auditLogger";
import { resolveOrgPlanFromDb } from "./authMiddleware";
import { requireTeamPlan } from "./planGates";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import { resolveEffectiveSeatCount } from "./billing/resolveSeatCount";
import { loadBillingConfig } from "./billing/billingConfig";
import { StripeService } from "./billing/stripeService";
import { displaySeatMix, isMixedSeatInventory, seatInventoryTotal } from "./billing/seatInventory";
import { billingEmailBelongsToOrg, resolveBillingContact } from "./billing/billingEmail";

type ParsedRequest = {
  method: string;
  pathname: string;
  body?: unknown;
};

const ORG_NAME_MAX_LENGTH = 255;

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
      usageTier: org.usageTier ?? (plan === "pro" ? "pro" : null),
      seats: Math.max(1, Math.floor(Number(billing?.seatCount ?? 1) || 1)),
      repoAccessMode: org.repoAccessMode,
      createdAt: org.createdAt,
      memberCount: activeMemberCount,
      integrationSummary,
      onboardingCompleted: Boolean(billing?.onboardingCompletedAt)
    });
    return true;
  }

  if (parsed.method === "PATCH" && parsed.pathname === "/v1/admin/org") {
    const parsedName = parseOrganizationName(asRecord(parsed.body).name);
    if (!parsedName.ok) {
      writeJson(response, 400, { error: parsedName.error, message: parsedName.message });
      return true;
    }
    const renamed = await deps.orgStore!.updateOrganizationName(auth.orgId, parsedName.name);
    if (!renamed.ok && renamed.reason === "taken") {
      writeJson(response, 409, {
        error: "org_name_taken",
        message: "Another organization already uses that name."
      });
      return true;
    }
    if (!renamed.ok) {
      writeJson(response, 404, { error: "organization not found" });
      return true;
    }
    if (renamed.changed) {
      const actor = auditActor(auth);
      await deps.auditLogger?.record({
        orgId: auth.orgId,
        userId: actor.userId,
        principal: actor.principal,
        action: "admin.org.rename",
        metadata: { previousName: renamed.previousName, name: renamed.org.name }
      });
    }
    writeJson(response, 200, {
      id: renamed.org.id,
      name: renamed.org.name,
      plan: renamed.org.plan
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
    const seats = await resolveEffectiveSeatCount(deps.orgStore!, auth.orgId, billing);
    let stripeSeats: number | null = null;
    if (billing?.stripeSubscriptionId) {
      const stripe = new StripeService(loadBillingConfig());
      if (stripe.isConfigured()) {
        try {
          const subscription = await stripe.retrieveSubscription(billing.stripeSubscriptionId);
          if (subscription.quantity != null) {
            stripeSeats = Math.max(1, Math.floor(Number(subscription.quantity) || 1));
          }
        } catch {
          // Optional diagnostic field — leave null if Stripe is unavailable.
        }
      }
    }

    const users = deps.userStore ? await deps.userStore.listOrgUsers(auth.orgId) : [];
    const contact = resolveBillingContact({ storedEmail: billing?.billingEmail, users });
    if (contact.healed && contact.email) {
      await deps.orgStore!.updateOrganizationBilling(auth.orgId, { billingEmail: contact.email });
    }

    writeJson(response, 200, {
      plan,
      usageTier: billing?.usageTier ?? (plan === "pro" ? "pro" : null),
      seats,
      stripeSeats,
      status: billing?.billingStatus ?? "manual",
      billingEmail: contact.email,
      billingEmailOptions: contact.options,
      hasStripeCustomer: Boolean(billing?.stripeCustomerId),
      seatInventory: billing?.seatInventory,
      seatMix:
        billing?.seatInventory && seatInventoryTotal(billing.seatInventory) > 0
          ? displaySeatMix(billing.seatInventory)
          : undefined,
      mixedSeats: billing?.seatInventory ? isMixedSeatInventory(billing.seatInventory) : false
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/billing/email") {
    if (!deps.userStore) {
      writeJson(response, 503, { error: "user store not configured" });
      return true;
    }
    const email = String(asRecord(parsed.body).email ?? "")
      .trim()
      .toLowerCase();
    const users = await deps.userStore.listOrgUsers(auth.orgId);
    if (!billingEmailBelongsToOrg(email, users)) {
      writeJson(response, 400, {
        error: "invalid_billing_email",
        message: "Billing email must be an active member of this organization."
      });
      return true;
    }
    await deps.orgStore!.updateOrganizationBilling(auth.orgId, { billingEmail: email });
    writeJson(response, 200, { billingEmail: email, billingEmailOptions: resolveBillingContact({ storedEmail: email, users }).options });
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

export function parseOrganizationName(
  value: unknown
): { ok: true; name: string } | { ok: false; error: string; message: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "invalid_org_name", message: "Enter an organization name." };
  }
  const trimmed = value.trim();
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return {
      ok: false,
      error: "invalid_org_name",
      message: "Organization name can't include line breaks."
    };
  }
  const name = trimmed.replace(/\s+/g, " ");
  if (!name) {
    return { ok: false, error: "invalid_org_name", message: "Enter an organization name." };
  }
  if (name.length > ORG_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: "invalid_org_name",
      message: "Organization name must be 255 characters or fewer."
    };
  }
  return { ok: true, name };
}
