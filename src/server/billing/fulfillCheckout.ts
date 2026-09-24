import type { AuthIdentityStore } from "../auth/authIdentityStore";
import type { AuthTokenStore } from "../auth/authTokenStore";
import type { EmailService } from "../email/emailService";
import type { OrgStore } from "../orgStore";
import { parseUsageTier, type UsageTier } from "../usageTiers";
import type { UserStore } from "../users/userStore";
import { loadBillingConfig } from "./billingConfig";
import { provisionOrgFromCheckout, type ProvisionResult } from "./provisionOrg";

/** Paid session is missing the customer or admin email. Do not mark the webhook completed. */
export class CheckoutFulfillmentIncompleteError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CheckoutFulfillmentIncompleteError";
  }
}

export type FulfillCheckoutResult = ProvisionResult & {
  stripeCustomerId: string;
  adminEmail: string;
  seatCount: number;
  existingOrgId: string;
  upgrade: boolean;
  requestedOrgName: string;
};

export type CheckoutSessionLike = {
  id?: unknown;
  customer?: unknown;
  subscription?: unknown;
  customer_email?: unknown;
  client_reference_id?: unknown;
  metadata?: unknown;
};

export async function fulfillPaidCheckoutSession(
  session: CheckoutSessionLike,
  deps: {
    orgStore: OrgStore;
    userStore: UserStore;
    emailService: EmailService;
    authTokenStore?: AuthTokenStore;
    authIdentityStore?: AuthIdentityStore;
  }
): Promise<FulfillCheckoutResult> {
  const metadata = readMetadata(session);
  const customerId = readStripeCustomerId(session.customer);
  const subscriptionId = readStripeObjectId(session.subscription);
  const adminEmail = String(metadata.admin_email ?? session.customer_email ?? "").trim();
  const requestedOrgName = String(metadata.org_name ?? session.client_reference_id ?? "New Coop Org").trim();
  const seatCount = Math.max(1, Number(metadata.seat_count ?? 1) || 1);
  const existingOrgId = String(metadata.existing_org_id ?? "").trim();
  const upgrade =
    String(metadata.upgrade ?? "")
      .trim()
      .toLowerCase() === "true";
  const usageTier: UsageTier = parseUsageTier(String(metadata.usage_tier ?? "")) ?? "pro";
  const stripePriceId = String(metadata.stripe_price_id ?? "").trim() || undefined;
  const googleSub = String(metadata.google_sub ?? "").trim() || undefined;

  if (!customerId.startsWith("cus_") || !adminEmail) {
    console.warn("[stripe] checkout.session.completed skipped: missing customer or admin email", {
      customerId: customerId || undefined,
      adminEmail: adminEmail || undefined,
      sessionId: String(session.id ?? "")
    });
    throw new CheckoutFulfillmentIncompleteError(
      "checkout.session.completed missing customer or admin email"
    );
  }

  const provisioned = await provisionOrgFromCheckout(
    deps.orgStore,
    deps.userStore,
    deps.emailService,
    loadBillingConfig(),
    {
      orgName: requestedOrgName || "New Coop Org",
      adminEmail,
      seatCount,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      existingOrgId: existingOrgId || undefined,
      upgrade,
      usageTier,
      stripePriceId,
      googleSub
    },
    deps.authTokenStore,
    deps.authIdentityStore
  );

  return {
    ...provisioned,
    stripeCustomerId: customerId,
    adminEmail,
    seatCount,
    existingOrgId,
    upgrade,
    requestedOrgName
  };
}

/** Stripe sometimes expands `customer` into an object. Never store that as "[object Object]". */
export function readStripeCustomerId(customer: unknown): string {
  return readStripeObjectId(customer);
}

function readStripeObjectId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id.trim() : "";
  }
  return "";
}

function readMetadata(session: CheckoutSessionLike): Record<string, unknown> {
  if (typeof session.metadata === "object" && session.metadata !== null) {
    return session.metadata as Record<string, unknown>;
  }
  return {};
}
