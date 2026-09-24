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
    return linkPaidCheckoutToExistingOrg(org, orgStore, userStore, emailService, input, billing, loginUrl);
  }

  const existing = await orgStore.findOrganizationByStripeCustomerId(input.stripeCustomerId);
  if (!existing) {
    const freeOrg = await findFreeOrgForCheckoutAdmin(
      orgStore,
      userStore,
      input.adminEmail,
      input.stripeCustomerId
    );
    if (freeOrg) {
      return linkPaidCheckoutToExistingOrg(
        freeOrg,
        orgStore,
        userStore,
        emailService,
        input,
        billing,
        loginUrl
      );
    }
  }

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

  await sendCheckoutEmail("welcome email", org.id, () =>
    emailService.sendWelcome({
      to: input.adminEmail,
      orgName: org.name,
      adminPortalUrl: loginUrl,
      activateAccountUrl
    })
  );

  return { orgId: org.id, orgName: org.name };
}

/**
 * Attach a paid subscription to a workspace that already exists.
 * Email failure must not undo the plan and Stripe link.
 */
async function linkPaidCheckoutToExistingOrg(
  org: Organization,
  orgStore: OrgStore,
  userStore: UserStore,
  emailService: EmailService,
  input: ProvisionInput,
  billing: CheckoutBillingPatch,
  loginUrl: string
): Promise<ProvisionResult> {
  await orgStore.setOrganizationPlan(org.id, "pro");
  await orgStore.updateOrganizationBilling(org.id, billing);
  await userStore.backfillOrgUsersUsageTier(org.id, billing.usageTier);
  await sendCheckoutEmail("pro upgrade email", org.id, () =>
    emailService.sendProUpgradeWelcome({
      to: input.adminEmail,
      orgName: org.name,
      adminPortalUrl: loginUrl
    })
  );
  return { orgId: org.id, orgName: org.name };
}

async function findFreeOrgForCheckoutAdmin(
  orgStore: OrgStore,
  userStore: UserStore,
  adminEmail: string,
  stripeCustomerId: string
): Promise<Organization | undefined> {
  const user = await userStore.findActiveUserByEmail(adminEmail);
  if (!user) {
    return undefined;
  }
  const org = await orgStore.getOrganization(user.orgId);
  if (!org || org.plan !== "free") {
    return undefined;
  }
  if (typeof orgStore.getOrganizationBilling === "function") {
    const billing = await orgStore.getOrganizationBilling(org.id);
    const linked = billing?.stripeCustomerId?.trim();
    if (linked && linked !== stripeCustomerId) {
      return undefined;
    }
  }
  return org;
}

async function sendCheckoutEmail(
  label: string,
  orgId: string,
  send: () => Promise<void>
): Promise<void> {
  try {
    await send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[billing] ${label} failed after org was saved`, { orgId, message });
  }
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
