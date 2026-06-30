import type { EmailService } from "../email/emailService";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { BillingConfig } from "./billingConfig";
import { adminPortalLoginUrl } from "./adminPortalUrl";

export type ProvisionInput = {
  orgName: string;
  adminEmail: string;
  seatCount: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  existingOrgId?: string;
  upgrade?: boolean;
};

export type ProvisionResult = {
  orgId: string;
  orgName: string;
  adminApiKey: string;
};

export async function provisionOrgFromCheckout(
  orgStore: OrgStore,
  userStore: UserStore,
  emailService: EmailService,
  billingConfig: BillingConfig,
  input: ProvisionInput
): Promise<ProvisionResult> {
  const loginUrl = adminPortalLoginUrl(billingConfig.adminPortalUrl);

  if (input.existingOrgId && input.upgrade) {
    const org = await orgStore.getOrganization(input.existingOrgId);
    if (!org) {
      throw new Error(`Upgrade target org not found: ${input.existingOrgId}`);
    }
    await orgStore.setOrganizationPlan(org.id, "pro");
    await orgStore.updateOrganizationBilling(org.id, {
      billingEmail: input.adminEmail,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      seatCount: input.seatCount,
      billingStatus: "active"
    });
    return { orgId: org.id, orgName: org.name, adminApiKey: "[existing org — key unchanged]" };
  }

  const existing = await orgStore.findOrganizationByStripeCustomerId(input.stripeCustomerId);

  if (existing) {
    const keys = await orgStore.listApiKeys(existing.id);
    if (keys.length > 0) {
      return { orgId: existing.id, orgName: existing.name, adminApiKey: "[existing org — key not re-sent]" };
    }
    const { rawKey } = await orgStore.createApiKey(existing.id, "admin portal");
    await emailService.sendWelcome({
      to: input.adminEmail,
      orgName: existing.name,
      adminPortalUrl: loginUrl,
      apiKey: rawKey
    });
    return { orgId: existing.id, orgName: existing.name, adminApiKey: rawKey };
  }

  const org = await orgStore.createOrganization(input.orgName, "pro");
  await orgStore.updateOrganizationBilling(org.id, {
    billingEmail: input.adminEmail,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    seatCount: input.seatCount,
    billingStatus: "active"
  });

  await userStore.createUser(org.id, input.adminEmail, "owner");
  const { rawKey } = await orgStore.createApiKey(org.id, "admin portal");

  await emailService.sendWelcome({
    to: input.adminEmail,
    orgName: org.name,
    adminPortalUrl: loginUrl,
    apiKey: rawKey
  });

  return { orgId: org.id, orgName: org.name, adminApiKey: rawKey };
}
