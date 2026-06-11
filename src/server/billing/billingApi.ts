import type { ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { EmailService } from "../email/emailService";
import { type AuditLogger } from "../audit/auditLogger";
import { requireAuth, requireOrgAdmin, resolveAuthContext } from "../authMiddleware";
import type { ServerConfig } from "../serverConfig";
import { loadBillingConfig } from "./billingConfig";
import { StripeService } from "./stripeService";
import { provisionOrgFromCheckout } from "./provisionOrg";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  rawBody: Buffer;
};

export type BillingApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  emailService?: EmailService;
  auditLogger?: AuditLogger;
  serverConfig: ServerConfig;
  stripeService?: StripeService;
  pool?: Pool | null;
};

export async function handleBillingApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps
): Promise<boolean> {
  const billingConfig = loadBillingConfig();
  const stripe = deps.stripeService ?? new StripeService(billingConfig);

  if (parsed.method === "POST" && parsed.pathname === "/webhooks/stripe") {
    return handleStripeWebhook(parsed, response, deps, stripe);
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/billing/checkout-session") {
    return handleCreateCheckout(parsed, response, stripe);
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/billing/portal-session") {
    return handleBillingPortal(parsed, response, deps, stripe);
  }

  return false;
}

async function handleCreateCheckout(
  parsed: ParsedRequest,
  response: ServerResponse,
  stripe: StripeService
): Promise<boolean> {
  if (!stripe.isConfigured()) {
    writeJson(response, 503, { error: "billing_unavailable", message: "Stripe is not configured on this server." });
    return true;
  }

  const body = asRecord(parsed.body);
  const orgName = String(body.orgName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const seats = Math.max(1, Number(body.seats ?? 1) || 1);

  if (!orgName || !email) {
    writeJson(response, 400, { error: "orgName and email are required" });
    return true;
  }

  try {
    const session = await stripe.createCheckoutSession({ orgName, email, seats });
    writeJson(response, 200, { sessionId: session.id, url: session.url });
  } catch (error) {
    writeJson(response, 502, {
      error: "stripe_error",
      message: error instanceof Error ? error.message : "Checkout failed"
    });
  }
  return true;
}

async function handleBillingPortal(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps,
  stripe: StripeService
): Promise<boolean> {
  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth,
    deps.userStore
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth) || !auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireOrgAdmin(auth, response)) return true;
  if (!deps.orgStore || !stripe.isConfigured()) {
    writeJson(response, 503, { error: "billing_unavailable" });
    return true;
  }

  const billing = await deps.orgStore.getOrganizationBilling(auth.orgId);
  if (!billing?.stripeCustomerId) {
    writeJson(response, 400, { error: "no_stripe_customer", message: "This org has no Stripe subscription." });
    return true;
  }

  try {
    const portal = await stripe.createBillingPortalSession(billing.stripeCustomerId);
    writeJson(response, 200, { url: portal.url });
  } catch (error) {
    writeJson(response, 502, {
      error: "stripe_error",
      message: error instanceof Error ? error.message : "Portal session failed"
    });
  }
  return true;
}

async function handleStripeWebhook(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps,
  stripe: StripeService
): Promise<boolean> {
  if (!deps.orgStore || !deps.userStore || !deps.emailService) {
    writeJson(response, 503, { error: "billing_unavailable" });
    return true;
  }

  const rawBody = parsed.rawBody.toString("utf8");
  let event: Record<string, unknown>;
  try {
    event = stripe.verifyWebhookSignature(rawBody, parsed.headers["stripe-signature"]) as Record<string, unknown>;
  } catch (error) {
    writeJson(response, 400, {
      error: "invalid_signature",
      message: error instanceof Error ? error.message : "Invalid webhook"
    });
    return true;
  }

  const type = String(event.type ?? "");
  const eventId = String(event.id ?? "");
  if (eventId) {
    const claimed = await claimStripeWebhookEvent(deps.pool, eventId, type);
    if (!claimed) {
      writeJson(response, 200, { received: true, duplicate: true });
      return true;
    }
  }

  try {
    if (type === "checkout.session.completed") {
      await handleCheckoutCompleted(event, deps);
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      await handleSubscriptionChange(event, deps);
    } else if (type === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(event, deps);
    }
  } catch (error) {
    console.error("[stripe] webhook handler error:", error);
    writeJson(response, 500, { error: "webhook_handler_failed" });
    return true;
  }

  writeJson(response, 200, { received: true });
  return true;
}

async function handleCheckoutCompleted(event: Record<string, unknown>, deps: BillingApiDeps): Promise<void> {
  const session = asRecord(asRecord(event.data).object);
  const customerId = String(session.customer ?? "");
  const subscriptionId = String(session.subscription ?? "");
  const metadata = asRecord(session.metadata);
  const orgName = String(metadata.org_name ?? session.client_reference_id ?? "New Coop Org").trim();
  const adminEmail = String(metadata.admin_email ?? session.customer_email ?? "").trim();
  const seatCount = Math.max(1, Number(metadata.seat_count ?? 1) || 1);

  if (!customerId || !adminEmail) return;

  const provisioned = await provisionOrgFromCheckout(
    deps.orgStore!,
    deps.userStore!,
    deps.emailService!,
    loadBillingConfig(),
    {
      orgName,
      adminEmail,
      seatCount,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId
    }
  );

  await deps.auditLogger?.record({
    orgId: provisioned.orgId,
    action: "billing.checkout.completed",
    metadata: { orgName, adminEmail, seatCount, stripeCustomerId: customerId }
  });
}

async function handleSubscriptionChange(event: Record<string, unknown>, deps: BillingApiDeps): Promise<void> {
  const object = asRecord(asRecord(event.data).object);
  const customerId = String(object.customer ?? "");
  const status = String(object.status ?? "");
  const org = customerId ? await deps.orgStore!.findOrganizationByStripeCustomerId(customerId) : undefined;
  if (!org) return;

  const quantity = readSubscriptionQuantity(object);

  if (status === "active" || status === "trialing") {
    await deps.orgStore!.setOrganizationPlan(org.id, "pro");
    await deps.orgStore!.updateOrganizationBilling(org.id, {
      billingStatus: "active",
      stripeSubscriptionId: String(object.id ?? ""),
      seatCount: quantity
    });
  } else if (status === "canceled" || status === "unpaid") {
    await deps.orgStore!.setOrganizationPlan(org.id, "free");
    await deps.orgStore!.updateOrganizationBilling(org.id, { billingStatus: status });
  }
}

async function handleInvoicePaymentFailed(event: Record<string, unknown>, deps: BillingApiDeps): Promise<void> {
  const object = asRecord(asRecord(event.data).object);
  const customerId = String(object.customer ?? "");
  const org = customerId ? await deps.orgStore!.findOrganizationByStripeCustomerId(customerId) : undefined;
  if (!org) return;

  await deps.orgStore!.updateOrganizationBilling(org.id, { billingStatus: "past_due" });
}

async function claimStripeWebhookEvent(
  pool: Pool | null | undefined,
  eventId: string,
  eventType: string
): Promise<boolean> {
  if (!pool) {
    return true;
  }
  try {
    const result = await pool.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, eventType]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[stripe] webhook dedup check failed for ${eventId}: ${message}`);
    return true;
  }
}

function readSubscriptionQuantity(object: Record<string, unknown>): number {
  const items = asRecord(object.items);
  const data = Array.isArray(items.data) ? items.data : [];
  const first = data[0];
  if (typeof first === "object" && first !== null) {
    const qty = Number((first as Record<string, unknown>).quantity);
    if (Number.isFinite(qty) && qty > 0) {
      return Math.floor(qty);
    }
  }
  const direct = Number(object.quantity);
  return Number.isFinite(direct) && direct > 0 ? Math.floor(direct) : 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
