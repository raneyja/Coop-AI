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
    await emailService.sendProUpgradeWelcome({
      to: input.adminEmail,
      orgName: org.name,
      adminPortalUrl: loginUrl
    });
    return { orgId: org.id, orgName: org.name };
  }

  const existing = await orgStore.findOrganizationByStripeCustomerId(input.stripeCustomerId);

  if (existing) {
    await emailService.sendWelcome({
      to: input.adminEmail,
      orgName: existing.name,
      adminPortalUrl: loginUrl
    });
    return { orgId: existing.id, orgName: existing.name };
  }

  const org = await orgStore.createOrganization(input.orgName, "pro");
  await orgStore.updateOrganizationBilling(org.id, {
    billingEmail: input.adminEmail,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    seatCount: input.seatCount,
    billingStatus: "active"
  });

  const existingUser = await userStore.findActiveUserByEmail(input.adminEmail);
  if (!existingUser) {
    await userStore.createUser(org.id, input.adminEmail, "admin");
  }

  await emailService.sendWelcome({
    to: input.adminEmail,
    orgName: org.name,
    adminPortalUrl: loginUrl
  });

  return { orgId: org.id, orgName: org.name };
}
