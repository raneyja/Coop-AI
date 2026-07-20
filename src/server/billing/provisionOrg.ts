import type { AuthTokenStore } from "../auth/authTokenStore";
import type { EmailService } from "../email/emailService";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { BillingConfig } from "./billingConfig";
import { adminPortalAcceptInviteUrl, adminPortalFreshLoginUrl } from "./adminPortalUrl";

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
  input: ProvisionInput,
  authTokenStore?: AuthTokenStore
): Promise<ProvisionResult> {
  const loginUrl = adminPortalFreshLoginUrl(billingConfig.adminPortalUrl, {
    email: input.adminEmail
  });

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
  let activateAccountUrl: string | undefined;

  if (!existingUser) {
    const user = await userStore.createUser(org.id, input.adminEmail, "admin");
    // Industry-standard paid signup: activate account (set password) before first sign-in.
    if (authTokenStore) {
      const inviteToken = await authTokenStore.createToken(
        user.id,
        "user_invite",
        7 * 24 * 60 * 60 * 1000,
        { orgName: org.name, source: "checkout" }
      );
      activateAccountUrl = adminPortalAcceptInviteUrl(billingConfig.adminPortalUrl, inviteToken);
    } else {
      console.warn("[billing] auth token store missing; welcome email will link to sign-in only");
    }
  }

  await emailService.sendWelcome({
    to: input.adminEmail,
    orgName: org.name,
    adminPortalUrl: loginUrl,
    activateAccountUrl
  });

  return { orgId: org.id, orgName: org.name };
}
