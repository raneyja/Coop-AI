import type { AuthIdentityStore } from "../auth/authIdentityStore";
import type { AuthTokenStore } from "../auth/authTokenStore";
import type { EmailService } from "../email/emailService";
import type { Organization, OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { BillingConfig } from "./billingConfig";
import { adminPortalAcceptInviteUrl, adminPortalFreshLoginUrl } from "./adminPortalUrl";
import type { SeatInventory } from "./seatInventory";
import type { UsageTier } from "../usageTiers";

export type ProvisionInput = {
  orgName: string;
  adminEmail: string;
  seatCount: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  existingOrgId?: string;
  upgrade?: boolean;
  usageTier?: UsageTier;
  stripePriceId?: string;
  googleSub?: string;
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
  authTokenStore?: AuthTokenStore,
  authIdentityStore?: AuthIdentityStore
): Promise<ProvisionResult> {
  const loginUrl = adminPortalFreshLoginUrl(billingConfig.adminPortalUrl, {
    email: input.adminEmail
  });

  const billing = checkoutBillingPatch(input);

  if (input.existingOrgId && input.upgrade) {
    const org = await orgStore.getOrganization(input.existingOrgId);
    if (!org) {
      throw new Error(`Upgrade target org not found: ${input.existingOrgId}`);
    }
    await orgStore.setOrganizationPlan(org.id, "pro");
    await orgStore.updateOrganizationBilling(org.id, billing);
    await userStore.backfillOrgUsersUsageTier(org.id, billing.usageTier);
    await emailService.sendProUpgradeWelcome({
      to: input.adminEmail,
      orgName: org.name,
      adminPortalUrl: loginUrl
    });
    return { orgId: org.id, orgName: org.name };
  }

  const existing = await orgStore.findOrganizationByStripeCustomerId(input.stripeCustomerId);
  const org = existing ?? (await materializeCheckoutOrg(orgStore, input, billing));
  if (existing) {
    await orgStore.updateOrganizationBilling(existing.id, billing);
  }

  const activateAccountUrl = await ensureCheckoutAdmin(
    org,
    userStore,
    billingConfig,
    input,
    authTokenStore,
    authIdentityStore
  );

  await emailService.sendWelcome({
    to: input.adminEmail,
    orgName: org.name,
    adminPortalUrl: loginUrl,
    activateAccountUrl
  });

  return { orgId: org.id, orgName: org.name };
}

type CheckoutBillingPatch = {
  billingEmail: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  seatCount: number;
  billingStatus: "active";
  usageTier: UsageTier;
  stripePriceId: string | null;
  seatInventory: SeatInventory;
};

function checkoutBillingPatch(input: ProvisionInput): CheckoutBillingPatch {
  const usageTier = input.usageTier ?? "pro";
  return {
    billingEmail: input.adminEmail,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    seatCount: input.seatCount,
    billingStatus: "active",
    usageTier,
    stripePriceId: input.stripePriceId ?? null,
    seatInventory: {
      pro: usageTier === "pro" ? input.seatCount : 0,
      pro_plus: usageTier === "pro_plus" ? input.seatCount : 0,
      max: usageTier === "max" ? input.seatCount : 0
    }
  };
}

async function materializeCheckoutOrg(
  orgStore: OrgStore,
  input: ProvisionInput,
  billing: CheckoutBillingPatch
): Promise<Organization> {
  const transactional = orgStore as OrgStore & {
    createOrganizationForCheckout?: OrgStore["createOrganizationForCheckout"];
  };
  if (typeof transactional.createOrganizationForCheckout === "function") {
    return transactional.createOrganizationForCheckout({
      name: input.orgName,
      billingEmail: input.adminEmail,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      seatCount: input.seatCount,
      usageTier: billing.usageTier,
      stripePriceId: input.stripePriceId,
      seatInventory: billing.seatInventory
    });
  }

  const org = await orgStore.createOrganization(input.orgName, "pro");
  try {
    await orgStore.updateOrganizationBilling(org.id, billing);
  } catch (error) {
    const winner = await orgStore.findOrganizationByStripeCustomerId(input.stripeCustomerId);
    if (winner && isUniqueViolation(error)) {
      return winner;
    }
    throw error;
  }
  return org;
}

async function ensureCheckoutAdmin(
  org: Organization,
  userStore: UserStore,
  billingConfig: BillingConfig,
  input: ProvisionInput,
  authTokenStore?: AuthTokenStore,
  authIdentityStore?: AuthIdentityStore
): Promise<string | undefined> {
  const lookup = userStore as UserStore & {
    findOrgUserByEmail?: UserStore["findOrgUserByEmail"];
    ensureMembership?: UserStore["ensureMembership"];
  };

  if (lookup.findOrgUserByEmail) {
    const onOrg = await lookup.findOrgUserByEmail(org.id, input.adminEmail);
    if (onOrg) {
      return undefined;
    }
  }

  const existingUser = await userStore.findActiveUserByEmail(input.adminEmail);
  if (existingUser) {
    if (existingUser.orgId !== org.id && lookup.ensureMembership) {
      await lookup.ensureMembership(existingUser.id, org.id, "admin");
    }
    return undefined;
  }

  const user = await userStore.createUser(org.id, input.adminEmail, "admin", input.usageTier ?? "pro");
  if (input.googleSub && authIdentityStore) {
    await authIdentityStore.createGoogleIdentity(user.id, input.googleSub, new Date());
    return undefined;
  }
  if (authTokenStore) {
    const inviteToken = await authTokenStore.createToken(
      user.id,
      "user_invite",
      7 * 24 * 60 * 60 * 1000,
      { orgName: org.name, source: "checkout" }
    );
    return adminPortalAcceptInviteUrl(billingConfig.adminPortalUrl, inviteToken);
  }
  console.warn("[billing] auth token store missing; welcome email will link to sign-in only");
  return undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
